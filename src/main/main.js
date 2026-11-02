'use strict';

const path = require('path');
const { app, BrowserWindow, Tray, Menu, screen, ipcMain, nativeImage } = require('electron');
const { Store } = require('./settings');
const position = require('./positioning');
const { MediaReader } = require('./media');
const { Timeline } = require('./timeline');
const { fetchLyrics } = require('./lyrics');

const SMOKE = process.env.ISLET_SMOKE === '1'; // CI: start, check the windows load, quit
const ASSETS = path.join(__dirname, '..', 'assets');
const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, 'preload.js');

let store;
let island = null;
let settingsWin = null;
let tray = null;
let moveMode = false;
let userHidden = false;
let fullscreenNow = false;
let lastDisplayId = null;
let lastCursorKey = '';
let drag = null;

const timeline = new Timeline();
let mediaState = { status: 'none', track: null, pos: 0, at: Date.now(), duration: 0 };
let lyricsState = { key: null, status: 'none', lines: [] };
const lyricsCache = new Map();
const reader = new MediaReader();

/* ------------------------------------------------------------------ helpers */

function broadcast(channel, payload) {
  for (const win of [island, settingsWin]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function currentDisplay() {
  const s = store.get();
  return position.resolveDisplay(
    {
      displays: screen.getAllDisplays(),
      primary: screen.getPrimaryDisplay(),
      cursorDisplay: screen.getDisplayNearestPoint(screen.getCursorScreenPoint()),
    },
    s.monitor,
  );
}

function applyBounds() {
  if (!island || island.isDestroyed() || drag) return;
  const display = currentDisplay();
  lastDisplayId = display.id;
  const bounds = position.computeBounds(display.bounds, store.get());
  island.setBounds(bounds);
  island.setBounds(bounds); // second call fixes size drift when crossing monitors with different scaling
}

function updateVisibility() {
  if (!island || island.isDestroyed()) return;
  const s = store.get();
  const shouldShow = !userHidden && !(fullscreenNow && s.hideInFullscreen);
  if (shouldShow && !island.isVisible()) island.showInactive();
  if (!shouldShow && island.isVisible()) island.hide();
}

/* ---------------------------------------------------------------- windows */

function createIsland() {
  const s = store.get();
  const { width, height } = position.windowSize(s.scale);
  island = new BrowserWindow({
    width,
    height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: s.alwaysOnTop,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  island.setAlwaysOnTop(s.alwaysOnTop, 'screen-saver');
  island.setIgnoreMouseEvents(true, { forward: true }); // clicks pass straight through to whatever is underneath
  island.loadFile(path.join(RENDERER, 'island', 'index.html'));
  island.once('ready-to-show', () => {
    applyBounds();
    updateVisibility();
  });
  island.on('closed', () => {
    island = null;
  });
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 440,
    height: 720,
    minWidth: 380,
    minHeight: 480,
    title: 'Islet',
    backgroundColor: '#101113',
    autoHideMenuBar: true,
    icon: path.join(ASSETS, 'tray.png'),
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(RENDERER, 'settings', 'index.html'));
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ASSETS, 'tray.png')).resize({ width: 32, height: 32 });
  tray = new Tray(icon);
  tray.setToolTip('Islet');
  tray.on('click', openSettings);
  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Settings…', click: openSettings },
      { label: 'Move the island', type: 'checkbox', checked: moveMode, click: (item) => setMoveMode(item.checked) },
      { label: 'Hide the island', type: 'checkbox', checked: userHidden, click: (item) => {
        userHidden = item.checked;
        updateVisibility();
      } },
      { type: 'separator' },
      { label: 'Quit Islet', click: () => app.quit() },
    ]),
  );
}

function setMoveMode(on) {
  moveMode = Boolean(on);
  if (island && !island.isDestroyed()) {
    // while moving, the island must catch the mouse; otherwise it is always click-through
    island.setIgnoreMouseEvents(!moveMode, { forward: true });
  }
  if (moveMode) {
    userHidden = false;
    updateVisibility();
  }
  broadcast('mode:move', moveMode);
  rebuildTrayMenu();
}

