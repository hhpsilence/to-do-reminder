const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('islandAPI', {
  getState: () => ipcRenderer.invoke('state:get'),
  getStats: () => ipcRenderer.invoke('stats:get'),
  // 打开起身记录详细页；day 传 'YYYY-MM-DD' 就定位到那一天
  openStats: (day) => ipcRenderer.send('stats:open', day || ''),
  minimize: () => ipcRenderer.send('win:minimize'),
  saveTodos: (list) => ipcRenderer.invoke('todos:save', list),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  dismissAlert: (isTest) => ipcRenderer.send('alert:dismiss', !!isTest),
  snoozeAlert: (isTest) => ipcRenderer.send('alert:snooze', !!isTest),
  quit: () => ipcRenderer.send('app:quit'),

  // 显隐相关
  setIslandRect: (r) => ipcRenderer.send('ui:rect', r),
  pin: (on) => ipcRenderer.send('presence:pin', on),
  hold: (ms) => ipcRenderer.send('presence:hold', ms),

  // 可拖拽模式：拖动时按屏幕位移平移窗口
  dragStart: () => ipcRenderer.send('drag:start'),
  dragMove: (d) => ipcRenderer.send('drag:move', d),
  dragEnd: () => ipcRenderer.send('drag:end'),
  resetPos: () => ipcRenderer.send('drag:reset'),

  onTick: (cb) => ipcRenderer.on('tick', (_e, data) => cb(data)),
  onPresence: (cb) => ipcRenderer.on('presence', (_e, s) => cb(s)),
  onWake: (cb) => ipcRenderer.on('wake', (_e, on) => cb(on)),
  onSummon: (cb) => ipcRenderer.on('summon', () => cb()),
  onStats: (cb) => ipcRenderer.on('stats', (_e, h) => cb(h)),
  onFocusDay: (cb) => ipcRenderer.on('stats:focusDay', (_e, k) => cb(k)),

  // 版本检查与更新
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  updateAction: () => ipcRenderer.send('update:act'),
  onUpdate: (cb) => ipcRenderer.on('update', (_e, info) => cb(info))
});
