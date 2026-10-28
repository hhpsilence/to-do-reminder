const { app, BrowserWindow, ipcMain, screen, powerMonitor, nativeTheme, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');


// 免安装版（portable）启动器会把 exe 解压到临时目录再运行，
// process.execPath 指向的是那个临时副本，一退出就没了。
// 真正的启动器路径由下面两个环境变量给出。
const PORTABLE_EXE = process.env.PORTABLE_EXECUTABLE_FILE || '';
const isPortable = !!PORTABLE_EXE;

// 启动日志（排查"双击没反应"用），只保留最近一次
const BOOT_LOG = path.join(os.tmpdir(), 'desk-island-boot.log');
function boot(msg) {
  try { fs.appendFileSync(BOOT_LOG, `${new Date().toISOString()} ${msg}\n`); } catch (_) {}
}
process.on('uncaughtException', (e) => boot('UNCAUGHT ' + (e && e.stack || e)));
boot(`--- start packaged=${app.isPackaged} portable=${isPortable} exec=${process.execPath}`);
if (isPortable) boot('portable exe=' + PORTABLE_EXE);

// 开发模式与打包后共用同一份数据目录（否则打包后待办会"消失"）
app.setPath('userData', path.join(app.getPath('appData'), 'desk-island'));
boot('userData=' + app.getPath('userData'));

const WIN_W = 440;
const WIN_H = 430;
const TOP_OFFSET = 8;      // 岛与屏幕顶部的距离，必须和 style.css 的 .stage padding-top 一致

// 显隐感应参数
const PEEK_W = 120;        // 顶部感应带宽度（屏幕中央 ±60）
const PEEK_H = 8;          // 感应带高度
const PEEK_DELAY = 240;    // 悬停多久才把岛放出来
const OVER_DELAY = 100;    // 光标进岛多久才接管鼠标（防误触，快速划过不拦截）
const LEAVE_DELAY = 1200;  // 光标离开多久自动收起
const AUTO_IDLE_SEC = 15;  // 智能模式：多久没碰键鼠就自动显示
const HIDE_FAST = 400;     // 自动显示出来的岛，用户一动就快速收回
const FG_REFRESH = 600;    // 前台窗口采样间隔

let win = null;
let todos = [];
let settings = { workMinutes: 45, autostart: true, sound: true, presenceMode: 'smart' };

let workSec = 0;          // 本次连续专注秒数
let alerted = false;      // 是否已经弹过提醒（等用户处理）

// ---------- 数据存储 ----------
const dataDir = () => app.getPath('userData');
const todosFile = () => path.join(dataDir(), 'todos.json');
const settingsFile = () => path.join(dataDir(), 'settings.json');

function loadData() {
  try {
    const raw = JSON.parse(fs.readFileSync(todosFile(), 'utf8'));
    if (Array.isArray(raw)) todos = raw;
  } catch (_) { todos = []; }
  try {
    settings = Object.assign(settings, JSON.parse(fs.readFileSync(settingsFile(), 'utf8')));
  } catch (_) { /* 首次运行 */ }
  // 旧版本只有 autoHide 开关，迁移成新的三档模式
  if (!settings.presenceMode) {
    settings.presenceMode = settings.autoHide === false ? 'always' : 'smart';
  }
  delete settings.autoHide;
}

function saveTodos() {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(todosFile(), JSON.stringify(todos, null, 2), 'utf8');
  } catch (e) { console.error('保存待办失败', e); }
}

function saveSettings() {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), 'utf8');
  } catch (e) { console.error('保存设置失败', e); }
}