/* ------------------------------------------------------- settings changes */

function applySettings(prev) {
  const s = store.get();
  if (island && !island.isDestroyed()) {
    if (!prev || prev.alwaysOnTop !== s.alwaysOnTop) island.setAlwaysOnTop(s.alwaysOnTop, 'screen-saver');
    applyBounds();
    updateVisibility();
  }
  if (app.isPackaged && (!prev || prev.startWithWindows !== s.startWithWindows)) {
    app.setLoginItemSettings({ openAtLogin: s.startWithWindows });
  }
  broadcast('settings:changed', s);
}

/* ------------------------------------------------------------- media + lyrics */

async function loadLyrics(track, duration) {
  const key = track.key;
  if (lyricsCache.has(key)) {
    lyricsState = { key, ...lyricsCache.get(key) };
    broadcast('lyrics:data', lyricsState);
    return;
  }
  lyricsState = { key, status: 'loading', lines: [] };
  broadcast('lyrics:data', lyricsState);
  const result = await fetchLyrics({ title: track.rawTitle, artist: track.rawArtist, album: track.album, duration });
  if (lyricsCache.size > 100) lyricsCache.delete(lyricsCache.keys().next().value);
  lyricsCache.set(key, result);
  if (mediaState.track && mediaState.track.key === key) {
    lyricsState = { key, ...result };
    broadcast('lyrics:data', lyricsState);
  }
}

function onSample(sample) {
  const wasFullscreen = fullscreenNow;
  fullscreenNow = Boolean(sample.fs);
  if (fullscreenNow !== wasFullscreen) updateVisibility();

  const { send, trackChanged, hasTrack, state } = timeline.update(sample);
  if (!send) return;
  mediaState = state;
  broadcast('media:state', mediaState);
  if (trackChanged) {
    if (hasTrack) {
      loadLyrics(state.track, state.duration);
    } else {
      lyricsState = { key: null, status: 'none', lines: [] };
      broadcast('lyrics:data', lyricsState);
    }
  }
}

/* ------------------------------------------------------------------- IPC */

function registerIpc() {
  ipcMain.handle('state:get', () => ({ settings: store.get(), media: mediaState, lyrics: lyricsState, moveMode }));
  ipcMain.handle('settings:get', () => store.get());
  ipcMain.handle('settings:set', (_e, patch) => {
    const prev = store.get();
    store.set(patch);
    applySettings(prev);
    return store.get();
  });
  ipcMain.handle('settings:reset', () => {
    const prev = store.get();
    store.reset();
    applySettings(prev);
    return store.get();
  });
  ipcMain.handle('displays:get', () => {
    const primaryId = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((d, i) => ({
      index: i,
      primary: d.id === primaryId,
      width: Math.round(d.size.width * d.scaleFactor),
      height: Math.round(d.size.height * d.scaleFactor),
    }));
  });

  ipcMain.on('mode:move', (_e, on) => setMoveMode(on));
  ipcMain.on('settings:open', openSettings);
  ipcMain.on('app:quit', () => app.quit());

  // drag-to-place: the cursor position is read here (not from the page) so it's correct on any monitor
  ipcMain.on('drag:start', () => {
    if (!island || !moveMode) return;
    drag = { cursor: screen.getCursorScreenPoint(), bounds: island.getBounds() };
  });
  ipcMain.on('drag:move', () => {
    if (!island || !drag) return;
    const c = screen.getCursorScreenPoint();
    island.setPosition(drag.bounds.x + c.x - drag.cursor.x, drag.bounds.y + c.y - drag.cursor.y);
  });
  ipcMain.on('drag:end', () => {
    if (!island || !drag) return;
    const b = island.getBounds();
    drag = null;
    const display = screen.getDisplayNearestPoint({ x: b.x + Math.round(b.width / 2), y: b.y + 20 });
    const patch = position.offsetsFromBounds(display.bounds, b);
    const s = store.get();
    if (display.id !== lastDisplayId && s.monitor !== 'cursor') {
      patch.monitor = String(screen.getAllDisplays().findIndex((d) => d.id === display.id));
    }
    const prev = s;
    store.set(patch);
    applySettings(prev);
  });
}

