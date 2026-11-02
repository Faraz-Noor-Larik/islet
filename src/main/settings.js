'use strict';

const fs = require('fs');

const DEFAULTS = Object.freeze({
  // Look
  shape: 'pill', // pill | rounded | notch | square
  radius: null, // custom corner radius in px, null = decided by shape
  scale: 1,
  opacity: 1,
  theme: 'dark', // dark | light | auto
  // Where it lives (offsets are from top-centre of the chosen monitor)
  x: 0,
  y: 10,
  monitor: 'primary', // primary | cursor | "0" | "1" ...
  // Behaviour
  hover: 'expand', // expand | fade | none
  hideInFullscreen: true,
  alwaysOnTop: true,
  autoExpand: true, // briefly open when the song changes
  // Clock
  showTime: true,
  hour12: false,
  showSeconds: false,
  // Music
  showMusic: true,
  showLyrics: true,
  lyricsOffset: 0, // ms, positive = show lyrics later
  // System
  startWithWindows: false,
});

const RANGES = {
  scale: [0.7, 1.8],
  opacity: [0.4, 1],
  x: [-2000, 2000],
  y: [0, 800],
  radius: [0, 60],
  lyricsOffset: [-3000, 3000],
};

const ENUMS = {
  shape: ['pill', 'rounded', 'notch', 'square'],
  theme: ['dark', 'light', 'auto'],
  hover: ['expand', 'fade', 'none'],
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Returns a complete, valid settings object. Unknown keys and bad values are ignored. */
function sanitize(input, base = DEFAULTS) {
  const out = { ...base };
  const src = input && typeof input === 'object' ? input : {};
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in src)) continue;
    const v = src[key];
    if (ENUMS[key]) {
      if (ENUMS[key].includes(v)) out[key] = v;
    } else if (key === 'monitor') {
      if (v === 'primary' || v === 'cursor' || /^\d+$/.test(String(v))) out[key] = String(v);
    } else if (key === 'radius') {
      if (v === null) out[key] = null;
      else if (Number.isFinite(Number(v))) out[key] = Math.round(clamp(Number(v), ...RANGES.radius));
    } else if (typeof DEFAULTS[key] === 'boolean') {
      out[key] = Boolean(v);
    } else if (typeof DEFAULTS[key] === 'number') {
      const n = Number(v);
      if (Number.isFinite(n)) {
        const c = clamp(n, ...RANGES[key]);
        out[key] = key === 'scale' || key === 'opacity' ? Math.round(c * 100) / 100 : Math.round(c);
      }
    }
  }
  return out;
}

class Store {
  constructor(file) {
    this.file = file;
    this.data = { ...DEFAULTS };
    this._timer = null;
  }

  load() {
    try {
      this.data = sanitize(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch (e) {
      this.data = { ...DEFAULTS };
    }
    return this.data;
  }

  get() {
    return this.data;
  }

  set(patch) {
    this.data = sanitize(patch, this.data);
    this._schedule();
    return this.data;
  }

  reset() {
    this.data = { ...DEFAULTS };
    this._schedule();
    return this.data;
  }

  _schedule() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 300);
  }

  flush() {
    clearTimeout(this._timer);
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (e) {
      /* settings are best-effort */
    }
  }
}

module.exports = { DEFAULTS, RANGES, ENUMS, sanitize, Store };
