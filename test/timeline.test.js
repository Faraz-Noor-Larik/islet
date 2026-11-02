const test = require('node:test');
const assert = require('node:assert/strict');
const { Timeline } = require('../src/main/timeline');

const S = (o) => ({ status: 'playing', title: 'Song', artist: 'Artist', album: '', pos: 0, end: 200, app: 'Spotify', ...o });

test('no media -> none, nothing playing', () => {
  const t = new Timeline();
  const r = t.update({ status: 'none' }, 1000);
  assert.equal(r.state.status, 'none');
  assert.equal(r.state.track, null);
  assert.equal(r.hasTrack, false);
});

test('extrapolates when the player never ticks, and only sends on real changes', () => {
  const t = new Timeline();
  const a = t.update(S({ pos: 10 }), 0);
  assert.ok(a.send && a.trackChanged);
  // same reported pos 30 s later: player doesn't tick, we extrapolate
  const b = t.update(S({ pos: 10 }), 30000);
  assert.equal(Math.round(b.state.pos), 40);
  assert.equal(b.send, false); // renderer extrapolates identically, no message needed
});

test('a seek is sent', () => {
  const t = new Timeline();
  t.update(S({ pos: 10 }), 0);
  const r = t.update(S({ pos: 90 }), 2000);
  assert.ok(r.send);
  assert.equal(Math.round(r.state.pos), 90);
});

test('pause freezes at the extrapolated position, resume continues', () => {
  const t = new Timeline();
  t.update(S({ pos: 0 }), 0);
  const p = t.update(S({ pos: 0, status: 'paused' }), 20000);
  assert.ok(p.send);
  assert.equal(Math.round(p.state.pos), 20);
  const still = t.update(S({ pos: 0, status: 'paused' }), 50000);
  assert.equal(Math.round(still.state.pos), 20);
  assert.equal(still.send, false);
  const r = t.update(S({ pos: 0, status: 'playing' }), 60000);
  assert.ok(r.send);
  const later = t.update(S({ pos: 0, status: 'playing' }), 65000);
  assert.equal(Math.round(later.state.pos), 25);
});

test('track change resets and flags', () => {
  const t = new Timeline();
  t.update(S({ pos: 100 }), 0);
  const r = t.update(S({ title: 'Other', pos: 0 }), 1000);
  assert.ok(r.trackChanged && r.send);
  assert.equal(r.state.track.title, 'Other');
});

test('position is clamped to the duration', () => {
  const t = new Timeline();
  t.update(S({ pos: 190, end: 200 }), 0);
  assert.equal(t.update(S({ pos: 190, end: 200 }), 60000).state.pos, 200);
});

test('stopped / closed counts as none', () => {
  const t = new Timeline();
  t.update(S(), 0);
  assert.equal(t.update(S({ status: 'stopped' }), 1000).state.status, 'none');
});
