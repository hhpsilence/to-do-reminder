const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('islandAPI', {
  getState: () => ipcRenderer.invoke('state:get'),
  saveTodos: (list) => ipcRenderer.invoke('todos:save', list),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  dismissAlert: () => ipcRenderer.send('alert:dismiss'),
  snoozeAlert: () => ipcRenderer.send('alert:snooze'),
  quit: () => ipcRenderer.send('app:quit'),

  // 显隐相关
  setIslandRect: (r) => ipcRenderer.send('ui:rect', r),
  pin: (on) => ipcRenderer.send('presence:pin', on),
  hold: (ms) => ipcRenderer.send('presence:hold', ms),

  onTick: (cb) => ipcRenderer.on('tick', (_e, data) => cb(data)),
  onPresence: (cb) => ipcRenderer.on('presence', (_e, s) => cb(s)),
  onWake: (cb) => ipcRenderer.on('wake', (_e, on) => cb(on)),
  onSummon: (cb) => ipcRenderer.on('summon', () => cb())
});
