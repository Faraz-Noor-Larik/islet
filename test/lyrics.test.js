const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLrc, cleanTrack, pickBest, fetchLyrics } = require('../src/main/lyrics');

test('parseLrc reads timestamps, multiple stamps and skips metadata', () => {
  const lines = parseLrc('[ar:Someone]\n[00:12.50] Hello\n[00:05.00][01:00.25] Echo\n[00:30] \n');
  assert.deepEqual(lines.map((l) => [l.t, l.text]), [[5, 'Echo'], [12.5, 'Hello'], [30, ''], [60.25, 'Echo']]);
});

test('parseLrc handles 3-digit fractions and garbage', () => {
  assert.equal(parseLrc('[01:02.345] x')[0].t, 62.345);
  assert.deepEqual(parseLrc(null), []);
  assert.deepEqual(parseLrc('no stamps here'), []);
});

test('cleanTrack strips video junk and Topic suffix', () => {
  const r = cleanTrack('Blinding Lights (Official Video) [4K]', 'The Weeknd - Topic');
  assert.equal(r.display.title, 'Blinding Lights');
  assert.equal(r.display.artist, 'The Weeknd');
  assert.equal(r.candidates[0].track, 'Blinding Lights');
});

test('cleanTrack splits "Artist - Song" from YouTube titles', () => {
  const r = cleanTrack('Eminem - Lose Yourself (Official Music Video)', 'EminemVEVO');
  assert.equal(r.candidates[0].artist, 'Eminem');
  assert.equal(r.candidates[0].track, 'Lose Yourself');
  const r2 = cleanTrack('Daft Punk - One More Time', '');
  assert.equal(r2.display.artist, 'Daft Punk');
  assert.equal(r2.display.title, 'One More Time');
});

test('cleanTrack drops feat. for searching but keeps display', () => {
  const r = cleanTrack('Song (feat. Someone)', 'Main Artist, Someone');
  assert.equal(r.candidates[0].track, 'Song');
  assert.equal(r.candidates[0].artist, 'Main Artist');
});

test('pickBest prefers the closest duration and rejects far ones', () => {
  const res = [{ syncedLyrics: 'a', duration: 300 }, { syncedLyrics: 'b', duration: 201 }, { plainLyrics: 'x' }];
  assert.equal(pickBest(res, 200).syncedLyrics, 'b');
  assert.equal(pickBest(res, 100), null);
  assert.equal(pickBest(res, 0).syncedLyrics, 'a');
  assert.equal(pickBest([], 10), null);
});

test('fetchLyrics: exact hit, fallback search, and never throws', async () => {
  const ok = async (url) => ({ ok: true, json: async () => (url.includes('/get?') ? { syncedLyrics: '[00:01.00] hi' } : []) });
  const r = await fetchLyrics({ title: 'T', artist: 'A', album: '', duration: 100 }, { fetchImpl: ok });
  assert.equal(r.status, 'found');
  assert.equal(r.lines[0].text, 'hi');

  const searchOnly = async (url) => ({ ok: !url.includes('/get?'), json: async () => [{ syncedLyrics: '[00:02.00] yo', duration: 100 }] });
  const r2 = await fetchLyrics({ title: 'T', artist: 'A', album: '', duration: 100 }, { fetchImpl: searchOnly });
  assert.equal(r2.lines[0].text, 'yo');

  const boom = async () => { throw new Error('offline'); };
  assert.deepEqual(await fetchLyrics({ title: 'T', artist: 'A' }, { fetchImpl: boom }), { status: 'none', lines: [] });
});
