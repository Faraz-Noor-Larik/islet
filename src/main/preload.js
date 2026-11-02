'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, cb) => {
  const handler = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('islet', {
  // state
  getState: () => ipcRenderer.invoke('state:get'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  getDisplays: () => ipcRenderer.invoke('displays:get'),
  // events from the main process
  onSettings: (cb) => on('settings:changed', cb),
  onMedia: (cb) => on('media:state', cb),
  onLyrics: (cb) => on('lyrics:data', cb),
  onCursor: (cb) => on('cursor', cb),
  onMoveMode: (cb) => on('mode:move', cb),
  onEditMode: (cb) => on('mode:edit', cb),
  // actions
  setMoveMode: (on_) => ipcRenderer.send('mode:move', Boolean(on_)),
  setEditMode: (on_) => ipcRenderer.send('mode:edit', Boolean(on_)),
  resetWidgetLayout: () => ipcRenderer.send('layout:reset'),
  dragStart: () => ipcRenderer.send('drag:start'),
  dragMove: () => ipcRenderer.send('drag:move'),
  dragEnd: () => ipcRenderer.send('drag:end'),
  openSettings: () => ipcRenderer.send('settings:open'),
  quit: () => ipcRenderer.send('app:quit'),
});
