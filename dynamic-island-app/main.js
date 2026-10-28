const { app, BrowserWindow, ipcMain, screen, powerMonitor, nativeTheme, globalShortcut, shell, net } = require('electron');
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
// ISLAND_USERDATA 可以指到别处：自检 / 同时开两份时用，不影响日常数据
app.setPath('userData', process.env.ISLAND_USERDATA || path.join(app.getPath('appData'), 'desk-island'));
boot('userData=' + app.getPath('userData'));

const WIN_W = 440;
const WIN_H = 500;
const TOP_OFFSET = 8;      // 岛与屏幕顶部的距离，必须和 style.css 的 .stage padding-top 一致

// 显隐感应参数
const PEEK_W = 120;        // 顶部感应带宽度（屏幕中央 ±60）
const PEEK_H = 8;          // 感应带高度
const PEEK_DELAY = 240;    // 悬停多久才把岛放出来
const OVER_DELAY = 100;    // 光标进岛多久才接管鼠标（防误触，快速划过不拦截）
const LEAVE_DELAY = 1200;  // 光标离开多久自动收起
const AUTO_IDLE_MIN = 1;   // 智能模式：键鼠停多久（分钟）就自动显示
const HIDE_FAST = 400;     // 自动显示出来的岛，用户一动就快速收回

