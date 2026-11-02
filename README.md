# Islet

A minimal floating island for Windows that lives at the top-centre of your screen. It shows the
time, what you're listening to, and live synced lyrics. It never blocks a click.

- **Music from anything**: it reads the same Windows media session as the volume flyout, so Spotify,
  YouTube in the browser, Apple Music, VLC and so on all work. No logins, no API keys.
- **Synced lyrics** from [LRCLIB](https://lrclib.net). Some songs simply have none; then it shows the
  title and artist instead.
- **Yours to shape**: pill, rounded, notch or square, a custom corner radius, size, opacity,
  light / dark / auto.
- **Spatial awareness**:
  - X / Y offsets, pick a screen, or follow the mouse between screens
  - drag it into place anywhere (tray menu, then *Move the island*)
  - open, fade away, or ignore the mouse when it comes near
  - hides itself in fullscreen apps and games

Right-click the tray icon (near the clock) for Settings, Move, Hide and Quit.

## Build

```
npm install
npm start          # run it
npm test           # unit tests
npm run dist       # Windows installer in ./release
```

The GitHub Actions workflow builds the installer on a Windows runner and uploads it as the
`Islet-Windows` artifact.

## How it works

| Part | File |
| --- | --- |
| Media reader (one hidden PowerShell process, 2 samples a second) | `src/main/reader.ps1`, `media.js` |
| Position tracking that survives players which don't tick | `src/main/timeline.js` |
| Lyrics lookup, LRC parsing, YouTube title cleaning | `src/main/lyrics.js` |
| Placement maths (monitors, offsets, drag) | `src/main/positioning.js` |
| Windows, tray, settings | `src/main/main.js` |
| The island and the settings UI | `src/renderer/` |