// ---------- 窗口 ----------
function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const x = Math.round(workArea.x + (workArea.width - WIN_W) / 2);
  const y = workArea.y;   // 贴屏幕顶，细线才能落在 y=0

  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  win.once('ready-to-show', () => {
    boot('ready-to-show');
    win.showInactive();                       // 不抢焦点
    win.setIgnoreMouseEvents(true, { forward: true });
    setPresence('idle');                      // 起来先收起成细线，不压标签栏
    startPresenceLoop();
  });

  win.on('closed', () => boot('EVENT window-closed'));
  win.webContents.on('did-fail-load', (_e, code, desc) => boot('EVENT did-fail-load ' + code + ' ' + desc));
  win.webContents.on('render-process-gone', (_e, d) => boot('EVENT render-gone ' + JSON.stringify(d)));

  // 自检模式（开发用）：打印渲染层状态后自动退出
  if (process.env.ISLAND_SELFTEST) {
    win.webContents.on('console-message', (_e, _level, message) => console.log('[renderer]', message));
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 1500));
      if (process.env.ISLAND_SELFTEST_ADD) {
        await win.webContents.executeJavaScript(
          `(() => { const i = document.getElementById('todoInput');
                    i.value = '自检待办：喝水';
                    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                    return true; })()`
        );
        await new Promise((r) => setTimeout(r, 600));
      }
      try {
        const info = await win.webContents.executeJavaScript(
          `({ api: typeof window.islandAPI,
              cls: document.getElementById('island').className,
              text: document.getElementById('cText').textContent,
              todos: document.querySelectorAll('.todo').length,
              bounds: [window.outerWidth, window.outerHeight] })`
        );
        console.log('SELFTEST ' + JSON.stringify(info));
        try {
          console.log('FILE ' + fs.readFileSync(todosFile(), 'utf8').replace(/\s+/g, ' '));
        } catch (e) { console.log('FILE_ERR ' + e.message); }
      } catch (e) { console.log('SELFTEST_ERR ' + e.message); }
      setTimeout(() => app.quit(), 200);
    });
  }

  // 截图自检：分别抓收起态和唤出态，确认透明窗口渲染正常
  if (process.env.ISLAND_SHOT) {
    const outDir = process.env.ISLAND_SHOT;
    win.webContents.once('did-finish-load', async () => {
      const shot = async (name) => {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(outDir, name + '.png'), img.toPNG());
        console.log('SHOT ' + name + ' ' + JSON.stringify(win.getBounds()));
      };
      await new Promise((r) => setTimeout(r, 1800));
      await shot('shot-idle');
      const b = win.getBounds();
      testPoint = { x: b.x + WIN_W / 2, y: b.y + 2 };
      await new Promise((r) => setTimeout(r, 1400));
      await shot('shot-near');
      setTimeout(() => app.quit(), 200);
    });
  }

  // 显示器分辨率变化时重新居中
  const recenter = () => {
    if (!win || win.isDestroyed()) return;
    const area = screen.getPrimaryDisplay().workArea;
    win.setPosition(Math.round(area.x + (area.width - WIN_W) / 2), area.y);
  };
  screen.on('display-metrics-changed', recenter);
  screen.on('display-added', recenter);
  screen.on('display-removed', recenter);
}

// ---------- 显隐状态机 ----------
// idle : 只留一条 4px 细线，鼠标完全穿透，不挡任何东西
// near : 岛已展开但仍穿透（鼠标只是路过 / 自动显示）
// over : 接管鼠标，可以点
let presence = '';          // 空值 = 尚未初始化，保证第一次 setPresence('idle') 能发出去
let presenceTimer = null;
let islandBox = { x: (WIN_W - 250) / 2, y: TOP_OFFSET, w: 250, h: 44 };  // 窗口内坐标
let peekAt = 0, enterAt = 0, leaveAt = 0;
let pinForever = false;      // 输入框聚焦 / 提醒未处理
let pinnedUntil = 0;         // 快捷键唤出的短暂停留
let shownBy = 'hover';       // 这次出现是悬停唤出的，还是自动显示的

// ---------- 前台窗口 ----------
// 用 get-windows 的 N-API 预编译二进制读当前前台窗口，判断用户是不是"回到了桌面"
let probeActive = null;      // activeWindowSync，加载失败就为 null
let fg = { app: '', title: '', desktop: false, at: 0 };

