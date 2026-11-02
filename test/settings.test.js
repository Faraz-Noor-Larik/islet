'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DEFAULTS, POSITION_KEYS, NOTE_MAX, sanitize, Store } = require('../src/main/settings');

test('defaults pass through sanitize unchanged', () => {
  assert.deepEqual(sanitize({}), { ...DEFAULTS });
  assert.deepEqual(sanitize(DEFAULTS), { ...DEFAULTS });
});

test('the island no longer shows the time by default; the clock widget does', () => {
  assert.equal(DEFAULTS.showTime, false);
  assert.equal(DEFAULTS.showClock, true);
  assert.equal(DEFAULTS.clockX, 0.5);
  assert.equal(DEFAULTS.clockY, 0.5);
});

test('enums reject unknown values and keep the old one', () => {
  const s = sanitize({ clockStyle: 'confetti', widgetsLayer: 'moon', noteColor: 'rose', shape: 'notch' });
  assert.equal(s.clockStyle, 'flip');
  assert.equal(s.widgetsLayer, 'desktop');
  assert.equal(s.noteColor, 'rose');
  assert.equal(s.shape, 'notch');
});

test('positions are clamped to the screen and keep 3 decimals', () => {
  const s = sanitize({ clockX: 1.7, clockY: -4, calX: 0.123456 });
  assert.equal(s.clockX, 1);
  assert.equal(s.clockY, 0);
  assert.equal(s.calX, 0.123);
});

test('scales are clamped', () => {
  const s = sanitize({ clockScale: 99, widgetsScale: 0.01 });
  assert.equal(s.clockScale, 2.5);
  assert.equal(s.widgetsScale, 0.6);
});

test('widgetsMonitor only accepts primary or an index (no follow-cursor)', () => {
  assert.equal(sanitize({ widgetsMonitor: '1' }).widgetsMonitor, '1');
  assert.equal(sanitize({ widgetsMonitor: 'cursor' }).widgetsMonitor, 'primary');
  assert.equal(sanitize({ widgetsMonitor: '../x' }).widgetsMonitor, 'primary');
});

test('note text must be a string and is capped', () => {
  assert.equal(sanitize({ noteText: 42 }).noteText, DEFAULTS.noteText);
  assert.equal(sanitize({ noteText: 'x'.repeat(5000) }).noteText.length, NOTE_MAX);
  assert.equal(sanitize({ noteText: '' }).noteText, '');
});

test('garbage input never throws', () => {
  assert.deepEqual(sanitize(null), { ...DEFAULTS });
  assert.deepEqual(sanitize('nope'), { ...DEFAULTS });
  assert.deepEqual(sanitize({ clockX: 'abc', widgets: 'yes' }).clockX, 0.5);
});

test('resetLayout only moves widgets back, nothing else', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'islet-')), 's.json');
  const store = new Store(file);
  store.set({ clockX: 0.2, clockY: 0.9, noteX: 0.7, clockStyle: 'line', shape: 'square' });
  store.resetLayout();
  const s = store.get();
  for (const k of POSITION_KEYS) assert.equal(s[k], DEFAULTS[k], k);
  assert.equal(s.clockStyle, 'line');
  assert.equal(s.shape, 'square');
  store.flush();
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).clockStyle, 'line');
});
