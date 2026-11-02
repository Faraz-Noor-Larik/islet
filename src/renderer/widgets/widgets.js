(() => {
  'use strict';

  const api = window.islet;
  const D = window.DateInfo;
  const $ = (sel, root = document) => root.querySelector(sel);
  const html = document.documentElement;

  /* id -> which settings drive it */
  const WIDGETS = {
    clock: { el: $('[data-id="clock"]'), x: 'clockX', y: 'clockY', scale: 'clockScale', show: 'showClock' },
    cal: { el: $('[data-id="cal"]'), x: 'calX', y: 'calY', scale: 'widgetsScale', show: 'showCalendar' },
    day: { el: $('[data-id="day"]'), x: 'dayX', y: 'dayY', scale: 'widgetsScale', show: 'showDay' },
    note: { el: $('[data-id="note"]'), x: 'noteX', y: 'noteY', scale: 'widgetsScale', show: 'showNote' },
  };

  let S = null; // current settings
  let editing = false;

  /* ------------------------------------------------------------ tiny DOM helpers */
  function h(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /* ------------------------------------------------------------ flip card */
  class Flip {
    constructor() {
      this.el = h('div', 'flip');
      this.upper = h('div', 'upper');
      this.lower = h('div', 'lower');
      this.flapUp = h('div', 'flap up');
      this.flapDown = h('div', 'flap down');
      this.t = {};
      for (const [name, parent] of [['upper', this.upper], ['lower', this.lower], ['up', this.flapUp], ['down', this.flapDown]]) {
        this.t[name] = h('b');
        parent.appendChild(this.t[name]);
      }
      this.el.append(this.upper, this.lower, this.flapUp, this.flapDown);
      this.value = null;
      this.timer = null;
    }

    _finish() {
      clearTimeout(this.timer);
      this.timer = null;
      this.t.lower.textContent = this.value;
      this.el.classList.remove('go');
    }

    set(value) {
      if (value === this.value) return;
      if (this.value === null) {
        this.value = value;
        for (const k of Object.keys(this.t)) this.t[k].textContent = value;
        return;
      }
      if (this.timer) this._finish(); // a flip was still running (throttled tab): land it first
      const old = this.value;
      this.value = value;
      this.t.up.textContent = old;
      this.t.down.textContent = value;
      this.t.upper.textContent = value;
      void this.el.offsetWidth; // restart the CSS animation
      this.el.classList.add('go');
      this.timer = setTimeout(() => this._finish(), 520);
    }
  }

  /* ------------------------------------------------------------ clock */
  let clockKey = '';
  let clockRefs = null;
  const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
  const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
  const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long' });

  function buildClock() {
    const box = WIDGETS.clock.el;
    box.textContent = '';
    box.dataset.style = S.clockStyle;
    const refs = { style: S.clockStyle };
    box.classList.add('loose');

    if (S.showDate) {
      const meta = h('div', 'cl-meta');
      refs.date = h('span');
      refs.weekday = h('span');
      meta.append(refs.date, refs.weekday);
      box.appendChild(meta);
    }

    const face = h('div', 'cl-face');
    if (S.clockStyle === 'flip') {
      refs.hh = new Flip();
      refs.mm = new Flip();
      face.append(refs.hh.el, refs.mm.el);
      if (S.clockSeconds) {
        refs.ss = new Flip();
        face.appendChild(refs.ss.el);
      }
      refs.ampm = h('span', 'ampm');
      refs.hh.el.appendChild(refs.ampm);
    } else if (S.clockStyle === 'stacked') {
      refs.hh = h('div');
      refs.mm = h('div');
      face.append(refs.hh, refs.mm);
      if (S.clockSeconds) {
        refs.ss = h('div', 'stack-sec');
        face.appendChild(refs.ss);
      }
    } else {
      refs.hh = h('span');
      refs.colon = h('span', 'colon', ':');
      refs.mm = h('span');
      face.append(refs.hh, refs.colon, refs.mm);
      if (S.clockSeconds) {
        refs.ss = h('span', 'line-sec');
        face.appendChild(refs.ss);
      }
      refs.ampm = h('span', 'line-ampm');
      face.appendChild(refs.ampm);
    }
    box.appendChild(face);

    if (S.showDate) {
      refs.foot = h('div', 'cl-foot');
      box.appendChild(refs.foot);
    }
    clockRefs = refs;
    clockKey = `${S.clockStyle}|${S.showDate}|${S.clockSeconds}|${S.hour12}`;
  }

  function updateClock(now) {
    if (!clockRefs) return;
    const p = D.clockParts(now, S.hour12);
    const r = clockRefs;
    const put = (slot, v) => {
      if (!slot) return;
      if (slot instanceof Flip) slot.set(v);
      else if (slot.textContent !== v) slot.textContent = v;
    };
    put(r.hh, p.h);
    put(r.mm, p.m);
    put(r.ss, p.s);
    if (r.ampm) r.ampm.textContent = p.ampm;
    if (r.date) {
      put(r.date, dateFmt.format(now));
      put(r.weekday, weekdayFmt.format(now));
      put(r.foot, `Week ${D.isoWeek(now)} · Day ${D.dayOfYear(now)}`);
    }
  }

  /* ------------------------------------------------------------ calendar */
  let calKey = '';
  function renderCalendar(now) {
    const key = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${S.weekStart}`;
    if (key === calKey) return;
    calKey = key;
    const box = WIDGETS.cal.el;
    box.textContent = '';
    const head = h('div', 'cal-head');
    head.append(h('span', 'mo', monthFmt.format(now)), h('span', 'yr', String(now.getFullYear())));
    const grid = h('div', 'cal-grid');
    for (const l of D.weekdayInitials(S.weekStart)) grid.appendChild(h('span', 'dow', l));
    const weekend = D.weekendColumns(S.weekStart);
    for (const row of D.monthGrid(now.getFullYear(), now.getMonth(), S.weekStart)) {
      row.forEach((day, col) => {
        const cell = h('span', '', day === null ? '' : String(day));
        if (day !== null && weekend.includes(col)) cell.classList.add('we');
        if (day === now.getDate()) cell.classList.add('today');
        grid.appendChild(cell);
      });
    }
    box.append(head, grid);
  }

  /* ------------------------------------------------------------ time passing */
  let dayRefs = null;
  function buildDay(now) {
    const box = WIDGETS.day.el;
    box.textContent = '';
    box.appendChild(h('div', 'day-title', 'Time passing'));
    dayRefs = {};
    for (const [id, label] of [['day', 'Today'], ['week', 'This week'], ['year', String(now.getFullYear())]]) {
      const row = h('div', 'day-row');
      const line = h('div', 'day-line');
      const pct = h('b', '', '0%');
      line.append(h('span', '', label), pct);
      const track = h('div', 'day-track');
      const fill = h('i');
      track.appendChild(fill);
      row.append(line, track);
      box.appendChild(row);
      dayRefs[id] = { pct, fill };
    }
    dayRefs.yearLabel = box.querySelectorAll('.day-line span')[2];
  }
  function updateDay(now) {
    if (!dayRefs) buildDay(now);
    const p = D.progress(now, S.weekStart);
    for (const id of ['day', 'week', 'year']) {
      const v = Math.min(1, Math.max(0, p[id]));
      dayRefs[id].pct.textContent = `${Math.floor(v * 100)}%`;
      dayRefs[id].fill.style.width = `${(v * 100).toFixed(2)}%`;
    }
    const y = String(now.getFullYear());
    if (dayRefs.yearLabel.textContent !== y) dayRefs.yearLabel.textContent = y;
  }

  /* ------------------------------------------------------------ note */
  const noteBody = $('#note-body');
  let noteTimer = null;
  function renderNote() {
    WIDGETS.note.el.dataset.color = S.noteColor;
    if (document.activeElement !== noteBody && noteBody.textContent !== S.noteText) noteBody.textContent = S.noteText;
  }
  noteBody.addEventListener('input', () => {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => api.setSettings({ noteText: noteBody.innerText.replace(/\n$/, '') }), 250);
  });
  noteBody.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') noteBody.blur();
    e.stopPropagation();
  });

  /* ------------------------------------------------------------ layout */
  /** The clock is pinned to the exact middle of the screen; everything else uses its saved spot. */
  function centreOf(w) {
    return w === WIDGETS.clock ? { fx: 0.5, fy: 0.5 } : { fx: S[w.x], fy: S[w.y] };
  }

  function layout() {
    if (!S) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    for (const w of Object.values(WIDGETS)) {
      w.el.hidden = !S[w.show];
      const c = centreOf(w);
      w.el.style.left = `${Math.round(c.fx * W)}px`;
      w.el.style.top = `${Math.round(c.fy * H)}px`;
      w.el.style.setProperty('--k', String(S[w.scale]));
    }
  }

  function applySettings(next) {
    const prev = S;
    S = next;
    html.dataset.ink = S.widgetsInk;
    if (!prev || clockKey !== `${S.clockStyle}|${S.showDate}|${S.clockSeconds}|${S.hour12}`) buildClock();
    calKey = '';
    renderNote();
    layout();
    tick(true);
  }

  /* ------------------------------------------------------------ ticking */
  let lastSecond = -1;
  function tick(force) {
    if (!S) return;
    const now = new Date();
    if (!force && now.getSeconds() === lastSecond) return;
    lastSecond = now.getSeconds();
    updateClock(now);
    renderCalendar(now);
    updateDay(now);
  }
  setInterval(tick, 250);

  /* ------------------------------------------------------------ arranging (drag, snap, guides) */
  const gx = $('#guide-x');
  const gy = $('#guide-y');
  const SNAP = 9;
  let drag = null;

  function centre(id) {
    const c = centreOf(WIDGETS[id]);
    return { x: c.fx * window.innerWidth, y: c.fy * window.innerHeight };
  }

  /** Nearest alignment line within SNAP px: the screen centre or another widget's centre line. */
  function snapAxis(value, lines) {
    let best = null;
    for (const l of lines) {
      const d = Math.abs(value - l);
      if (d <= SNAP && (best === null || d < Math.abs(value - best))) best = l;
    }
    return best;
  }

  document.addEventListener('pointerdown', (e) => {
    if (!editing || e.button !== 0) return;
    const el = e.target.closest('.w');
    if (!el) return;
    if (e.target.closest('.note-body')) return; // that's for typing
    const id = el.dataset.id;
    if (id === 'clock') return; // locked to the centre
    const c = centre(id);
    drag = { id, el, sx: e.clientX, sy: e.clientY, cx: c.x, cy: c.y, nx: c.x, ny: c.y };
    el.classList.add('dragging');
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    let nx = Math.min(W, Math.max(0, drag.cx + e.clientX - drag.sx));
    let ny = Math.min(H, Math.max(0, drag.cy + e.clientY - drag.sy));
    const others = Object.keys(WIDGETS).filter((k) => k !== drag.id && !WIDGETS[k].el.hidden);
    const sx = snapAxis(nx, [W / 2, ...others.map((k) => centre(k).x)]);
    const sy = snapAxis(ny, [H / 2, ...others.map((k) => centre(k).y)]);
    if (sx !== null) nx = sx;
    if (sy !== null) ny = sy;
    gx.classList.toggle('on', sx !== null);
    gy.classList.toggle('on', sy !== null);
    if (sx !== null) gx.style.left = `${sx}px`;
    if (sy !== null) gy.style.top = `${sy}px`;
    drag.nx = nx;
    drag.ny = ny;
    drag.el.style.left = `${Math.round(nx)}px`;
    drag.el.style.top = `${Math.round(ny)}px`;
  });

  function endDrag() {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.el.classList.remove('dragging');
    gx.classList.remove('on');
    gy.classList.remove('on');
    const w = WIDGETS[d.id];
    api.setSettings({
      [w.x]: d.nx / window.innerWidth,
      [w.y]: d.ny / window.innerHeight,
    });
  }
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);

  function setEditing(on) {
    editing = Boolean(on);
    html.classList.toggle('editing', editing);
    noteBody.contentEditable = editing ? 'plaintext-only' : 'false';
    if (!editing && document.activeElement === noteBody) noteBody.blur();
  }

  document.addEventListener('keydown', (e) => {
    if (editing && e.key === 'Escape') api.setEditMode(false);
  });
  $('#done').addEventListener('click', () => api.setEditMode(false));
  $('#resetLayout').addEventListener('click', () => api.resetWidgetLayout());

  /* ------------------------------------------------------------ boot */
  window.addEventListener('resize', layout);
  api.onSettings(applySettings);
  api.onEditMode(setEditing);
  api.getState().then((state) => {
    applySettings(state.settings);
    setEditing(state.editMode);
  });
})();
