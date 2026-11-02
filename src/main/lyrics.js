'use strict';

// Synced lyrics from LRCLIB (https://lrclib.net), a free, open lyrics database. No account or key.
const BASE = 'https://lrclib.net/api';
const UA = 'Islet/0.2.0 (desktop widget)';

/** Parse an .lrc string into [{ t: seconds, text }] sorted by time. */
function parseLrc(lrc) {
  if (!lrc || typeof lrc !== 'string') return [];
  const lines = [];
  const stamp = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(stamp)];
    if (!stamps.length) continue; // metadata like [ar:Artist] or blank lines
    const text = raw.replace(stamp, '').trim();
    for (const m of stamps) {
      const frac = m[3] ? Number(m[3].padEnd(3, '0').slice(0, 3)) / 1000 : 0;
      lines.push({ t: Number(m[1]) * 60 + Number(m[2]) + frac, text });
    }
  }
  return lines.sort((a, b) => a.t - b.t);
}

const JUNK_BRACKETS = /\s*[([{][^)\]}]*\b(official|lyrics?|lyric video|audio|video|music video|visuali[sz]er|hd|hq|4k|remaster(?:ed)?|live|explicit|clean|full song|slowed|reverb)\b[^)\]}]*[)\]}]/gi;
const JUNK_SUFFIX = /\s*[-–—|]\s*(official|lyrics?|lyric video|audio|video|music video|visuali[sz]er|hd|4k|remaster).*$/i;
const FEAT = /\s*[([]?\s*\b(?:feat|ft|featuring)\b\.?[^)\]]*[)\]]?/i;

function stripJunk(s) {
  return String(s || '')
    .replace(JUNK_BRACKETS, '')
    .replace(JUNK_SUFFIX, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function cleanArtist(a) {
  return String(a || '')
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/\s*VEVO$/i, '')
    .replace(/\s*Official$/i, '')
    .trim();
}

/**
 * Works out what to show and what to search for. Streaming apps give clean fields; browsers
 * (YouTube) give the video title and the channel, so we also try splitting "Artist - Song".
 */
function cleanTrack(rawTitle, rawArtist) {
  const artist = cleanArtist(rawArtist);
  const title = stripJunk(rawTitle);
  const display = { title: title || String(rawTitle || ''), artist };

  const candidates = [];
  const add = (track, art) => {
    const t = stripJunk(track).replace(FEAT, '').trim();
    const a = String(art || '').split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx\b)\s*/i)[0].trim();
    if (t && !candidates.some((c) => c.track === t && c.artist === a)) candidates.push({ track: t, artist: a });
  };

  const split = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (split && (!artist || split[1].toLowerCase().includes(artist.toLowerCase()) || artist.toLowerCase().includes(split[1].toLowerCase()))) {
    // "Artist - Song" typed into the title
    add(split[2], split[1]);
    if (!artist) {
      display.title = split[2];
      display.artist = split[1];
    }
  }
  add(title, artist);
  if (split) add(split[2], artist);
  return { display, candidates };
}

/** From LRCLIB search results, pick the best one that has synced lyrics. */
function pickBest(results, duration) {
  const synced = (Array.isArray(results) ? results : []).filter((r) => r && r.syncedLyrics);
  if (!synced.length) return null;
  if (!(duration > 0)) return synced[0];
  const ranked = synced
    .map((r) => ({ r, diff: Math.abs((r.duration || 0) - duration) }))
    .sort((a, b) => a.diff - b.diff);
  return ranked[0].diff <= 10 ? ranked[0].r : null;
}

async function getJson(fetchImpl, url, signal) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': UA }, signal });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Finds synced lyrics. Resolves { status: 'found', lines } or { status: 'none' }; never throws.
 * track: { title, artist, album, duration (seconds, 0 if unknown) }
 */
async function fetchLyrics(track, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  try {
    const { candidates } = cleanTrack(track.title, track.artist);
    const duration = Math.round(track.duration || 0);
    const signal = AbortSignal.timeout(timeoutMs);
    const q = (o) => new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v))).toString();

    for (const c of candidates) {
      // 1. exact match (best accuracy)
      const exact = await getJson(
        fetchImpl,
        `${BASE}/get?${q({ track_name: c.track, artist_name: c.artist, album_name: track.album, duration: duration || '' })}`,
        signal,
      );
      if (exact && exact.syncedLyrics) return { status: 'found', lines: parseLrc(exact.syncedLyrics) };

      // 2. fuzzy search on the same fields
      const found = pickBest(await getJson(fetchImpl, `${BASE}/search?${q({ track_name: c.track, artist_name: c.artist })}`, signal), duration);
      if (found) return { status: 'found', lines: parseLrc(found.syncedLyrics) };
    }

    // 3. last resort: free-text search
    const first = candidates[0];
    if (first) {
      const text = `${first.artist} ${first.track}`.trim();
      const found = pickBest(await getJson(fetchImpl, `${BASE}/search?${q({ q: text })}`, signal), duration);
      if (found) return { status: 'found', lines: parseLrc(found.syncedLyrics) };
    }
  } catch (e) {
    /* offline, timeout, bad JSON: just no lyrics */
  }
  return { status: 'none', lines: [] };
}

module.exports = { parseLrc, cleanTrack, pickBest, fetchLyrics };