/* ------------------------------------------------------------------ boot */

function startBackgroundTimers() {
  // Hover detection: the island is click-through, so instead of mouse events we watch the cursor.
  setInterval(() => {
    if (!island || island.isDestroyed() || !island.isVisible()) return;
    const p = screen.getCursorScreenPoint();
    const b = island.getBounds();
    const inside = p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
    const rel = inside ? { x: p.x - b.x, y: p.y - b.y } : null;
    const key = rel ? `${rel.x},${rel.y}` : 'out';
    if (key !== lastCursorKey) {
      lastCursorKey = key;
      island.webContents.send('cursor', rel);
    }
  }, 90);

  // "Follow cursor" monitor mode
  setInterval(() => {
    if (store.get().monitor !== 'cursor' || drag) return;
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    if (d.id !== lastDisplayId) applyBounds();
  }, 700);
}

function runSmokeCheck() {
  const log = (m) => console.log(`[smoke] ${m}`);
  let failed = false;
  const fail = (why) => {
    failed = true;
    console.log(`SMOKE_FAIL ${why}`);
  };
  island.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3) fail(`renderer error: ${message}`);
  });
  island.webContents.on('render-process-gone', (_e, d) => fail(`renderer gone: ${d.reason}`));
  island.webContents.on('preload-error', (_e, p, err) => fail(`preload error: ${err && err.message}`));
  setTimeout(async () => {
    try {
      const probe = await island.webContents.executeJavaScript(
        `JSON.stringify({ api: typeof window.islet?.getState, island: !!document.getElementById('island'), shape: document.documentElement.className })`,
      );
      log(`island probe ${probe}`);
      const parsed = JSON.parse(probe);
      if (parsed.api !== 'function' || !parsed.island) fail(`island probe failed ${probe}`);
      openSettings();
      setTimeout(async () => {
        try {
          const sp = await settingsWin.webContents.executeJavaScript(
            `JSON.stringify({ api: typeof window.islet?.getState, controls: document.querySelectorAll('[data-key]').length })`,
          );
          log(`settings probe ${sp}`);
          const p2 = JSON.parse(sp);
          if (p2.api !== 'function' || p2.controls < 10) fail(`settings probe failed ${sp}`);
        } catch (e) {
          fail(`settings probe threw ${e.message}`);
        }
        if (!failed) console.log('SMOKE_OK');
        app.exit(failed ? 1 : 0);
      }, 2500);
    } catch (e) {
      fail(`probe threw ${e.message}`);
      app.exit(1);
    }
  }, 3000);
}

function boot() {
  Menu.setApplicationMenu(null);
  store = new Store(path.join(app.getPath('userData'), 'settings.json'));
  store.load();
  registerIpc();
  createIsland();
  createTray();
  startBackgroundTimers();

  screen.on('display-added', applyBounds);
  screen.on('display-removed', applyBounds);
  screen.on('display-metrics-changed', applyBounds);

  reader.on('sample', onSample);
  reader.on('log', (m) => console.log(`[reader] ${m}`));
  reader.on('unsupported', () => console.log('[reader] media reading needs Windows'));
  reader.start();

  if (store.get().startWithWindows && app.isPackaged) app.setLoginItemSettings({ openAtLogin: true });
  if (SMOKE) runSmokeCheck();
}

const gotLock = SMOKE || app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', openSettings);
  app.on('window-all-closed', () => {
    /* tray app: keep running */
  });
  app.on('before-quit', () => {
    reader.stop();
    if (store) store.flush();
  });
  app.whenReady().then(boot);
}
