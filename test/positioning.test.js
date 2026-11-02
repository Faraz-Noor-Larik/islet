const test = require('node:test');
const assert = require('node:assert/strict');
const pos = require('../src/main/positioning');
const { sanitize, DEFAULTS } = require('../src/main/settings');

const screen1080 = { x: 0, y: 0, width: 1920, height: 1080 };

test('top-centre by default', () => {
  const b = pos.computeBounds(screen1080, DEFAULTS);
  assert.equal(b.x + b.width / 2, 960);
  assert.equal(b.y, DEFAULTS.y);
});

test('offsets move it and the window never leaves the screen', () => {
  const b = pos.computeBounds(screen1080, { ...DEFAULTS, x: 5000, y: 5000 });
  assert.ok(b.x + b.width <= 1920 && b.y + b.height <= 1080);
  const l = pos.computeBounds(screen1080, { ...DEFAULTS, x: -5000 });
  assert.equal(l.x, 0);
});

test('works on a second monitor with an origin offset', () => {
  const second = { x: 1920, y: -200, width: 2560, height: 1440 };
  const b = pos.computeBounds(second, { ...DEFAULTS, y: 0 });
  assert.equal(b.y, -200);
  assert.equal(Math.round(b.x + b.width / 2), 1920 + 1280);
});

test('scale changes window size', () => {
  assert.ok(pos.windowSize(1.5).width > pos.windowSize(1).width);
});

test('offsetsFromBounds is the inverse and snaps near centre', () => {
  const s = { ...DEFAULTS, x: 240, y: 37 };
  const b = pos.computeBounds(screen1080, s);
  assert.deepEqual(pos.offsetsFromBounds(screen1080, b), { x: 240, y: 37 });
  const near = pos.computeBounds(screen1080, { ...DEFAULTS, x: 9 });
  assert.equal(pos.offsetsFromBounds(screen1080, near).x, 0);
});

test('resolveDisplay', () => {
  const a = { id: 1 }, b = { id: 2 }, c = { id: 3 };
  const ctx = { displays: [a, b], primary: a, cursorDisplay: c };
  assert.equal(pos.resolveDisplay(ctx, 'primary'), a);
  assert.equal(pos.resolveDisplay(ctx, 'cursor'), c);
  assert.equal(pos.resolveDisplay(ctx, '1'), b);
  assert.equal(pos.resolveDisplay(ctx, '7'), a);
});

test('settings sanitize clamps and rejects junk', () => {
  const s = sanitize({ scale: 99, opacity: 0, shape: 'blob', monitor: 'x', radius: -4, hover: 'fade', showTime: 0, x: 'abc', lyricsOffset: 99999 });
  assert.equal(s.scale, 1.8);
  assert.equal(s.opacity, 0.4);
  assert.equal(s.shape, 'pill');
  assert.equal(s.monitor, 'primary');
  assert.equal(s.radius, 0);
  assert.equal(s.hover, 'fade');
  assert.equal(s.showTime, false);
  assert.equal(s.x, 0);
  assert.equal(s.lyricsOffset, 3000);
  assert.equal(sanitize({ radius: null }, { ...DEFAULTS, radius: 20 }).radius, null);
});
