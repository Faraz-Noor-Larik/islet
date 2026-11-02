'use strict';

const fs = require('fs');

const DEFAULTS = Object.freeze({
  // ---- Island: look
  shape: 'pill', // pill | rounded | notch | square
  radius: null, // custom corner radius in px, null = decided by shape
  scale: 1,
  opacity: 1,
  theme: 'dark', // dark | light | auto
  // Island: where it lives (offsets are from top-centre of the chosen monitor)
  x: 0,
  y: 10,
  monitor: 'primary', // primary | cursor | "0" | "1" ...
  // Island: behaviour
  hover: 'expand', // expand | fade | none
  hideInFullscreen: true,
  alwaysOnTop: true,
  autoExpand: true, // briefly open when the song changes
  // Island: clock (the big clock is a widget now, so the island only shows music by default)
  showTime: false,
  hour12: false,
  showSeconds: false,
  // Island: music
  showMusic: true,
  showLyrics: true,
  lyricsOffset: 0, // ms, positive = show lyrics later

  // ---- Widgets (the desktop layer: centre clock, calendar, note, day progress)
  widgets: true,
  widgetsLayer: 'desktop', // desktop = behind your windows, top = above everything
  widgetsMonitor: 'primary', // primary | "0" | "1" ...
  widgetsInk: 'white', // white | black (text colour, pick what reads on your wallpaper)
  widgetsScale: 1,
  clockScale: 1,
  showClock: true,
  clockStyle: 'flip', // flip | stacked | line
  clockSeconds: true,
  showDate: true, // date, weekday and "Week 45 · Day 306" around the clock
  showCalendar: true,
  showDay: true,
  showNote: true,
  weekStart: 'mon', // mon | sun
  noteText: 'Pin a thought here.\nTray → Arrange widgets to move me.',
  noteColor: 'butter', // butter | rose | sky | mint
  // Widget positions: the centre of each widget as a fraction of the screen (0..1)
  clockX: 0.5,
  clockY: 0.5,
  calX: 0.84,
  calY: 0.3,
  dayX: 0.16,
  dayY: 0.3,
  noteX: 0.16,
  noteY: 0.72,

  // ---- System
  startWithWindows: false,
});

const POSITION_KEYS = ['clockX', 'clockY', 'calX', 'calY', 'dayX', 'dayY', 'noteX', 'noteY'];

const RANGES = {
  scale: [0.7, 1.8],
  opacity: [0.4, 1],
  x: [-2000, 2000],
  y: [0, 800],
  radius: [0, 60],
  lyricsOffset: [-3000, 3000],
  widgetsScale: [0.6, 1.6],
  clockScale: [0.5, 2.5],
  clockX: [0, 1],
  clockY: [0, 1],
  calX: [0, 1],
  calY: [0, 1],
  dayX: [0, 1],
  dayY: [0, 1],
  noteX: [0, 1],
  noteY: [0, 1],
};

const ENUMS = {
  shape: ['pill', 'rounded', 'notch', 'square'],
  theme: ['dark', 'light', 'auto'],
  hover: ['expand', 'fade', 'none'],
  widgetsLayer: ['desktop', 'top'],
  widgetsInk: ['white', 'black'],
  clockStyle: ['flip', 'stacked', 'line'],
  weekStart: ['mon', 'sun'],
  noteColor: ['butter', 'rose', 'sky', 'mint'],
};

const NOTE_MAX = 400;
const FINE = new Set([...POSITION_KEYS, 'scale', 'opacity', 'widgetsScale', 'clockScale']);

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
    } else if (key === 'widgetsMonitor') {
      if (v === 'primary' || /^\d+$/.test(String(v))) out[key] = String(v);
    } else if (key === 'noteText') {
      if (typeof v === 'string') out[key] = v.slice(0, NOTE_MAX);
    } else if (key === 'radius') {
      if (v === null) out[key] = null;
      else if (Number.isFinite(Number(v))) out[key] = Math.round(clamp(Number(v), ...RANGES.radius));
    } else if (typeof DEFAULTS[key] === 'boolean') {
      out[key] = Boolean(v);
    } else if (typeof DEFAULTS[key] === 'number') {
      const n = Number(v);
      if (Number.isFinite(n)) {
        const c = clamp(n, ...RANGES[key]);
        out[key] = FINE.has(key) ? Math.round(c * 1000) / 1000 : Math.round(c);
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

  /** Puts every widget back where it started (positions only, nothing else). */
  resetLayout() {
    const patch = {};
    for (const k of POSITION_KEYS) patch[k] = DEFAULTS[k];
    return this.set(patch);
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

module.exports = { DEFAULTS, POSITION_KEYS, RANGES, ENUMS, NOTE_MAX, sanitize, Store };