async function initForeground() {
  try {
    const mod = await import('get-windows');
    probeActive = mod.activeWindowSync;
    boot('foreground probe ready');
  } catch (e) {
    probeActive = null;
    boot('foreground probe failed: ' + e.message);
  }
}

function isDesktopWindow(w) {
  if (!w) return true;                                  // 没有前台窗口 ≈ 桌面
  const app = String((w.owner && w.owner.name) || '').toLowerCase();
  if (!app.startsWith('explorer')) return false;        // 只认 explorer.exe
  const title = String(w.title || '').trim();
  // 桌面是 Program Manager；点任务栏时标题为空。资源管理器文件夹有具体标题，不算
  return title === '' || /program manager/i.test(title);
}

function refreshForeground(now) {
  if (!probeActive || now - fg.at < FG_REFRESH) return;
  try {
    const w = probeActive();
    fg = {
      app: String((w && w.owner && w.owner.name) || ''),
      title: String((w && w.title) || ''),
      desktop: isDesktopWindow(w),
      at: now
    };
  } catch (_) {
    fg.at = now;   // 读失败就沿用上一次结果，别把状态机带崩
  }
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function setPresence(next) {
  if (next === presence) return;
  presence = next;
  // idle / near 一律穿透；只有 over 才接管鼠标
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(next !== 'over', { forward: true });
  send('presence', next);
  boot('presence ' + next);
}

function inBox(pt, b, pad) {
  return pt.x >= b.x - pad && pt.x <= b.x + b.w + pad &&
         pt.y >= b.y - pad && pt.y <= b.y + b.h + pad;
}

// 自检时用来注入假光标位置，正常运行时永远走系统光标
let testPoint = null;
function cursorPoint() {
  return testPoint || screen.getCursorScreenPoint();
}

// 自检时注入假的空闲秒数
let idleOverride = null;
function idleSeconds() {
  return idleOverride === null ? powerMonitor.getSystemIdleTime() : idleOverride;
}

function pollPresence() {
  if (!win || win.isDestroyed()) return;

  const now = Date.now();
  refreshForeground(now);

  const mode = settings.presenceMode || 'smart';
  const keepOpen = pinForever || now < pinnedUntil;

  const pt = cursorPoint();
  const b = win.getBounds();
  const centerX = b.x + WIN_W / 2;

  const island = { x: b.x + islandBox.x, y: b.y + islandBox.y, w: islandBox.w, h: islandBox.h };
  const onIsland = inBox(pt, island, 2);
  const inPeek = pt.y >= b.y - 2 && pt.y <= b.y + PEEK_H && Math.abs(pt.x - centerX) <= PEEK_W / 2;

  // 该不该自动出现：常驻 / 钉住 / 智能模式（回到桌面 或 静默够久）
  let autoShow = false;
  if (mode === 'always' || keepOpen) {
    autoShow = true;
  } else if (mode === 'smart') {
    const idle = idleSeconds();
    autoShow = fg.desktop || idle >= AUTO_IDLE_SEC;
  }

  if (presence === 'idle') {
    // 收起状态下光标划过岛的区域不算数（岛不可见，那块地方该归底下的窗口）
    if (inPeek) {
      if (!peekAt) { peekAt = now; send('wake', true); }
      if (now - peekAt >= PEEK_DELAY) {
        peekAt = 0; send('wake', false);
        shownBy = 'hover';
        setPresence('near');
      }
      return;
    }
    if (peekAt) { peekAt = 0; send('wake', false); }
    if (autoShow) { shownBy = 'auto'; setPresence('near'); }
    return;
  }

  // ---- 岛已可见 ----
  // 光标在岛上：短暂停顿后接管鼠标（防快速划过时误吞点击）
  if (onIsland) {
    leaveAt = 0; peekAt = 0;
    if (presence === 'over') return;
    if (!enterAt) enterAt = now;
    if (now - enterAt >= OVER_DELAY) { enterAt = 0; setPresence('over'); }
    return;
  }

  enterAt = 0;

  // 光标离开岛的瞬间就恢复穿透，只是视觉上先留一会儿
  if (presence === 'over') { setPresence('near'); shownBy = 'hover'; }

  // 停在顶部感应带上，不算离开
  if (inPeek) { leaveAt = 0; shownBy = 'hover'; return; }

  // 自动显示的条件还成立，就保持可见
  if (autoShow) { leaveAt = 0; return; }

  // 用户在动电脑了 → 收起。自动弹出的那种收得更快
  if (!leaveAt) leaveAt = now;
  const delay = shownBy === 'auto' ? HIDE_FAST : LEAVE_DELAY;
  if (now - leaveAt >= delay) { leaveAt = 0; setPresence('idle'); }
}

function startPresenceLoop() {
  if (presenceTimer) clearInterval(presenceTimer);
  presenceTimer = setInterval(pollPresence, 60);
}

// 自检：喂一串假光标位置，验证 idle → near → over → idle 的完整流转
function runPresenceSelftest() {
  probeActive = null;                 // 关掉真实前台采样，避免覆盖注入值
  settings.presenceMode = 'hover';    // 第一阶段：悬停模式的基础流转
  const b = win.getBounds();
  const cx = b.x + WIN_W / 2;
  const steps = [
    [300,  { x: cx, y: b.y + 500 }, '远处'],
    [700,  { x: cx, y: b.y + 2 },   '顶部细线'],
    [1300, { x: cx, y: b.y + 30 },  '岛内'],
    [2100, { x: cx, y: b.y + 500 }, '离开']
  ];
  steps.forEach(([t, p, name]) => setTimeout(() => {
    testPoint = p;
    console.log(`SELFTEST_PT ${name} (${p.x},${p.y}) presence=${presence}`);
    setTimeout(async () => {
      try {
        const cls = await win.webContents.executeJavaScript(
          `document.getElementById('stage').className + ' | ' + document.getElementById('island').className`
        );
        console.log(`SELFTEST_UI ${name} -> ${cls}`);
      } catch (e) { console.log('SELFTEST_UI_ERR ' + e.message); }
    }, 420);
  }, t));

  // 第二阶段：智能模式 —— 动电脑收起 / 静默显示 / 回到桌面显示
  const smart = [
    [4000, () => { settings.presenceMode = 'smart'; fg.desktop = false; idleOverride = 0; }, '智能-动电脑'],
    [5200, () => { idleOverride = 20; }, '智能-静默20秒'],
    [6400, () => { idleOverride = 0; }, '智能-又开始动'],
    [7600, () => { idleOverride = 0; fg.desktop = true; }, '智能-回到桌面'],
    [8800, () => { fg.desktop = false; }, '智能-打开应用']
  ];
  smart.forEach(([t, fn, name]) => setTimeout(() => {
    fn();
    setTimeout(() => console.log(`SELFTEST_SMART ${name} presence=${presence}`), 900);
  }, t));

  setTimeout(() => {
    console.log('SELFTEST_PRESENCE_DONE final=' + presence);
    app.quit();
  }, 10200);
}

// ---------- 开机自启 ----------
function applyLogin(enabled) {
  try {
    // 免安装版必须注册启动器本身，否则开机时那个临时副本早已被清掉
    const target = isPortable ? PORTABLE_EXE : process.execPath;
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: target,
      args: app.isPackaged ? [] : [app.getAppPath()]
    });
    boot('autostart ' + enabled + ' -> ' + target);
  } catch (e) { boot('autostart err ' + e.message); }
}