let win = null;
let todos = [];
let settings = { workMinutes: 45, autostart: true, sound: true, presenceMode: 'smart', idleMin: 1, autoIdle: true, draggable: false, winPos: null };

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
  let dirty = false;
  if (!settings.presenceMode) {
    settings.presenceMode = settings.autoHide === false ? 'always' : 'smart';
    dirty = true;
  }
  if ('autoHide' in settings) { delete settings.autoHide; dirty = true; }
  // 单位从秒改成分钟（1.2.1）：旧的 15 秒按 1 分钟算，不够一分钟也保底 1
  if (settings.idleMin == null) {
    settings.idleMin = settings.idleSec ? Math.max(1, Math.round(settings.idleSec / 60)) : AUTO_IDLE_MIN;
    dirty = true;
  }
  if ('idleSec' in settings) { delete settings.idleSec; dirty = true; }
  if (dirty) saveSettings();   // 迁移结果落盘，别每次启动都算一遍
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
// 把窗口位置夹到屏幕内，保证岛本体不会被拖出可视区
function clampWinPos(x, y) {
  const area = screen.getDisplayNearestPoint({
    x: Math.round(x + WIN_W / 2),
    y: Math.round(y + WIN_H / 2)
  }).workArea;
  const minX = area.x - islandBox.x;
  const maxX = area.x + area.width - islandBox.x - islandBox.w;
  const minY = area.y - islandBox.y + 2;
  const maxY = area.y + area.height - 60;
  return {
    x: Math.round(Math.min(Math.max(x, minX), maxX)),
    y: Math.round(Math.min(Math.max(y, minY), maxY))
  };
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const defX = Math.round(workArea.x + (workArea.width - WIN_W) / 2);
  const defY = workArea.y;   // 贴屏幕顶，细线才能落在 y=0
  const saved = settings.draggable && settings.winPos
    ? clampWinPos(settings.winPos.x, settings.winPos.y)
    : null;
  const x = saved ? saved.x : defX;
  const y = saved ? saved.y : defY;

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
        // 设了 ISLAND_UPDATE_MOCK 时顺便走一遍 IPC，验证手动检查的返回值
        const chk = process.env.ISLAND_UPDATE_MOCK
          ? 'chk: JSON.stringify(await window.islandAPI.checkUpdate()),'
          : '';
        const info = await win.webContents.executeJavaScript(
          `(async () => ({ ${chk}
              api: typeof window.islandAPI,
              cls: document.getElementById('island').className,
              text: document.getElementById('cText').textContent,
              todos: document.querySelectorAll('.todo').length,
              uDot: document.getElementById('uDot').className,
              ver: document.getElementById('verInfo').textContent,
              bounds: [window.outerWidth, window.outerHeight] }))()`
        );
        console.log('SELFTEST ' + JSON.stringify(info));
        try {
          console.log('FILE ' + fs.readFileSync(todosFile(), 'utf8').replace(/\s+/g, ' '));
        } catch (e) { console.log('FILE_ERR ' + e.message); }
      } catch (e) { console.log('SELFTEST_ERR ' + e.message); }
      setTimeout(() => app.quit(), 200);
    });
  }

  // 拖拽自检：走完整条 IPC 链，验证窗口真的被移动、位置被记住
  if (process.env.ISLAND_DRAGTEST) {
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 1200));
      const before = win.getPosition();
      const r = await win.webContents.executeJavaScript(`(async () => {
        window.islandAPI.dragStart();
        for (let i = 1; i <= 6; i++) {
          window.islandAPI.dragMove({ dx: 30 * i, dy: 40 * i });
          await new Promise(r => setTimeout(r, 20));
        }
        window.islandAPI.dragEnd();
        await new Promise(r => setTimeout(r, 120));
        return { settings: await window.islandAPI.getState().then(s => s.settings) };
      })()`);
      await new Promise((r) => setTimeout(r, 400));
      const after = win.getPosition();
      console.log('DRAGTEST ' + JSON.stringify({
        before, after,
        dx: after[0] - before[0], dy: after[1] - before[1],
        saved: r.settings && r.settings.winPos,
        draggable: r.settings && r.settings.draggable
      }));
      setTimeout(() => app.quit(), 200);
    });
  }

  // 提醒态自检：真实计时到点弹提醒（智能模式），量按钮位置，再由外部脚本发真点击
  if (process.env.ISLAND_ALERTTEST) {
    win.webContents.once('did-finish-load', async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      await sleep(1500);
      settings.presenceMode = 'smart';
      settings.autoIdle = true;
      settings.workMinutes = 1;
      idleOverride = 0;            // 假装一直在动电脑：不该自动弹出，只能靠提醒钉住
      workSec = 0;
      alerted = false;
      const wb0 = win.getBounds();
      // 「好的」按钮在窗口内的中心约 (392, 42)：只有提醒态 420px 宽时才落在岛里
      testPoint = { x: wb0.x + 392, y: wb0.y + 42 };   // 注入假光标，别被真人动鼠标干扰
      fs.writeFileSync(path.join(os.tmpdir(), 'island-alerttest-pre.json'), JSON.stringify({
        win: wb0, parkAt: { x: wb0.x + 392, y: wb0.y + 42 }
      }));
      console.log('ALERTTEST_ARMED 等 60 秒到点');

      const t0 = Date.now();
      while (!alerted && Date.now() - t0 < 80000) await sleep(200);
      if (!alerted) { console.log('ALERTTEST_TIMEOUT'); app.quit(); return; }
      const tAlert = Date.now();
      console.log('ALERTTEST_FIRED at ' + (tAlert - t0) + 'ms');
      // 提醒弹出的头 1.5 秒里，每 50ms 记一次 presence：
      // near = 窗口还在穿透（点不到），over = 已接管鼠标
      const marks = [];
      for (let k = 0; k < 30; k++) {
        const wbx = win.getBounds();
        const ib = { x: wbx.x + islandBox.x, y: wbx.y + islandBox.y, w: islandBox.w, h: islandBox.h };
        const cur = cursorPoint();
        marks.push((Date.now() - tAlert) + 'ms:' + presence + ':' + islandBox.x + ',' + islandBox.w +
          ':cur=' + cur.x + ',' + cur.y + ':on=' + inBox(cur, ib, 2));
        await sleep(50);
      }
      console.log('ALERTTEST_RAMP ' + marks.join(' '));
      await sleep(300);

      const info = await win.webContents.executeJavaScript(`(() => {
        const i = document.getElementById('island');
        const b = document.getElementById('btnDismiss').getBoundingClientRect();
        return {
          cls: i.className,
          island: { x: i.offsetLeft, y: i.offsetTop, w: i.offsetWidth, h: i.offsetHeight },
          btn: { x: b.x, y: b.y, w: b.width, h: b.height }
        };
      })()`);

      const wb = win.getBounds();
      const bc = {
        x: Math.round(info.btn.x + info.btn.w / 2),
        y: Math.round(info.btn.y + info.btn.h / 2)
      };
      const btnScreen = { x: wb.x + bc.x, y: wb.y + bc.y };
      const reported = {
        x: wb.x + islandBox.x, y: wb.y + islandBox.y, w: islandBox.w, h: islandBox.h
      };
      fs.writeFileSync(path.join(os.tmpdir(), 'island-alerttest.json'), JSON.stringify({
        clsBefore: info.cls,
        islandInWindow: info.island,
        reportedScreen: reported,
        btnCenterInWindow: bc,
        btnCenterOnScreen: btnScreen,
        onIslandByBox: inBox(btnScreen, reported, 2),
        presenceAtReady: presence
      }));
      console.log('ALERTTEST_READY ' + JSON.stringify({
        btnScreen, reported, onIsland: inBox(btnScreen, reported, 2), presence
      }));

      const t1 = Date.now();
      let last = '';
      const iv = setInterval(() => {
        const line = presence + '|' + alerted;
        if (line !== last) {
          last = line;
          console.log('ALERTTEST_STATE t=' + (Date.now() - t1) + ' presence=' + presence + ' alerted=' + alerted);
        }
      }, 100);
      ipcMain.on('alert:dismiss', () => console.log('ALERTTEST_DISMISS t=' + (Date.now() - t1)));
      setTimeout(() => { clearInterval(iv); app.quit(); }, 14000);
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

// 智能模式的门槛：键鼠停多久（分钟）才把岛放出来
function idleThreshold() {
  const n = Number(settings.idleMin);
  return (Number.isFinite(n) && n > 0 ? n : AUTO_IDLE_MIN) * 60;
}

function pollPresence() {
  if (!win || win.isDestroyed()) return;

  const now = Date.now();

  const mode = settings.presenceMode || 'smart';
  const keepOpen = pinForever || now < pinnedUntil;

  const pt = cursorPoint();
  const b = win.getBounds();
  const centerX = b.x + WIN_W / 2;

  const floating = !!settings.draggable;   // 可拖拽：自由摆放，常显，不认顶部细线
  const island = { x: b.x + islandBox.x, y: b.y + islandBox.y, w: islandBox.w, h: islandBox.h };
  const onIsland = inBox(pt, island, 2);
  const inPeek = !floating && pt.y >= b.y - 2 && pt.y <= b.y + PEEK_H && Math.abs(pt.x - centerX) <= PEEK_W / 2;

  // 该不该自动出现：可拖拽 / 常驻 / 钉住 / 智能模式（键鼠停了就在当前页面显现）
  let autoShow = false;
  if (floating || mode === 'always' || keepOpen) {
    autoShow = true;
  } else if (mode === 'smart') {
    // autoIdle 关掉后，智能模式就退化成"只认悬停"——停手不再自动弹出
    autoShow = settings.autoIdle !== false && idleSeconds() >= idleThreshold();
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
  // 被钉住的时候（起身提醒没处理 / 输入框聚焦）不留这个延迟，否则提醒刚弹出那一下点不动
  if (onIsland) {
    leaveAt = 0; peekAt = 0;
    if (presence === 'over') return;
    if (!enterAt) enterAt = now;
    if (now - enterAt >= (keepOpen ? 0 : OVER_DELAY)) { enterAt = 0; setPresence('over'); }
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
    [4000, () => { settings.presenceMode = 'smart'; idleOverride = 0; }, '智能-动电脑'],
    [5200, () => { idleOverride = 120; }, '智能-静默2分钟'],
    [6400, () => { idleOverride = 0; }, '智能-又开始动'],
    [7600, () => { idleOverride = 120; }, '智能-再次静默'],
    [8800, () => { idleOverride = 0; }, '智能-再次操作']
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

// ---------- 版本检查与自动更新 ----------
// 安装版走 electron-updater：真下载、真安装，支持块级差量（只下变化的块）。
// 免安装版是把 exe 解压到临时目录运行的，没有可替换的安装位置，自动更新对它无效，
// 只能退化成"提示 + 跳浏览器"。
const UPDATE_REPO = 'hhpsilence/to-do-reminder';
const UPDATE_PAGE = `https://github.com/${UPDATE_REPO}/releases/latest`;
const CHECK_GAP = 6 * 3600 * 1000;    // 自动检查间隔
const CHECK_RETRY = 30 * 60 * 1000;   // 检查失败多久后重试
const CHECK_TIMEOUT = 8000;

const UPDATE_MODE = (app.isPackaged && !isPortable) ? 'auto' : 'manual';

// idle → checking → available → downloading → ready
// 任一步失败进 error（只在用户已经知道有新版本时才提示）
let upd = { mode: UPDATE_MODE, status: 'idle', version: '', percent: 0, error: '' };
let checkedAt = 0;
let checking = false;
let autoUpdater = null;

function pushUpdate(patch) {
  upd = Object.assign({}, upd, patch);
  send('update', upd);
}

// 安装版：把 electron-updater 的事件翻译成 upd 状态
function initAutoUpdater() {
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    boot('updater require failed: ' + e.message);
    return false;
  }

  autoUpdater.autoDownload = true;          // 有新版就在后台悄悄下
  autoUpdater.autoInstallOnAppQuit = true;  // 用户不点重启，下次退出时也会装上
  autoUpdater.disableWebInstaller = true;   // 不用 web 安装器，省一次没必要的探测
  autoUpdater.logger = {
    info: (m) => boot('updater ' + m),
    warn: (m) => boot('updater WARN ' + m),
    error: (m) => boot('updater ERR ' + m),
    debug: () => {}
  };

  autoUpdater.on('checking-for-update', () => pushUpdate({ status: 'checking', error: '' }));

  autoUpdater.on('update-available', (info) => {
    boot('updater available ' + info.version);
    pushUpdate({ status: 'available', version: info.version, percent: 0, error: '' });
  });

  autoUpdater.on('update-not-available', () => {
    checkedAt = Date.now();
    pushUpdate({ status: 'idle', version: '', percent: 0, error: '' });
  });

  autoUpdater.on('download-progress', (p) => {
    pushUpdate({ status: 'downloading', percent: Math.round((p && p.percent) || 0) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    boot('updater downloaded ' + info.version);
    pushUpdate({ status: 'ready', version: info.version, percent: 100, error: '' });
  });

  autoUpdater.on('error', (e) => {
    const msg = String((e && e.message) || e);
    boot('updater error ' + msg);
    if (upd.status === 'available' || upd.status === 'downloading') {
      pushUpdate({ status: 'error', error: '下载失败，稍后重试' });
    } else {
      // 检查阶段失败就是网络不通，安静跳过，30 分钟后再试
      pushUpdate({ status: 'idle' });
    }
  });

  return true;
}

// "1.2.10" > "1.2.9"；带 -beta 之类的后缀一律先砍掉
function cmpVersion(a, b) {
  const norm = (v) => String(v || '').replace(/^v/i, '').split('-')[0]
    .split('.').map((n) => parseInt(n, 10) || 0);
  const x = norm(a), y = norm(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// 免安装版 / 开发态：只查 GitHub Release 的 tag，不下载
async function checkManual() {
  const res = await net.fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
    headers: {
      'User-Agent': 'DeskIsland/' + app.getVersion(),
      'Accept': 'application/vnd.github+json'
    },
    signal: AbortSignal.timeout(CHECK_TIMEOUT)
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const rel = await res.json();
  const latest = String(rel.tag_name || rel.name || '').replace(/^v/i, '');
  boot(`update local=${app.getVersion()} remote=${latest}`);
  if (cmpVersion(latest, app.getVersion()) > 0) {
    pushUpdate({ status: 'available', version: latest, percent: 0, error: '' });
  } else {
    pushUpdate({ status: 'idle', version: '', percent: 0, error: '' });
  }
  checkedAt = Date.now();
}

async function checkUpdate(force) {
  if (checking) return upd;
  if (!force && checkedAt && Date.now() - checkedAt < CHECK_GAP) return upd;
  checking = true;
  try {
    const mock = process.env.ISLAND_UPDATE_MOCK;   // 调试用：假装远端有新版
    if (mock) {
      pushUpdate({ status: 'available', version: String(mock).replace(/^v/i, ''), percent: 0, error: '' });
      checkedAt = Date.now();
    } else if (UPDATE_MODE === 'auto' && autoUpdater) {
      await autoUpdater.checkForUpdates();         // 结果走事件
    } else {
      await checkManual();
    }
  } catch (e) {
    boot('update check failed: ' + ((e && e.message) || e));
    if (upd.status === 'checking') pushUpdate({ status: 'idle' });
  } finally {
    checking = false;
  }
  return upd;
}

// 自己排下一次：成功过就 6 小时，失败过就 30 分钟
function scheduleUpdateCheck(delay) {
  setTimeout(async () => {
    if (!win || win.isDestroyed()) return;
    await checkUpdate(false);
    scheduleUpdateCheck(checkedAt ? CHECK_GAP : CHECK_RETRY);
  }, delay);
}

// ---------- 专注计时 ----------
function startTicker() {
  setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const idle = idleSeconds();   // 秒；走 idleSeconds() 才能被自检注入假值
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
      boot('alert fired total=' + total);
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
  pollPresence();   // 立刻按新状态算一次，别等下一轮 60ms 轮询
});

// 快捷键唤出后短暂停留，避免鼠标不在岛上立刻被收起
ipcMain.on('presence:hold', (_e, ms) => {
  pinnedUntil = Date.now() + (Number(ms) || 0);
});

// ---------- 可拖拽模式 ----------
// 渲染层只报屏幕位移，主进程按"按下那一刻的窗口位置"平移，避免逐帧累积误差
let dragOrigin = null;

ipcMain.on('drag:start', () => {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  dragOrigin = { x, y };
});

ipcMain.on('drag:move', (_e, d) => {
  if (!win || win.isDestroyed() || !dragOrigin || !d) return;
  const p = clampWinPos(dragOrigin.x + (Number(d.dx) || 0), dragOrigin.y + (Number(d.dy) || 0));
  win.setPosition(p.x, p.y);
});

ipcMain.on('drag:end', () => {
  dragOrigin = null;
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  settings.winPos = { x, y };
  saveSettings();
});

// 切回「固定顶部」：窗口挪回屏幕顶部中央
ipcMain.on('drag:reset', () => {
  if (!win || win.isDestroyed()) return;
  const { workArea } = screen.getPrimaryDisplay();
  win.setPosition(
    Math.round(workArea.x + (workArea.width - WIN_W) / 2),
    workArea.y
  );
  settings.winPos = null;
  saveSettings();
  setPresence('idle');
});

ipcMain.handle('state:get', () => ({
  todos, settings, workSec, alerted,
  version: app.getVersion(),
  update: upd
}));

// 手动检查（设置页点版本号），绕过节流
ipcMain.handle('update:check', async () => {
  await checkUpdate(true);
  return { ok: upd.status !== 'error', state: upd };
});

// 点岛上的提示：下好了就重启安装，否则打开 Release 页面
ipcMain.on('update:act', () => {
  if (upd.status === 'ready' && autoUpdater) {
    boot('updater quitAndInstall');
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return;
  }
  const url = upd.version
    ? `https://github.com/${UPDATE_REPO}/releases/tag/v${upd.version}`
    : UPDATE_PAGE;
  shell.openExternal(url).catch((e) => boot('openExternal failed: ' + e.message));
});

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
  if ('presenceMode' in (patch || {}) || 'draggable' in (patch || {})) {
    leaveAt = 0; peekAt = 0; enterAt = 0;
    // 可拖拽模式常显，直接进入 near，别先缩回细线
    const showNow = settings.draggable || settings.presenceMode === 'always';
    setPresence(showNow ? 'near' : 'idle');
  }
  return settings;
});

ipcMain.on('alert:dismiss', () => {
  boot('alert dismiss');
  workSec = 0; alerted = false;
});
ipcMain.on('alert:snooze', () => {
  boot('alert snooze');
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

    // 安装版才有真正的自动更新；免安装版只做版本提示
    if (UPDATE_MODE === 'auto') initAutoUpdater();
    boot('update mode=' + UPDATE_MODE + ' version=' + app.getVersion());

    // 启动 8 秒后再查版本，别跟开屏抢网络；调试模式提前到 0.5 秒
    scheduleUpdateCheck(process.env.ISLAND_UPDATE_MOCK ? 500 : 8000);
  });

  app.on('window-all-closed', () => { boot('EVENT all-windows-closed'); app.quit(); });
  app.on('before-quit', () => boot('EVENT before-quit'));
  app.on('will-quit', () => { boot('EVENT will-quit'); globalShortcut.unregisterAll(); });
}
