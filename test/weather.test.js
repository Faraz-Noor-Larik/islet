'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../src/main/weather');

const FORECAST = {
  current: { temperature_2m: 27.6, weather_code: 2, is_day: 1 },
  daily: {
    time: ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'],
    weather_code: [2, 0, 63, 95],
    temperature_2m_max: [31.2, 30.4, 28.9, 27.1],
    temperature_2m_min: [22.4, 21.7, 22.1, 21.9],
  },
};
const fakeFetch = (routes) => async (url) => {
  const hit = Object.entries(routes).find(([k]) => url.includes(k));
  if (!hit) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => hit[1] };
};

test('describe maps codes to a label and icon, and uses the night icons after dark', () => {
  assert.deepEqual(W.describe(0, true), { label: 'Clear', icon: 'clear' });
  assert.equal(W.describe(0, false).icon, 'moon');
  assert.equal(W.describe(2, false).icon, 'moonCloud');
  assert.equal(W.describe(63).icon, 'rain');
  assert.equal(W.describe(95).icon, 'storm');
  assert.equal(W.describe(73).icon, 'snow');
  assert.equal(W.describe(12345).icon, 'cloud');
});

test('cityFromTimeZone', () => {
  assert.equal(W.cityFromTimeZone('Asia/Karachi'), 'Karachi');
  assert.equal(W.cityFromTimeZone('America/Argentina/Buenos_Aires'), 'Buenos Aires');
  assert.equal(W.cityFromTimeZone('UTC'), '');
  assert.equal(W.cityFromTimeZone(undefined), '');
});

test('urls are encoded and honour the unit', () => {
  assert.match(W.geocodeUrl('São Paulo'), /name=S%C3%A3o\+Paulo/);
  assert.match(W.forecastUrl(24.86, 67.01, 'f'), /temperature_unit=fahrenheit/);
  assert.match(W.forecastUrl(24.86, 67.01, 'c'), /temperature_unit=celsius/);
  assert.match(W.forecastUrl(24.86, 67.01, 'c'), /latitude=24.86/);
});

test('parseForecast rounds temperatures and returns the next three days', () => {
  const w = W.parseForecast(FORECAST, { name: 'Karachi', country: 'Pakistan' }, 'c');
  assert.equal(w.temp, 28);
  assert.equal(w.label, 'Partly cloudy');
  assert.equal(w.icon, 'partly');
  assert.equal(w.hi, 31);
  assert.equal(w.lo, 22);
  assert.equal(w.days.length, 3);
  assert.deepEqual(w.days.map((d) => d.icon), ['clear', 'rain', 'storm']);
  assert.equal(w.days[0].date, '2026-11-04');
  assert.throws(() => W.parseForecast({}, { name: 'x' }, 'c'), /unexpected/);
});

test('fetchWeather: geocodes once, then reuses the cached place', async () => {
  let geoCalls = 0;
  const f = async (url) => {
    if (url.includes('geocoding')) {
      geoCalls++;
      return { ok: true, json: async () => ({ results: [{ name: 'Karachi', country: 'Pakistan', latitude: 24.86, longitude: 67.01 }] }) };
    }
    return { ok: true, json: async () => FORECAST };
  };
  const cache = new Map();
  const a = await W.fetchWeather({ city: 'Karachi', unit: 'c', geoCache: cache, fetchImpl: f });
  const b = await W.fetchWeather({ city: ' karachi ', unit: 'f', geoCache: cache, fetchImpl: f });
  assert.equal(a.ok, true);
  assert.equal(a.city, 'Karachi');
  assert.equal(b.unit, 'f');
  assert.equal(geoCalls, 1);
});

test('fetchWeather never throws: unknown city, empty city, http error, network error', async () => {
  const none = await W.fetchWeather({ city: 'Nowhereville', fetchImpl: fakeFetch({ geocoding: { results: [] } }) });
  assert.equal(none.ok, false);
  assert.match(none.error, /Nowhereville/);
  assert.equal((await W.fetchWeather({ city: '  ', fetchImpl: fakeFetch({}) })).ok, false);
  assert.match((await W.fetchWeather({ city: 'x', fetchImpl: fakeFetch({}) })).error, /HTTP 404/);
  const boom = await W.fetchWeather({ city: 'x', fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepEqual(boom, { ok: false, error: 'offline' });
});
