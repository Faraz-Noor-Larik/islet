'use strict';

const path = require('path');
const { app, BrowserWindow, Tray, Menu, screen, ipcMain, nativeImage, globalShortcut, powerMonitor } = require('electron');
const { Store } = require('./settings');
const position = require('./positioning');
const { MediaReader } = require('./media');
const { Timeline } = require('./timeline');
const { fetchLyrics } = require('./lyrics');
const { Pinner } = require('./zorder');

const SMOKE = process.env.ISLET_SMOKE === '1'; // CI: start, check the windows load, quit
const ASSETS = path.join(__dirname, '..', 'assets');
const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, 'preload.js');

let store;
let island = null;
let layer = null; // the full-screen widget layer (clock, calendar, note...)
let settingsWin = null;
let tray = null;
let moveMode = false;
let userHidden = false;
let fullscreenNow = false;
let lastDisplayId = null;
let lastCursorKey = '';
let drag = null;
let editMode = false; // arranging widgets
let peeking = false; // widgets temporarily lifted above your windows
let peekTimer = null;
let layerRun = Promise.resolve();
let lastPin = null;

const timeline = new Timeline();
let mediaState = { status: 'none', track: null, pos: 0, at: Date.now(), duration: 0 };
let lyricsState = { key: null, status: 'none', lines: [] };
const lyricsCache = new Map();
const reader = new MediaReader();
const pinner = new Pinner();

/* ------------------------------------------------------------------ helpers */

