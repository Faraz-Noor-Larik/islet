/* Date helpers for the widgets. Plain functions, no DOM, so they can be unit-tested in Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DateInfo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY = 86400000;
  const pad2 = (n) => String(n).padStart(2, '0');
  const utc = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const daysInYear = (y) => (isLeap(y) ? 366 : 365);
  const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

  /** 1 for 1 January. */
  function dayOfYear(d) {
    return Math.round((utc(d) - Date.UTC(d.getFullYear(), 0, 1)) / DAY) + 1;
  }

  /** ISO-8601 week number (weeks start on Monday, week 1 holds the first Thursday). */
  function isoWeek(d) {
    const t = new Date(utc(d));
    const dow = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dow);
    const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
    return Math.ceil(((t.getTime() - yearStart) / DAY + 1) / 7);
  }

  function clockParts(d, hour12) {
    let h = d.getHours();
    let ampm = '';
    if (hour12) {
      ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
    }
    return { h: pad2(h), m: pad2(d.getMinutes()), s: pad2(d.getSeconds()), ampm };
  }

  /** Always 6 rows of 7 so the calendar card never changes height between months. */
  function monthGrid(year, month, weekStart) {
    const first = new Date(year, month, 1).getDay(); // 0 = Sunday
    const lead = weekStart === 'sun' ? first : (first + 6) % 7;
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let day = 1; day <= daysInMonth(year, month); day++) cells.push(day);
    while (cells.length < 42) cells.push(null);
    const rows = [];
    for (let r = 0; r < 6; r++) rows.push(cells.slice(r * 7, r * 7 + 7));
    return rows;
  }

  function weekdayInitials(weekStart) {
    const mon = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    return weekStart === 'sun' ? ['S', ...mon.slice(0, 6)] : mon;
  }

  /** Column indexes (0-based) that are Saturday / Sunday. */
  function weekendColumns(weekStart) {
    return weekStart === 'sun' ? [0, 6] : [5, 6];
  }

  /** How far through the day / week / year we are, each 0..1. */
  function progress(d, weekStart) {
    const frac = (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
    const dow = weekStart === 'sun' ? d.getDay() : (d.getDay() + 6) % 7;
    return {
      day: frac,
      week: (dow + frac) / 7,
      year: (dayOfYear(d) - 1 + frac) / daysInYear(d.getFullYear()),
    };
  }

  return { dayOfYear, isoWeek, clockParts, monthGrid, weekdayInitials, weekendColumns, progress, daysInYear, daysInMonth };
});