// ---------- 专注计时 ----------
function startTicker() {
  setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const idle = powerMonitor.getSystemIdleTime();   // 秒
    const total = Math.max(1, Number(settings.workMinutes) || 45) * 60;

    if (idle >= 180) {
      // 离开超过 3 分钟，视为已经休息过
      if (workSec > 0) workSec = 0;
      if (alerted) alerted = false;
    } else if (!alerted) {
      workSec += 1;
    }

    if (!alerted && workSec >= total) {
      alerted = true;
      workSec = total;
    }

    win.webContents.send('tick', {
      workSec,
      total,
      idle,
      alerted,
      active: idle < 180
    });
  }, 1000);
}

// ---------- IPC ----------
// 渲染层把岛的实际矩形报上来，主进程据此判断光标是否在岛上
ipcMain.on('ui:rect', (_e, r) => {
  if (r && r.w > 0 && r.h > 0) {
    islandBox = { x: r.x | 0, y: r.y | 0, w: r.w | 0, h: r.h | 0 };
  }
});

// 输入框聚焦、起身提醒未处理时钉住窗口，别让岛自己藏起来
ipcMain.on('presence:pin', (_e, on) => {
  pinForever = !!on;
  if (!on) leaveAt = 0;
});

// 快捷键唤出后短暂停留，避免鼠标不在岛上立刻被收起
ipcMain.on('presence:hold', (_e, ms) => {
  pinnedUntil = Date.now() + (Number(ms) || 0);
});

