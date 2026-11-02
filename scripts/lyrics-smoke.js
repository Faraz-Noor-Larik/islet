// Live check against LRCLIB, used by CI. Not part of the unit tests (it needs the internet).
const { fetchLyrics } = require('../src/main/lyrics');

(async () => {
  const a = await fetchLyrics({ title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', duration: 200 });
  const b = await fetchLyrics({ title: 'Eminem - Lose Yourself (Official Music Video)', artist: 'EminemVEVO', album: '', duration: 0 });
  const sample = a.lines.find((l) => l.text) || {};
  console.log(
    `::notice title=lyrics-smoke::spotify-style=${a.status}/${a.lines.length} youtube-style=${b.status}/${b.lines.length} sample=${JSON.stringify(sample)}`,
  );
})();
