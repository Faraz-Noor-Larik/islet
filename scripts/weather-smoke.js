'use strict';

// CI: asks the real Open-Meteo service for a forecast and reports it as a GitHub annotation.
const { fetchWeather } = require('../src/main/weather');

(async () => {
  const w = await fetchWeather({ city: 'Karachi', unit: 'c' });
  if (w.ok) {
    console.log(`::notice title=weather-smoke::${w.city} ${w.temp}C ${w.label}, next days: ${w.days.map((d) => `${d.date} ${d.lo}-${d.hi} ${d.label}`).join('; ')}`);
  } else {
    console.log(`::error title=weather-smoke::${w.error}`);
  }
})();
