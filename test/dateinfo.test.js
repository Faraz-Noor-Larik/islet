'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/renderer/widgets/dateinfo');

test('dayOfYear', () => {
  assert.equal(D.dayOfYear(new Date(2026, 0, 1)), 1);
  assert.equal(D.dayOfYear(new Date(2026, 1, 13)), 44);
  assert.equal(D.dayOfYear(new Date(2026, 11, 31)), 365);
  assert.equal(D.dayOfYear(new Date(2028, 11, 31)), 366); // leap year
});

test('isoWeek matches known dates', () => {
  assert.equal(D.isoWeek(new Date(2026, 1, 13)), 7); // 13 Feb 2026 is week 7
  assert.equal(D.isoWeek(new Date(2026, 0, 1)), 1);
  assert.equal(D.isoWeek(new Date(2021, 0, 3)), 53); // Sunday that still belongs to 2020's last week
  assert.equal(D.isoWeek(new Date(2024, 11, 30)), 1); // Monday that already belongs to 2025's week 1
  assert.equal(D.isoWeek(new Date(2026, 10, 2)), 45);
});

test('clockParts 24h and 12h', () => {
  assert.deepEqual(D.clockParts(new Date(2026, 0, 1, 5, 2, 41), false), { h: '05', m: '02', s: '41', ampm: '' });
  assert.deepEqual(D.clockParts(new Date(2026, 0, 1, 17, 2, 41), true), { h: '05', m: '02', s: '41', ampm: 'PM' });
  assert.equal(D.clockParts(new Date(2026, 0, 1, 0, 5, 0), true).h, '12');
  assert.equal(D.clockParts(new Date(2026, 0, 1, 0, 5, 0), true).ampm, 'AM');
  assert.equal(D.clockParts(new Date(2026, 0, 1, 12, 0, 0), true).ampm, 'PM');
});

test('monthGrid is always 6x7 and starts on the right weekday', () => {
  // November 2026 starts on a Sunday
  const mon = D.monthGrid(2026, 10, 'mon');
  assert.equal(mon.length, 6);
  assert.ok(mon.every((r) => r.length === 7));
  assert.deepEqual(mon[0], [null, null, null, null, null, null, 1]);
  const sun = D.monthGrid(2026, 10, 'sun');
  assert.deepEqual(sun[0], [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(mon.flat().filter((x) => x !== null).length, 30);
  assert.equal(D.monthGrid(2028, 1, 'mon').flat().filter((x) => x !== null).length, 29); // leap Feb
});

test('weekday labels and weekend columns follow the week start', () => {
  assert.deepEqual(D.weekdayInitials('mon'), ['M', 'T', 'W', 'T', 'F', 'S', 'S']);
  assert.deepEqual(D.weekdayInitials('sun'), ['S', 'M', 'T', 'W', 'T', 'F', 'S']);
  assert.deepEqual(D.weekendColumns('mon'), [5, 6]);
  assert.deepEqual(D.weekendColumns('sun'), [0, 6]);
});

test('progress stays within 0..1 and moves the right way', () => {
  const noon = D.progress(new Date(2026, 10, 2, 12, 0, 0), 'mon'); // a Monday
  assert.equal(noon.day, 0.5);
  assert.ok(Math.abs(noon.week - 0.5 / 7) < 1e-9);
  const sundayNight = D.progress(new Date(2026, 10, 1, 23, 59, 59), 'mon');
  assert.ok(sundayNight.week > 0.99 && sundayNight.week <= 1);
  const start = D.progress(new Date(2026, 0, 1, 0, 0, 0), 'mon');
  assert.equal(start.year, 0);
  assert.equal(start.day, 0);
});