ipcMain.handle('state:get', () => ({ todos, settings, workSec, alerted }));

ipcMain.handle('todos:save', (_e, list) => {
  todos = Array.isArray(list) ? list : [];
  saveTodos();
  return todos;
});

ipcMain.handle('settings:save', (_e, patch) => {
  const before = settings.workMinutes;
  settings = Object.assign(settings, patch || {});
  saveSettings();
  if (before !== settings.workMinutes) { workSec = 0; alerted = false; }
  if ('autostart' in (patch || {})) applyLogin(!!settings.autostart);
  if ('presenceMode' in (patch || {})) {
    leaveAt = 0; peekAt = 0; enterAt = 0;
    setPresence(settings.presenceMode === 'always' ? 'near' : 'idle');
  }
  return settings;
});

ipcMain.on('alert:dismiss', () => { workSec = 0; alerted = false; });
ipcMain.on('alert:snooze', () => {
  const total = Math.max(1, Number(settings.workMinutes) || 45) * 60;
  workSec = Math.max(0, total - 300);   // 5 分钟后再提醒
  alerted = false;
});
ipcMain.on('app:quit', () => { app.quit(); });

// ---------- 生命周期 ----------
const gotLock = app.requestSingleInstanceLock();
boot('singleInstanceLock=' + gotLock);
if (!gotLock) {
  boot('quit: already running');
  app.quit();
} else {
  app.on('second-instance', () => { if (win) win.showInactive(); });

  app.whenReady().then(async () => {
    boot('ready');
    loadData();
    nativeTheme.themeSource = 'light';
    await initForeground();
    createWindow();
    boot('window created');
    startTicker();
    if (settings.autostart) applyLogin(true);

    // Ctrl+Alt+D 随时唤出（岛收起时不用靠鼠标去够顶部细线）
    try {
      const ok = globalShortcut.register('Control+Alt+D', () => {
        pinnedUntil = Date.now() + 5000;
        if (win && !win.isDestroyed()) {
          win.showInactive();
          setPresence('over');
          send('summon');
        }
      });
      boot('hotkey Ctrl+Alt+D registered=' + ok);
    } catch (e) { boot('hotkey err ' + e.message); }

    if (process.env.ISLAND_SELFTEST_PRESENCE) runPresenceSelftest();
  });

  app.on('window-all-closed', () => { boot('EVENT all-windows-closed'); app.quit(); });
  app.on('before-quit', () => boot('EVENT before-quit'));
  app.on('will-quit', () => { boot('EVENT will-quit'); globalShortcut.unregisterAll(); });
}
