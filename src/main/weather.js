'use strict';

// Weather from Open-Meteo (https://open-meteo.com): free, no account, no API key.

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

// WMO weather codes -> label + which icon to draw
const CODES = {
  0: ['Clear', 'clear'],
  1: ['Mostly clear', 'clear'],
  2: ['Partly cloudy', 'partly'],
  3: ['Overcast', 'cloud'],
  45: ['Fog', 'fog'],
  48: ['Freezing fog', 'fog'],
  51: ['Light drizzle', 'rain'],
  53: ['Drizzle', 'rain'],
  55: ['Heavy drizzle', 'rain'],
  56: ['Freezing drizzle', 'rain'],
  57: ['Freezing drizzle', 'rain'],
  61: ['Light rain', 'rain'],
  63: ['Rain', 'rain'],
  65: ['Heavy rain', 'rain'],
  66: ['Freezing rain', 'rain'],
  67: ['Freezing rain', 'rain'],
  71: ['Light snow', 'snow'],
  73: ['Snow', 'snow'],
  75: ['Heavy snow', 'snow'],
  77: ['Snow grains', 'snow'],
  80: ['Light showers', 'rain'],
  81: ['Showers', 'rain'],
  82: ['Heavy showers', 'rain'],
  85: ['Snow showers', 'snow'],
  86: ['Heavy snow showers', 'snow'],
  95: ['Thunderstorm', 'storm'],
  96: ['Thunderstorm, hail', 'storm'],
  99: ['Thunderstorm, hail', 'storm'],
};

function describe(code, isDay = true) {
  const hit = CODES[Number(code)];
  if (!hit) return { label: 'Unknown', icon: 'cloud' };
  let icon = hit[1];
  if (!isDay && icon === 'clear') icon = 'moon';
  if (!isDay && icon === 'partly') icon = 'moonCloud';
  return { label: hit[0], icon };
}

/** "Asia/Karachi" -> "Karachi", "America/Argentina/Buenos_Aires" -> "Buenos Aires", "UTC" -> "". */
function cityFromTimeZone(tz) {
  if (typeof tz !== 'string' || !tz.includes('/')) return '';
  return tz.split('/').pop().replace(/_/g, ' ').trim();
}

function geocodeUrl(city) {
  return `${GEO_URL}?${new URLSearchParams({ name: city, count: '1', language: 'en', format: 'json' })}`;
}

function forecastUrl(lat, lon, unit) {
  return `${FORECAST_URL}?${new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,weather_code,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    timezone: 'auto',
    forecast_days: '4',
    temperature_unit: unit === 'f' ? 'fahrenheit' : 'celsius',
  })}`;
}

async function getJson(fetchImpl, url, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctl.signal, headers: { 'User-Agent': 'Islet/0.2.0 (desktop widget)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Turns an Open-Meteo forecast response into the small object the widget draws. */
function parseForecast(json, place, unit) {
  const cur = json && json.current;
  const daily = json && json.daily;
  if (!cur || !daily || !Array.isArray(daily.time) || typeof cur.temperature_2m !== 'number') {
    throw new Error('unexpected forecast shape');
  }
  const isDay = cur.is_day !== 0;
  const now = describe(cur.weather_code, isDay);
  const days = daily.time.map((date, i) => ({
    date, // "YYYY-MM-DD" in the place's own time zone
    hi: Math.round(daily.temperature_2m_max[i]),
    lo: Math.round(daily.temperature_2m_min[i]),
    ...describe(daily.weather_code[i], true),
  }));
  return {
    ok: true,
    city: place.name,
    country: place.country || '',
    unit: unit === 'f' ? 'f' : 'c',
    temp: Math.round(cur.temperature_2m),
    isDay,
    label: now.label,
    icon: now.icon,
    hi: days[0] ? days[0].hi : null,
    lo: days[0] ? days[0].lo : null,
    days: days.slice(1, 4),
    updated: Date.now(),
  };
}

/**
 * Looks the city up (cached in `geoCache`) and fetches the forecast. Never throws:
 * resolves { ok: false, error } instead.
 */
async function fetchWeather({ city, unit = 'c', geoCache = new Map(), fetchImpl = globalThis.fetch, timeoutMs = 8000 }) {
  try {
    const name = String(city || '').trim();
    if (!name) return { ok: false, error: 'no city' };
    const key = name.toLowerCase();
    let place = geoCache.get(key);
    if (!place) {
      const geo = await getJson(fetchImpl, geocodeUrl(name), timeoutMs);
      const hit = geo && Array.isArray(geo.results) && geo.results[0];
      if (!hit) return { ok: false, error: `no place called "${name}"` };
      place = { name: hit.name, country: hit.country, latitude: hit.latitude, longitude: hit.longitude };
      geoCache.set(key, place);
    }
    const json = await getJson(fetchImpl, forecastUrl(place.latitude, place.longitude, unit), timeoutMs);
    return parseForecast(json, place, unit);
  } catch (e) {
    return { ok: false, error: e && e.name === 'AbortError' ? 'timed out' : String((e && e.message) || e) };
  }
}

module.exports = { CODES, describe, cityFromTimeZone, geocodeUrl, forecastUrl, parseForecast, fetchWeather };
