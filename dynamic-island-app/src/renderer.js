/* ================= 灵动岛 渲染层 ================= */
const api = window.islandAPI || createMock();

let state = {
  todos: [],
  settings: { workMinutes: 45, autostart: true, sound: true, presenceMode: 'smart', idleSec: 15, autoIdle: true },
  workSec: 0,
  total: 45 * 60,
  idle: 0,
  active: true,
  alerted: false,
  version: '1.2.0',
  update: null          // { mode, status, version, percent, error }
};

let ui = 'collapsed';     // collapsed | alert | open
let view = 'list';        // list | settings
let preview = false;      // 手动试提醒时，屏蔽真实计时状态的干扰

const $ = (id) => document.getElementById(id);
const island = $('island');
const stage = $('stage');

/* ---------- 工具 ---------- */
const pad = (n) => String(n).padStart(2, '0');
const mmss = (sec) => {
  const s = Math.max(0, Math.round(sec));
  return pad(Math.floor(s / 60)) + ':' + pad(s % 60);
};

function todayLabel() {
  const d = new Date();
  const w = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 ${w}`;
}

/* ---------- 提示音 ---------- */
let audioCtx = null;
function chime() {
  if (!state.settings.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    [[880, 0], [1174.7, 0.18]].forEach(([freq, delay]) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + delay);
      gain.gain.linearRampToValueAtTime(0.16, now + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.7);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + delay);
      osc.stop(now + delay + 0.75);
    });
  } catch (_) { /* 忽略音频异常 */ }
}

/* ---------- 渲染 ---------- */
function renderCollapsed() {
  const pending = state.todos.filter(t => !t.done);
  let text;
  if (state.todos.length === 0) text = '点我添加待办';
  else if (pending.length === 0) text = '今天都完成了';
  else {
    text = `${pending.length} 项待办`;
    const first = pending[0].text.trim();
    if (first) text += ` · ${first}`;
  }
  $('cText').textContent = text;
  $('cClock').textContent = mmss(state.total - state.workSec);
}

function renderTodos() {
  const list = $('todoList');
  list.innerHTML = '';
  state.todos.forEach(t => {
    const li = document.createElement('li');
    li.className = 'todo' + (t.done ? ' done' : '');

    const cb = document.createElement('span');
    cb.className = 'cb';
    cb.textContent = '✓';
    cb.addEventListener('click', (e) => { e.stopPropagation(); toggleTodo(t.id); });

    const tx = document.createElement('span');
    tx.className = 'tx';
    tx.textContent = t.text;
    tx.addEventListener('click', (e) => { e.stopPropagation(); toggleTodo(t.id); });

    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '×';
    del.title = '删除';
    del.addEventListener('click', (e) => { e.stopPropagation(); removeTodo(t.id); });

    li.append(cb, tx, del);
    list.appendChild(li);
  });

  const empty = $('emptyTip');
  const isEmpty = state.todos.length === 0;
  empty.classList.toggle('show', isEmpty);
  list.style.display = isEmpty ? 'none' : 'flex';

  const pending = state.todos.filter(t => !t.done).length;
  $('listTitle').textContent = state.todos.length
    ? `今天 · ${pending} 件待办`
    : '今天 · 暂无待办';
  $('listDate').textContent = todayLabel();
}

function renderSit() {
  const total = state.total || 1;
  const left = Math.max(0, total - state.workSec);
  const pct = Math.min(100, (state.workSec / total) * 100);

  $('sitValue').textContent = `${mmss(state.workSec)} / ${mmss(total)}`;
  const bar = $('sitBar');
  bar.style.width = pct + '%';
  bar.classList.toggle('warn', left <= 300);

  let hint;
  if (state.idle >= 180) hint = '检测到你已经离开，计时已重置';
  else if (left <= 0) hint = '该起身了';
  else hint = `再过 ${Math.ceil(left / 60)} 分钟提醒你起身`;
  $('sitHint').textContent = hint;
}

function renderSettings() {
  const min = Number(state.settings.workMinutes) || 45;
  $('presets').querySelectorAll('button').forEach(b => {
    b.classList.toggle('on', Number(b.dataset.min) === min);
  });
  $('swSound').classList.toggle('on', !!state.settings.sound);
  $('swAutostart').classList.toggle('on', !!state.settings.autostart);
  const mode = state.settings.presenceMode || 'smart';
  $('modes').querySelectorAll('button').forEach(b => {
    b.classList.toggle('on', b.dataset.mode === mode);
  });

  // 停手自动显示：只对智能模式有意义
  const autoIdle = state.settings.autoIdle !== false;
  $('swIdle').classList.toggle('on', autoIdle);
  const idleInput = $('idleInput');
  if (document.activeElement !== idleInput) {
    idleInput.value = String(Number(state.settings.idleSec) || 15);
  }
  idleInput.disabled = !autoIdle;
  $('rowIdle').classList.toggle('off', mode !== 'smart');
}

function renderAll() {
  renderCollapsed();
  renderTodos();
  renderSit();
  renderSettings();
  renderUpdate();
}

/* ---------- 版本提示 ---------- */
// status: idle | checking | available | downloading | ready | error
function renderUpdate() {
  const u = state.update || {};
  const st = u.status || 'idle';
  const show = st === 'available' || st === 'downloading' || st === 'ready';

  $('uDot').classList.toggle('show', show);

  const chip = $('updChip');
  chip.classList.toggle('show', show);
  if (st === 'available') chip.textContent = 'v' + u.version + ' ↑';
  else if (st === 'downloading') chip.textContent = (u.percent || 0) + '%';
  else if (st === 'ready') chip.textContent = '重启更新';

  const v = $('verInfo');
  v.classList.toggle('has-new', show);
  if (st === 'ready') v.textContent = `v${u.version} 已就绪 · 点此重启`;
  else if (show) v.textContent = `v${state.version} → v${u.version}`;
  else v.textContent = `v${state.version}`;

  v.title = st === 'ready' ? '重启并安装新版本'
    : show ? (u.mode === 'auto' ? '正在后台下载，点此查看' : '有新版本，点击打开下载页')
    : '点击检查更新';
}

/* ---------- 状态切换 ---------- */
function setUI(next) {
  ui = next;
  island.classList.remove('is-collapsed', 'is-alert', 'is-open');
  island.classList.add('is-' + next);
  if (next === 'open') {
    view = 'list';
    island.classList.remove('is-settings');
    $('viewList').classList.remove('hidden');
    $('viewSettings').classList.add('hidden');
  }
  // 尺寸变了，立刻告诉主进程新的可点击范围
  reportRect();
  setTimeout(reportRect, 460);
}

/* 把岛在窗口内的矩形上报给主进程，用于判断光标是否落在岛上 */
function reportRect() {
  if (!island.offsetWidth) return;
  try {
    api.setIslandRect({
      x: island.offsetLeft,
      y: island.offsetTop,
      w: island.offsetWidth,
      h: island.offsetHeight
    });
  } catch (_) {}
}

function setView(next) {
  view = next;
  island.classList.toggle('is-settings', next === 'settings');
  $('viewList').classList.toggle('hidden', next !== 'list');
  $('viewSettings').classList.toggle('hidden', next !== 'settings');
  if (next === 'settings') renderSettings();
  reportRect();
  setTimeout(reportRect, 460);
}

/* ---------- 待办操作 ---------- */
async function persist() {
  try { await api.saveTodos(state.todos); } catch (_) {}
}

function toggleTodo(id) {
  const t = state.todos.find(x => x.id === id);
  if (!t) return;
  t.done = !t.done;
  renderTodos();
  renderCollapsed();
  persist();
}

function removeTodo(id) {
  state.todos = state.todos.filter(x => x.id !== id);
  renderTodos();
  renderCollapsed();
  persist();
}

function addTodo(text) {
  const v = (text || '').trim();
  if (!v) return;
  state.todos.push({ id: String(Date.now()) + Math.random().toString(16).slice(2, 6), text: v, done: false, createdAt: Date.now() });
  renderTodos();
  renderCollapsed();
  persist();
}

/* ---------- 交互绑定 ---------- */
island.addEventListener('click', (e) => {
  if (e.target.closest('button') || e.target.closest('input')) return;
  if (e.target.closest('.todo')) return;
  if (ui === 'open') setUI('collapsed');
  else if (ui === 'collapsed') setUI('open');
});

$('btnSettings').addEventListener('click', (e) => { e.stopPropagation(); setView('settings'); });
$('btnBack').addEventListener('click', (e) => { e.stopPropagation(); setView('list'); });

$('btnDismiss').addEventListener('click', (e) => {
  e.stopPropagation();
  preview = false;
  pinReasons.delete('alert');
  syncPin();
  api.dismissAlert();
  state.workSec = 0;
  state.alerted = false;
  renderSit();
  renderCollapsed();
  setUI('collapsed');
});

$('btnSnooze').addEventListener('click', (e) => {
  e.stopPropagation();
  preview = false;
  pinReasons.delete('alert');
  syncPin();
  api.snoozeAlert();
  state.workSec = Math.max(0, state.total - 300);
  state.alerted = false;
  renderSit();
  renderCollapsed();
  setUI('collapsed');
});

const input = $('todoInput');
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    addTodo(input.value);
    input.value = '';
  } else if (e.key === 'Escape') {
    input.blur();
    setUI('collapsed');
  }
});
input.addEventListener('click', (e) => e.stopPropagation());

$('presets').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.settings.workMinutes = Number(b.dataset.min);
  state.total = state.settings.workMinutes * 60;
  state.workSec = 0;
  renderSettings();
  renderSit();
  renderCollapsed();
  await api.saveSettings({ workMinutes: state.settings.workMinutes });
});

$('swSound').addEventListener('click', async (e) => {
  e.stopPropagation();
  state.settings.sound = !state.settings.sound;
  renderSettings();
  await api.saveSettings({ sound: state.settings.sound });
});

$('swAutostart').addEventListener('click', async (e) => {
  e.stopPropagation();
  state.settings.autostart = !state.settings.autostart;
  renderSettings();
  await api.saveSettings({ autostart: state.settings.autostart });
});

$('modes').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  e.stopPropagation();
  state.settings.presenceMode = b.dataset.mode;
  renderSettings();
  stage.classList.remove('is-away');
  await api.saveSettings({ presenceMode: state.settings.presenceMode });
});

// 停手秒数：手动填，回车或失焦时落盘；范围 3～600 秒
const IDLE_MIN = 3, IDLE_MAX = 600;
function commitIdleSec() {
  const raw = parseInt($('idleInput').value, 10);
  const sec = Number.isFinite(raw) ? Math.min(IDLE_MAX, Math.max(IDLE_MIN, raw)) : 15;
  state.settings.idleSec = sec;
  $('idleInput').value = String(sec);
  api.saveSettings({ idleSec: sec });
}

$('idleInput').addEventListener('click', (e) => e.stopPropagation());
$('idleInput').addEventListener('focus', (e) => {
  e.target.select();
  pinReasons.add('input'); syncPin();
});
$('idleInput').addEventListener('blur', () => {
  commitIdleSec();
  pinReasons.delete('input'); syncPin();
});
$('idleInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.target.blur(); }
  else if (e.key === 'Escape') { e.target.value = String(Number(state.settings.idleSec) || 15); e.target.blur(); }
});

$('swIdle').addEventListener('click', async (e) => {
  e.stopPropagation();
  state.settings.autoIdle = !(state.settings.autoIdle !== false);
  renderSettings();
  await api.saveSettings({ autoIdle: state.settings.autoIdle });
});

$('btnTest').addEventListener('click', (e) => {
  e.stopPropagation();
  preview = true;
  setUI('alert');
  chime();
});

// 有新版 → 下好了就重启安装，没下好就开浏览器；已是最新 → 手动查一次
$('updChip').addEventListener('click', (e) => {
  e.stopPropagation();
  api.updateAction();
});

$('verInfo').addEventListener('click', async (e) => {
  e.stopPropagation();
  const st = (state.update && state.update.status) || 'idle';
  if (st === 'available' || st === 'downloading' || st === 'ready') {
    api.updateAction();
    return;
  }
  const el = $('verInfo');
  const back = () => setTimeout(renderUpdate, 2200);
  el.textContent = '检查中…';
  let r = null;
  try { r = await api.checkUpdate(); } catch (_) { r = null; }
  if (!r || !r.ok) {
    el.textContent = '检查失败，稍后再试';
    back();
    return;
  }
  state.update = r.state || null;
  renderUpdate();
  if (!state.update || state.update.status === 'idle') {
    el.textContent = `v${state.version} · 已是最新`;
    back();
  }
});

$('btnQuit').addEventListener('click', (e) => {
  e.stopPropagation();
  api.quit();
});

/* ---------- 显隐：由主进程的光标轮询驱动 ---------- */
function applyPresence(next) {
  // idle 时只留顶部细线；near 时岛已展开但鼠标仍穿透
  stage.classList.toggle('is-away', next === 'idle');
  if (next === 'idle') {
    stage.classList.remove('is-wake');
    // 藏起来之前先收回列表，下次唤出是紧凑态
    if (ui === 'open' && !preview) setUI('collapsed');
  }
}

if (api.onPresence) api.onPresence(applyPresence);

// 鼠标停在细线上、还没到展开时间：细线变亮，给个"再等一下"的反馈
if (api.onWake) api.onWake((on) => stage.classList.toggle('is-wake', !!on));

// Ctrl+Alt+D 唤出：直接展开清单
if (api.onSummon) {
  api.onSummon(() => {
    stage.classList.remove('is-away');
    setUI('open');
    setTimeout(() => input.focus(), 260);
  });
}

// 键盘正在输入、或起身提醒还没处理时，别让岛自己藏起来
const pinReasons = new Set();
function syncPin() {
  if (api.pin) api.pin(pinReasons.size > 0);
}
input.addEventListener('focus', () => { pinReasons.add('input'); syncPin(); });
input.addEventListener('blur', () => { pinReasons.delete('input'); syncPin(); });

/* ---------- 计时回调 ---------- */
api.onTick((data) => {
  state.workSec = data.workSec;
  state.total = data.total;
  state.idle = data.idle;
  state.active = data.active;

  renderSit();
  renderCollapsed();

  if (data.alerted) {
    if (ui !== 'alert') {
      preview = true;
      setUI('alert');
      chime();
      pinReasons.add('alert');
      syncPin();
    }
  } else if (!preview && ui === 'alert') {
    setUI('collapsed');
  }
});

/* ---------- 启动 ---------- */
(async function boot() {
  const s = await api.getState();
  if (s) {
    state.todos = s.todos || [];
    state.settings = Object.assign(state.settings, s.settings || {});
    state.workSec = s.workSec || 0;
    state.total = (state.settings.workMinutes || 45) * 60;
    state.alerted = !!s.alerted;
    state.version = s.version || state.version;
    state.update = s.update || null;
  }
  renderAll();
  setUI('collapsed');
  reportRect();
  setTimeout(reportRect, 300);
  window.addEventListener('resize', reportRect);

  // 供设计预览 / 截图用，支持逗号叠加：#open,update
  const hash = location.hash.replace('#', '').split(',').filter(Boolean);
  if (hash.length) stage.classList.remove('is-away');
  if (hash.includes('open')) setUI('open');
  if (hash.includes('settings')) { setUI('open'); setView('settings'); }
  if (hash.includes('alert')) { preview = true; setUI('alert'); }
  if (hash.includes('away')) { stage.classList.add('is-away'); }
  if (hash.includes('wake')) { stage.classList.add('is-away', 'is-wake'); }
  if (hash.includes('update') || hash.includes('ready')) {
    state.update = hash.includes('ready')
      ? { mode: 'auto', status: 'ready', version: '1.3.0', percent: 100 }
      : { mode: 'auto', status: 'available', version: '1.3.0', percent: 0 };
    renderUpdate();
  }
})();

// 主进程查到新版本会推过来
if (api.onUpdate) {
  api.onUpdate((info) => {
    state.update = info || null;
    renderUpdate();
  });
}

/* ================= 浏览器内预览用的假接口 ================= */
function createMock() {
  const KEY = 'island-mock';
  let data = { todos: [], settings: { workMinutes: 45, autostart: true, sound: true, presenceMode: 'smart', idleSec: 15, autoIdle: true }, workSec: 1920 };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) data = Object.assign(data, saved);
  } catch (_) {}

  if (!data.todos.length) {
    data.todos = [
      { id: '1', text: '回复张工的接口联调邮件', done: true, createdAt: Date.now() },
      { id: '2', text: '提交 Activiti 流程分支的补丁', done: false, createdAt: Date.now() },
      { id: '3', text: '下午站会前过一遍达梦迁移脚本', done: false, createdAt: Date.now() }
    ];
  }

  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (_) {} };
  let tickCb = null;

  setInterval(() => {
    if (data.workSec < data.settings.workMinutes * 60) data.workSec += 1;
    if (tickCb) tickCb({
      workSec: data.workSec,
      total: data.settings.workMinutes * 60,
      idle: 0,
      active: true,
      alerted: false
    });
  }, 1000);

  return {
    getState: async () => ({
      todos: data.todos,
      settings: data.settings,
      workSec: data.workSec,
      alerted: false,
      version: '1.2.0',
      update: null
    }),
    saveTodos: async (list) => { data.todos = list; save(); return list; },
    saveSettings: async (patch) => { Object.assign(data.settings, patch); save(); return data.settings; },
    dismissAlert: () => { data.workSec = 0; },
    snoozeAlert: () => { data.workSec = Math.max(0, data.settings.workMinutes * 60 - 300); },
    setIslandRect: () => {},
    pin: () => {},
    hold: () => {},
    quit: () => {},
    checkUpdate: async () => ({ ok: true, state: { status: 'idle' } }),
    updateAction: () => {},
    onTick: (cb) => { tickCb = cb; },
    onPresence: () => {},
    onWake: () => {},
    onSummon: () => {},
    onUpdate: () => {}
  };
}
