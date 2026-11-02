(() => {
  'use strict';
  const api = window.islet;
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const el = {
    island: $('island'),
    eq: $('eq'),
    line: $('line'),
    title: $('title'),
    artist: $('artist'),
    clock: $('clock'),
    cur: $('cur'),
    next: $('next'),
    elapsed: $('elapsed'),
    remaining: $('remaining'),
    fill: $('fill'),
    progress: document.querySelector('.progress'),
  };

  let settings = null;
  let media = { status: 'none', track: null, pos: 0, at: Date.now(), duration: 0 };
  let lyrics = { key: null, status: 'none', lines: [] };
  let hovering = false;
  let moving = false;
  let peekUntil = 0;
  let pausedSince = 0;
  let clockFmt = null;
  let clockFmtKey = '';
  let dateFmt = null;

  /* ---------- text swapping with a little animation ---------- */
  function makeSwapper(container) {
    let current = null;
    return (text) => {
      if (text === current) return;
      current = text;
      const old = container.querySelector('.l:not(.out)');
      if (old) {
        old.classList.add('out');
        setTimeout(() => old.remove(), 320);
      }
      if (text) {
        const span = document.createElement('span');
        span.className = 'l';
        span.textContent = text;
        container.appendChild(span);
      }
    };
  }
  const setLine = makeSwapper(el.line);
  const setCur = makeSwapper(el.cur);

  /* ---------- settings -> look ---------- */
  function applySettings(s) {
    settings = s;
    root.classList.remove('shape-pill', 'shape-rounded', 'shape-notch', 'shape-square', 'theme-dark', 'theme-light', 'theme-auto');
    root.classList.add(`shape-${s.shape}`, `theme-${s.theme}`);
    root.classList.toggle('has-radius', s.radius !== null);
    root.style.setProperty('--rc', `${s.radius === null ? 0 : s.radius}px`);
    root.style.setProperty('--scale', String(s.scale));
    root.style.setProperty('--bg-a', String(s.opacity));
    el.island.classList.toggle('no-clock', !s.showTime);
    const key = `${s.hour12}|${s.showSeconds}`;
    if (key !== clockFmtKey) {
      clockFmtKey = key;
      clockFmt = new Intl.DateTimeFormat(undefined, {
        hour: s.hour12 ? 'numeric' : '2-digit',
        minute: '2-digit',
        second: s.showSeconds ? '2-digit' : undefined,
        hourCycle: s.hour12 ? 'h12' : 'h23',
      });
    }
    dateFmt = dateFmt || new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    tick(true);
  }

  /* ---------- music helpers ---------- */
  const hasMusic = () => Boolean(settings && settings.showMusic && media.track);

  function position() {
    if (!media.track) return 0;
    let p = media.pos;
    if (media.status === 'playing') p += (Date.now() - media.at) / 1000;
    if (media.duration > 0) p = Math.min(p, media.duration);
    return Math.max(0, p);
  }

  function lineIndex(t) {
    const lines = lyrics.lines;
    let lo = 0;
    let hi = lines.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].t <= t) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }

  const fmtTime = (sec) => {
    sec = Math.max(0, Math.floor(sec));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  };

  /* ---------- state machine: idle -> music -> expanded ---------- */
  function desiredState() {
    if (moving) return 'move';
    const music = hasMusic();
    const showingMusic = music && (media.status === 'playing' || Date.now() - pausedSince < 5000);
    const open = (hovering && settings.hover === 'expand') || Date.now() < peekUntil;
    if (showingMusic) return open ? 'expanded' : 'music';
    if (open) return settings.showTime ? 'peek' : 'empty';
    return settings.showTime ? 'idle' : 'empty';
  }

  let lastSecond = -1;
  function tick(force) {
    if (!settings) return;
    const now = new Date();

    // clock
    if (force || now.getSeconds() !== lastSecond) {
      lastSecond = now.getSeconds();
      el.clock.textContent = clockFmt.format(now);
    }

    const state = desiredState();
    if (el.island.dataset.state !== state) el.island.dataset.state = state;
    el.island.classList.toggle('faded', hovering && settings.hover === 'fade' && !moving);
    el.eq.classList.toggle('playing', media.status === 'playing');

    if (state === 'peek') {
      el.title.textContent = dateFmt.format(now);
      el.artist.textContent = '';
    }

    if (!hasMusic()) {
      setLine('');
      setCur('');
      return;
    }

    el.title.textContent = state === 'peek' ? el.title.textContent : media.track.title;
    el.artist.textContent = media.track.artist;

    // lyrics
    const synced = settings.showLyrics && lyrics.key === media.track.key && lyrics.status === 'found' && lyrics.lines.length > 0;
    const p = position();
    const idx = synced ? lineIndex(p + settings.lyricsOffset / 1000) : -1;
    const fallback = media.track.artist ? `${media.track.title} · ${media.track.artist}` : media.track.title;
    const currentText = idx >= 0 ? lyrics.lines[idx].text || '♪' : fallback;
    setLine(currentText);
    setCur(idx >= 0 ? currentText : media.track.title);
    const nextLine = synced && idx + 1 < lyrics.lines.length ? lyrics.lines[idx + 1].text : '';
    el.next.textContent = idx >= 0 ? nextLine : media.track.artist;

    // progress
    if (media.duration > 0) {
      el.progress.classList.remove('hidden');
      el.fill.style.width = `${Math.min(100, (p / media.duration) * 100)}%`;
      el.elapsed.textContent = fmtTime(p);
      el.remaining.textContent = `-${fmtTime(media.duration - p)}`;
    } else {
      el.progress.classList.add('hidden');
    }
  }

  /* ---------- events from the main process ---------- */
  api.onSettings(applySettings);

  api.onMedia((m) => {
    const prevKey = media.track ? media.track.key : null;
    const prevStatus = media.status;
    media = m;
    if (m.status === 'paused' && prevStatus !== 'paused') pausedSince = Date.now();
    const newKey = m.track ? m.track.key : null;
    if (newKey && newKey !== prevKey && settings && settings.autoExpand && settings.showMusic) {
      peekUntil = Date.now() + 4500; // open briefly when a new song starts
    }
    tick();
  });

  api.onLyrics((l) => {
    lyrics = l;
    tick();
  });

  // The island is click-through, so hover comes from the main process watching the cursor.
  api.onCursor((rel) => {
    let inside = false;
    if (rel) {
      const r = el.island.getBoundingClientRect();
      inside = rel.x >= r.left - 4 && rel.x <= r.right + 4 && rel.y >= r.top - 2 && rel.y <= r.bottom + 8;
    }
    if (inside !== hovering) {
      hovering = inside;
      tick();
    }
  });

  api.onMoveMode((on) => {
    moving = on;
    root.classList.toggle('moving', on);
    tick();
  });

  /* ---------- drag-to-place (only while move mode is on) ---------- */
  let dragging = false;
  el.island.addEventListener('pointerdown', (e) => {
    if (!moving) return;
    dragging = true;
    el.island.setPointerCapture(e.pointerId);
    api.dragStart();
  });
  el.island.addEventListener('pointermove', () => {
    if (dragging) api.dragMove();
  });
  const stopDrag = () => {
    if (!dragging) return;
    dragging = false;
    api.dragEnd();
  };
  el.island.addEventListener('pointerup', stopDrag);
  el.island.addEventListener('pointercancel', stopDrag);
  el.island.addEventListener('dblclick', () => {
    if (moving) api.setMoveMode(false);
  });

  /* ---------- go ---------- */
  api.getState().then((st) => {
    media = st.media;
    lyrics = st.lyrics;
    moving = st.moveMode;
    root.classList.toggle('moving', moving);
    applySettings(st.settings);
  });
  setInterval(() => tick(), 150);
})();
