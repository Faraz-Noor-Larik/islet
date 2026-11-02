# Islet

A floating music island for Windows plus a set of desktop widgets. The island lives at the
top-centre of your screen and shows what you're listening to with live synced lyrics. In the middle of
the screen sits a fixed flip clock with calendar, time-passing bars and a sticky note around it. None of
it blocks a click.

## Widgets

- **Clock**, pinned to the exact centre and never moves. Flip (with a real flip animation), stacked or
  line. Date, weekday, week and day of the year around it.
- **Calendar**, **time passing** (today / this week / this year) and a **sticky note**.
- Widgets sit *on the desktop*: above the wallpaper and icons, underneath your windows. They are
  click-through. **Ctrl+Alt+W** lifts them above everything for six seconds. Or choose "above everything".
- **Arrange widgets** (tray menu): drag them around with snapping guides, type in the note.
  Settings also has text colour (white / black), widget size, note colour, week start and screen.

## Island

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
| Pins the widget layer just above the desktop | `src/main/zorder.js` |
| Widgets (clock, calendar, note...) | `src/renderer/widgets/` |
| The island and the settings UI | `src/renderer/` |