function broadcast(channel, payload) {
  for (const win of [island, layer, settingsWin]) {
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

/* ------------------------------------------------------- widget layer */

function layerDisplay() {
  const primary = screen.getPrimaryDisplay();
  return position.resolveDisplay(
    { displays: screen.getAllDisplays(), primary, cursorDisplay: primary },
    store.get().widgetsMonitor,
  );
}

// One pixel shorter than the screen on purpose: a borderless window that covers the whole monitor
// counts as a fullscreen app (the taskbar hides, and the island would think a game is running).
function layerBounds(display) {
  const b = display.bounds;
  return { x: b.x, y: b.y, width: b.width, height: Math.max(1, b.height - 1) };
}

function createLayer() {
  layer = new BrowserWindow({
    ...layerBounds(layerDisplay()),
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
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  layer.setIgnoreMouseEvents(true); // normally the widgets never get in the way of a click
  layer.loadFile(path.join(RENDERER, 'widgets', 'index.html'));
  layer.once('ready-to-show', () => refreshLayer());
  layer.on('closed', () => {
    layer = null;
  });
}

/** Queue a re-layout of the widget layer. Runs one at a time so the async pin can't race itself. */
function refreshLayer() {
  layerRun = layerRun.then(doRefreshLayer).catch((e) => console.log(`[layer] ${e && e.message}`));
  return layerRun;
}

async function doRefreshLayer() {
  if (!layer || layer.isDestroyed()) return;
  const s = store.get();
  const hide = !s.widgets || (!editMode && s.widgetsLayer === 'top' && fullscreenNow);
  if (hide) {
    if (layer.isVisible()) layer.hide();
    return;
  }

  const b = layerBounds(layerDisplay());
  const cur = layer.getBounds();
  if (cur.x !== b.x || cur.y !== b.y || cur.width !== b.width || cur.height !== b.height) {
    layer.setBounds(b);
    layer.setBounds(b);
  }

  if (editMode) {
    // arranging: above everything, takes the mouse and the keyboard
    layer.setOpacity(1);
    layer.setFocusable(true);
    layer.setIgnoreMouseEvents(false);
    layer.setAlwaysOnTop(true, 'floating');
    layer.show();
    layer.focus();
    return;
  }

  layer.setIgnoreMouseEvents(true);
  layer.setFocusable(false);

  if (s.widgetsLayer === 'top' || peeking) {
    layer.setAlwaysOnTop(true, 'floating'); // below the island, above everything else
    layer.setOpacity(1);
    if (!layer.isVisible()) layer.showInactive();
    return;
  }

  // On the desktop: above the wallpaper and icons, underneath every window.
  const wasVisible = layer.isVisible();
  if (!wasVisible) layer.setOpacity(0); // no flash over your apps while it slips underneath them
  layer.setAlwaysOnTop(false);
  if (!wasVisible) layer.showInactive();
  lastPin = await pinner.pin(layer, { debug: SMOKE });
  console.log(`[layer] pin ${lastPin.ok ? 'ok' : 'FAILED'}: ${lastPin.detail}${lastPin.z ? ` | z: ${lastPin.z}` : ''}`);
  if (layer && !layer.isDestroyed()) layer.setOpacity(1);
}

function setEditMode(on) {
  editMode = Boolean(on);
  if (editMode) {
    peeking = false;
    clearTimeout(peekTimer);
    if (!store.get().widgets) {
      const prev = store.get();
      store.set({ widgets: true });
      applySettings(prev);
    }
  }
  broadcast('mode:edit', editMode);
  rebuildTrayMenu();
  refreshLayer();
}

/** Ctrl+Alt+W: lift the widgets above your windows for a few seconds, then put them back. */
function peekWidgets() {
  if (editMode || !store.get().widgets) return;
  clearTimeout(peekTimer);
  peeking = !peeking;
  if (peeking) {
    peekTimer = setTimeout(() => {
      peeking = false;
      refreshLayer();
    }, 6000);
  }
  refreshLayer();
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
      { type: 'separator' },
      { label: 'Show widgets', type: 'checkbox', checked: store.get().widgets, click: (item) => {
        const prev = store.get();
        store.set({ widgets: item.checked });
        applySettings(prev);
      } },
      { label: 'Arrange widgets', type: 'checkbox', checked: editMode, click: (item) => setEditMode(item.checked) },
      { label: 'Peek at widgets  (Ctrl+Alt+W)', click: peekWidgets },
      { type: 'separator' },
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
  if (!prev || prev.widgets !== s.widgets || prev.widgetsLayer !== s.widgetsLayer || prev.widgetsMonitor !== s.widgetsMonitor) {
    refreshLayer();
    rebuildTrayMenu();
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
  if (fullscreenNow !== wasFullscreen) {
    updateVisibility();
    if (store.get().widgetsLayer === 'top') refreshLayer();
  }

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
  ipcMain.handle('state:get', () => ({ settings: store.get(), media: mediaState, lyrics: lyricsState, moveMode, editMode }));
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
  ipcMain.on('mode:edit', (_e, on) => setEditMode(on));
  ipcMain.on('layout:reset', () => {
    const prev = store.get();
    store.resetLayout();
    applySettings(prev);
  });
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
  const watch = (name, win) => {
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 3) fail(`${name} renderer error: ${message}`);
    });
    win.webContents.on('render-process-gone', (_e, d) => fail(`${name} renderer gone: ${d.reason}`));
    win.webContents.on('preload-error', (_e, p, err) => fail(`${name} preload error: ${err && err.message}`));
  };
  const probe = async (name, win, expr, ok) => {
    try {
      const raw = await win.webContents.executeJavaScript(`JSON.stringify(${expr})`);
      log(`${name} probe ${raw}`);
      if (!ok(JSON.parse(raw))) fail(`${name} probe failed ${raw}`);
    } catch (e) {
      fail(`${name} probe threw ${e.message}`);
    }
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  watch('island', island);
  watch('widgets', layer);

  setTimeout(async () => {
    try {
      await probe(
        'island',
        island,
        `{ api: typeof window.islet?.getState, island: !!document.getElementById('island') }`,
        (p) => p.api === 'function' && p.island,
      );

      await layerRun; // the widgets have been placed by now
      await probe(
        'widgets',
        layer,
        `{ api: typeof window.islet?.setEditMode, flips: document.querySelectorAll('.flip').length,
           cal: document.querySelectorAll('.cal-grid span').length, bars: document.querySelectorAll('.day-track').length,
           ink: document.documentElement.dataset.ink }`,
        (p) => p.api === 'function' && p.flips >= 2 && p.cal >= 49 && p.bars === 3,
      );
      log(`widgets window visible=${layer.isVisible()} bounds=${JSON.stringify(layer.getBounds())}`);
      if (!layer.isVisible()) fail('widget layer is not visible');
      if (!lastPin || !lastPin.ok) fail(`pin to desktop failed: ${lastPin && lastPin.detail}`);

      // arrange mode on, then off again: it must come up, and go back underneath
      setEditMode(true);
      await layerRun;
      await wait(400);
      await probe('arrange', layer, `{ editing: document.documentElement.classList.contains('editing') }`, (p) => p.editing);
      setEditMode(false);
      await layerRun;
      await wait(300);
      await probe('arrange-off', layer, `{ editing: document.documentElement.classList.contains('editing') }`, (p) => !p.editing);
      if (!lastPin || !lastPin.ok) fail(`re-pin after arranging failed: ${lastPin && lastPin.detail}`);

      openSettings();
      await wait(2500);
      await probe(
        'settings',
        settingsWin,
        `{ api: typeof window.islet?.getState, controls: document.querySelectorAll('[data-key]').length }`,
        (p) => p.api === 'function' && p.controls >= 25,
      );
    } catch (e) {
      fail(`smoke threw ${e.message}`);
    }
    if (!failed) console.log('SMOKE_OK');
    app.exit(failed ? 1 : 0);
  }, 3000);
}

function boot() {
  Menu.setApplicationMenu(null);
  store = new Store(path.join(app.getPath('userData'), 'settings.json'));
  store.load();
  registerIpc();
  createIsland();
  createLayer();
  createTray();
  startBackgroundTimers();

  const onDisplays = () => {
    applyBounds();
    refreshLayer();
  };
  screen.on('display-added', onDisplays);
  screen.on('display-removed', onDisplays);
  screen.on('display-metrics-changed', onDisplays);
  // coming back from sleep or the lock screen can shuffle the window stack: put the widgets back
  powerMonitor.on('resume', refreshLayer);
  powerMonitor.on('unlock-screen', refreshLayer);
  if (!SMOKE) globalShortcut.register('Control+Alt+W', peekWidgets);

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
    pinner.stop();
    globalShortcut.unregisterAll();
    if (store) store.flush();
  });
  app.whenReady().then(boot);
}
