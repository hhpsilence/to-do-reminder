/* ================= 灵动岛 渲染层 ================= */
const api = window.islandAPI || createMock();

let state = {
  todos: [],
  settings: { workMinutes: 45, autostart: true, sound: true, presenceMode: 'smart', idleMin: 5, autoIdle: true, draggable: false },
  workSec: 0,
  total: 45 * 60,
  idle: 0,
  active: true,
  alerted: false,
  history: { days: {} },   // 起身记录 { 'YYYY-MM-DD': { done, snooze, times[] } }
  version: '1.4.1',
  update: null          // { mode, status, version, percent, error }
};

let ui = 'collapsed';     // collapsed | alert | open
let view = 'list';        // list | settings | stats
let preview = false;      // 手动试提醒时，屏蔽真实计时状态的干扰
let testAlert = false;    // 这次提醒是「试一下提醒」弹的，不该记进起身记录
let alertMutedUntil = 0;  // 刚点掉提醒后的一小段时间，忽略在途的旧 tick，别又弹回来

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
  $('aTitle').textContent = `坐了 ${Math.round(total / 60)} 分钟啦`;

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
    idleInput.value = String(Number(state.settings.idleMin) || 5);
  }
  idleInput.disabled = !autoIdle;
  $('rowIdle').classList.toggle('off', mode !== 'smart');

  // 位置：固定顶部 / 可拖拽
  const free = !!state.settings.draggable;
  $('posModes').querySelectorAll('button').forEach(b => {
    b.classList.toggle('on', (b.dataset.pos === 'free') === free);
  });
  stage.classList.toggle('is-free', free);
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

/* ================= 起身记录 ================= */
const WD_MON = ['一', '二', '三', '四', '五', '六', '日'];
const WD_SUN = ['日', '一', '二', '三', '四', '五', '六'];
const statsView = { range: 'day', weekOff: 0, monthOff: 0 };
const MAX_WEEK_BACK = 52, MAX_MONTH_BACK = 13;

const pad2 = (n) => String(n).padStart(2, '0');
const hKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const hm2min = (t) => {
  const p = String(t).split(':');
  return (Number(p[0]) || 0) * 60 + (Number(p[1]) || 0);
};

function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}
// 周一为一周之始
function weekStart(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function doneOf(key) {
  const days = (state.history && state.history.days) || {};
  const v = days[key];
  return v && v.done ? v.done : 0;
}
function timesOf(key) {
  const days = (state.history && state.history.days) || {};
  const v = days[key];
  return v && Array.isArray(v.times) ? v.times : [];
}
function hLevel(n) {
  return n >= 4 ? 'hl4' : n === 3 ? 'hl3' : n === 2 ? 'hl2' : n === 1 ? 'hl1' : 'hl0';
}
// 连续天数：今天还没起身不算断，从昨天往前数
function streakDays() {
  let n = 0;
  let d = new Date();
  if (doneOf(hKey(d)) === 0) d = addDays(d, -1);
  while (n < 400 && doneOf(hKey(d)) > 0) { n++; d = addDays(d, -1); }
  return n;
}
// 这一周的平均：本周只按已经过去的天数算，别用 7 天拉低
function weekAvgOf(base) {
  const now = new Date();
  const isCur = hKey(base) === hKey(weekStart(now));
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += doneOf(hKey(addDays(base, i)));
  const den = isCur ? ((now.getDay() + 6) % 7) + 1 : 7;
  return sum / den;
}

/* ---------- 日：时间轴 + 倒计时 + 当天明细 ---------- */
function statsDay() {
  const now = new Date();
  const key = hKey(now);
  const times = timesOf(key);
  const count = Math.max(times.length, doneOf(key));
  const total = state.total || 1;
  const left = Math.max(0, total - state.workSec);
  const pct = Math.min(100, (state.workSec / total) * 100);

  let gap = '';
  if (times.length >= 2) {
    let s = 0;
    for (let i = 1; i < times.length; i++) s += Math.max(0, hm2min(times[i]) - hm2min(times[i - 1]));
    gap = Math.round(s / (times.length - 1)) + ' 分钟';
  }

  const yest = doneOf(hKey(addDays(now, -1)));
  const diff = count - yest;
  const cmp = diff === 0 ? '和昨天一样' : diff > 0 ? `比昨天多 ${diff} 次` : `比昨天少 ${-diff} 次`;
  const pos = (h) => 4 + (h / 24) * 92;
  const pins = times.map((t, i) =>
    `<div class="pin${i === times.length - 1 ? ' on' : ''}" style="left:${pos(hm2min(t) / 60).toFixed(2)}%"></div>`
  ).join('');
  const ax = [0, 6, 12, 18, 24].map((h) =>
    `<div class="ax" style="left:${pos(h).toFixed(2)}%">${h}:00</div>`
  ).join('');

  const logs = times.length
    ? times.map((t, i) =>
      `<div class="st-log"><span class="d"></span><span class="t">${t}</span><span class="k">第 ${i + 1} 次</span></div>`
    ).join('')
    : '<div class="st-empty">点「好的」记一次<br>点「稍后 5 分钟」不算</div>';

  const lead = times.length
    ? `最后一次 <i>${times[times.length - 1]}</i>${gap ? ` ｜ 平均间隔 ${gap}` : ''} ｜ ${cmp}`
    : '今天还没有起身记录';

  return `
    <div class="st-big"><b>${count}</b><span>次</span>
      <span style="margin-left:auto;font-size:10.5px;color:var(--sub)">今天</span></div>
    <div class="st-sub">${lead}</div>
    <div class="st-tl"><div class="rail"></div>${pins}${ax}</div>
    <div class="st-prog">
      <div class="r"><span>距离下次起身提醒</span><b id="stLeft">${mmss(left)} / ${mmss(total)}</b></div>
      <div class="b"><i id="stBarFill" style="width:${pct}%"></i></div>
    </div>
    <div class="st-logs">${logs}</div>
    <div class="st-legend">本周日均 ${weekAvgOf(weekStart(now)).toFixed(1)} 次 ｜ 连续 ${streakDays()} 天</div>
  `;
}

/* ---------- 周：7 根柱 ---------- */
function statsWeek() {
  const now = new Date();
  const isCur = statsView.weekOff === 0;
  const base = addDays(weekStart(now), -statsView.weekOff * 7);

  const counts = [];
  for (let i = 0; i < 7; i++) counts.push(doneOf(hKey(addDays(base, i))));

  const total = counts.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...counts);
  const todayIdx = isCur ? (now.getDay() + 6) % 7 : -1;
  const avg = weekAvgOf(base);
  // 本周只看已经过去的日子，别把周三之后算成「断」
  const elapsed = isCur ? todayIdx + 1 : 7;
  const zero = counts.slice(0, elapsed).filter((c) => c === 0).length;
  const bestIdx = counts.indexOf(Math.max(...counts));
  const best = Math.max(...counts) > 0 ? `${WD_MON[bestIdx]} ${counts[bestIdx]} 次` : '—';

  const bars = counts.map((c, i) => {
    const h = Math.max(6, Math.round((c / max) * 128));
    const on = i === todayIdx;
    const full = todayIdx === -1 && c > 0;
    return `<div class="st-bar${on ? ' on' : ''}${full ? ' full' : ''}${c === 0 ? ' zero' : ''}">
      <u>${c}</u><i style="height:${h}px"></i></div>`;
  }).join('');
  const xlab = WD_MON.map((t) => `<span>${t}</span>`).join('');

  return `
    <div class="st-big"><b>${total}</b><span>次</span>
      <span class="st-nav">
        <button id="wkPrev" title="上一周">‹</button>
        <i>${isCur ? '本周' : `${base.getMonth() + 1}/${base.getDate()}`}</i>
        <button id="wkNext" title="下一周"${isCur ? ' disabled' : ''}>›</button>
      </span></div>
    <div class="st-sub">日均 <i>${avg.toFixed(1)}</i> 次 ｜ 最好 ${best} ｜ 断 ${zero} 天</div>
    <div class="st-bars">${bars}</div>
    <div class="st-xlab">${xlab}</div>
    <div class="st-kpi">
      <div><b>${total}</b><span>${isCur ? '本周合计' : '当周合计'}</span></div>
      <div><b>${avg.toFixed(1)}</b><span>日均</span></div>
      <div><b>${streakDays()}</b><span>连续天数</span></div>
    </div>
  `;
}

/* ---------- 月：方块热力日历 ---------- */
function statsMonth() {
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth() - statsView.monthOff, 1);
  const y = base.getFullYear(), m = base.getMonth();
  const len = new Date(y, m + 1, 0).getDate();
  const startDow = base.getDay();
  const isCur = statsView.monthOff === 0;
  const todayD = now.getDate();

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push('<div class="st-cell void"></div>');

  let total = 0, zero = 0, run = 0, bestRun = 0, elapsed = 0;
  for (let d = 1; d <= len; d++) {
    if (isCur && d > todayD) { cells.push(`<div class="st-cell future"><u>${d}</u></div>`); continue; }
    elapsed++;
    const k = `${y}-${pad2(m + 1)}-${pad2(d)}`;
    const c = doneOf(k);
    total += c;
    if (c === 0) { zero++; run = 0; } else { run++; if (run > bestRun) bestRun = run; }
    const cls = `st-cell pick ${hLevel(c)}${isCur && d === todayD ? ' today' : ''}`;
    cells.push(`<div class="${cls}" data-d="${k}" title="看 ${m + 1}/${d} 的明细"><u>${d}</u>${c || ''}</div>`);
  }
  while (cells.length % 7) cells.push('<div class="st-cell void"></div>');

  let rows = '';
  for (let r = 0; r < cells.length / 7; r++) {
    rows += `<div class="st-row">${cells.slice(r * 7, r * 7 + 7).join('')}</div>`;
  }
  const wd = WD_SUN.map((t) => `<span>${t}</span>`).join('');
  const avg = elapsed ? total / elapsed : 0;
  const label = y === now.getFullYear() ? `${m + 1} 月` : `${y}.${m + 1}`;

  return `
    <div class="st-big"><b>${total}</b><span>次</span>
      <span class="st-nav">
        <button id="moPrev" title="上个月">‹</button>
        <i>${label}</i>
        <button id="moNext" title="下个月"${isCur ? ' disabled' : ''}>›</button>
      </span></div>
    <div class="st-sub">日均 <i>${avg.toFixed(1)}</i> 次 ｜ 断 ${zero} 天 ｜ 最长连续 ${bestRun} 天</div>
    <div class="st-wd">${wd}</div>
    <div class="st-grid">${rows}</div>
    <div class="st-legend">少 <i class="hl0"></i><i class="hl1"></i><i class="hl2"></i><i class="hl3"></i><i class="hl4"></i> 多 ｜ 点格子看详细</div>
  `;
}

function renderStats() {
  const body = $('statsBody');
  if (!body) return;
  $('statSeg').querySelectorAll('b').forEach((b) => {
    b.classList.toggle('on', b.dataset.range === statsView.range);
  });

  if (statsView.range === 'day') body.innerHTML = statsDay();
  else if (statsView.range === 'week') body.innerHTML = statsWeek();
  else body.innerHTML = statsMonth();

  const bind = (id, fn) => {
    const el = $(id);
    if (el) el.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
  };
  bind('wkPrev', () => {
    statsView.weekOff = Math.min(statsView.weekOff + 1, MAX_WEEK_BACK);
    renderStats();
  });
  bind('wkNext', () => {
    if (statsView.weekOff > 0) { statsView.weekOff--; renderStats(); }
  });
  bind('moPrev', () => {
    statsView.monthOff = Math.min(statsView.monthOff + 1, MAX_MONTH_BACK);
    renderStats();
  });
  bind('moNext', () => {
    if (statsView.monthOff > 0) { statsView.monthOff--; renderStats(); }
  });
}

/* ---------- 状态切换 ---------- */
function setUI(next) {
  ui = next;
  island.classList.remove('is-collapsed', 'is-alert', 'is-open');
  island.classList.add('is-' + next);
  if (next === 'open') {
    view = 'list';
    island.classList.remove('is-settings', 'is-stats');
    $('viewList').classList.remove('hidden');
    $('viewSettings').classList.add('hidden');
    $('viewStats').classList.add('hidden');
  }
  // 尺寸变了，立刻告诉主进程新的可点击范围
  reportRect();
  setTimeout(reportRect, 460);
}

/* 把岛在窗口内的矩形上报给主进程，用于判断光标是否落在岛上 */
// 注意：--w / --h 不参与过渡，能立刻读到这一态的最终尺寸；
// 而 offsetWidth 在 420ms 的宽度动画期间还是旧值，按它上报会让
// 提醒态右侧的「好的」按钮有半秒点不到（窗口还在穿透）。所以按目标尺寸算。
function targetBox() {
  const cs = getComputedStyle(island);
  const w = parseFloat(cs.getPropertyValue('--w')) || island.offsetWidth;
  const h = parseFloat(cs.getPropertyValue('--h')) || island.offsetHeight;
  const sw = stage.clientWidth || 0;
  return {
    x: Math.round((sw - w) / 2),
    y: island.offsetTop,
    w: Math.round(w),
    h: Math.round(h)
  };
}

function reportRect() {
  if (!island.offsetWidth) return;
  try { api.setIslandRect(targetBox()); } catch (_) {}
}

function setView(next) {
  view = next;
  island.classList.toggle('is-settings', next === 'settings');
  island.classList.toggle('is-stats', next === 'stats');
  $('viewList').classList.toggle('hidden', next !== 'list');
  $('viewSettings').classList.toggle('hidden', next !== 'settings');
  $('viewStats').classList.toggle('hidden', next !== 'stats');
  if (next === 'settings') renderSettings();
  if (next === 'stats') renderStats();
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
let suppressClick = false;   // 拖完松手别当成点击

island.addEventListener('click', (e) => {
  if (suppressClick) { suppressClick = false; return; }
  if (e.target.closest('button') || e.target.closest('input')) return;
  if (e.target.closest('.todo')) return;
  if (ui === 'open') setUI('collapsed');
  else if (ui === 'collapsed') setUI('open');
});

/* ---------- 可拖拽模式：按住岛任意空白处移动整个窗口 ---------- */
// 用 screenX/screenY 算位移，主进程按窗口原始位置平移，避免抖动累积
let drag = null;

function isDragSurface(t) {
  // 这些地方要留给点击 / 输入，不参与拖动
  return !t.closest('button, input, .todo, .todos, .add-row, .set-row, .view-settings, .sit');
}

island.addEventListener('pointerdown', (e) => {
  if (!state.settings.draggable) return;
  if (e.button !== 0) return;
  if (!isDragSurface(e.target)) return;
  drag = { sx: e.screenX, sy: e.screenY, moved: false, id: e.pointerId };
  api.dragStart();
  try { island.setPointerCapture(e.pointerId); } catch (_) {}
});

island.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.screenX - drag.sx;
  const dy = e.screenY - drag.sy;
  if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) {
    drag.moved = true;
    island.classList.add('is-dragging');
  }
  if (drag.moved) api.dragMove({ dx, dy });
});

function endDrag(e) {
  if (!drag) return;
  const moved = drag.moved;
  drag = null;
  island.classList.remove('is-dragging');
  try { island.releasePointerCapture(e.pointerId); } catch (_) {}
  api.dragEnd();
  if (moved) suppressClick = true;   // 松手紧跟的那次 click 丢掉
}
island.addEventListener('pointerup', endDrag);
island.addEventListener('pointercancel', endDrag);

$('posModes').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  e.stopPropagation();
  state.settings.draggable = b.dataset.pos === 'free';
  renderSettings();
  stage.classList.remove('is-away');
  await api.saveSettings({ draggable: state.settings.draggable });
  // 切回固定时让主进程把窗口挪回顶部中央
  if (!state.settings.draggable) api.resetPos();
});

$('btnSettings').addEventListener('click', (e) => { e.stopPropagation(); setView('settings'); });
$('btnBack').addEventListener('click', (e) => { e.stopPropagation(); setView('list'); });

$('btnStats').addEventListener('click', (e) => {
  e.stopPropagation();
  statsView.weekOff = 0;
  statsView.monthOff = 0;
  setView('stats');
});
$('btnStatsBack').addEventListener('click', (e) => { e.stopPropagation(); setView('list'); });
$('statSeg').addEventListener('click', (e) => {
  const b = e.target.closest('b');
  if (!b) return;
  e.stopPropagation();
  if (statsView.range === b.dataset.range) return;
  statsView.range = b.dataset.range;
  renderStats();
});

// 「详细」：弹出独立窗口，日历格子大得多，日期一眼能看清
// 带上当前正在看的那天，详细页直接定位过去
function detailFocusKey() {
  const now = new Date();
  if (statsView.range === 'day') return hKey(now);
  if (statsView.range === 'week') return hKey(addDays(weekStart(now), -statsView.weekOff * 7));
  const base = new Date(now.getFullYear(), now.getMonth() - statsView.monthOff, 1);
  return hKey(base);
}
$('btnStatsFull').addEventListener('click', (e) => {
  e.stopPropagation();
  api.openStats(detailFocusKey());
});

// 月视图点某一格 → 直接看那天的明细
$('statsBody').addEventListener('click', (e) => {
  const cell = e.target.closest('.st-cell[data-d]');
  if (!cell) return;
  e.stopPropagation();
  api.openStats(cell.dataset.d);
});

$('btnDismiss').addEventListener('click', (e) => {
  e.stopPropagation();
  const wasTest = testAlert;
  preview = false;
  testAlert = false;
  alertMutedUntil = Date.now() + 2000;   // 主进程收到 dismiss 之前发出来的 tick 还带着 alerted=true
  pinReasons.delete('alert');
  syncPin();
  api.dismissAlert(wasTest);
  state.workSec = 0;
  state.alerted = false;
  renderSit();
  renderCollapsed();
  setUI('collapsed');
});

$('btnSnooze').addEventListener('click', (e) => {
  e.stopPropagation();
  const wasTest = testAlert;
  preview = false;
  testAlert = false;
  alertMutedUntil = Date.now() + 2000;
  pinReasons.delete('alert');
  syncPin();
  api.snoozeAlert(wasTest);
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

// 停手分钟数：手动填，回车或失焦时落盘；范围 1～60 分钟，留空回到默认值
const IDLE_MIN = 1, IDLE_MAX = 60, IDLE_DEFAULT = 5;
function commitIdleMin() {
  const raw = parseInt($('idleInput').value, 10);
  const min = Number.isFinite(raw) ? Math.min(IDLE_MAX, Math.max(IDLE_MIN, raw)) : IDLE_DEFAULT;
  state.settings.idleMin = min;
  $('idleInput').value = String(min);
  api.saveSettings({ idleMin: min });
}

$('idleInput').addEventListener('click', (e) => e.stopPropagation());
$('idleInput').addEventListener('focus', (e) => {
  e.target.select();
  pinReasons.add('input'); syncPin();
});
$('idleInput').addEventListener('blur', () => {
  commitIdleMin();
  pinReasons.delete('input'); syncPin();
});
$('idleInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.target.blur(); }
  else if (e.key === 'Escape') { e.target.value = String(Number(state.settings.idleMin) || 5); e.target.blur(); }
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
  testAlert = true;
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

  // 统计页开着的时候，日视图的倒计时跟着走（只改这两个节点，不整块重绘）
  if (view === 'stats' && statsView.range === 'day') {
    const total = state.total || 1;
    const left = Math.max(0, total - state.workSec);
    const pct = Math.min(100, (state.workSec / total) * 100);
    const fill = $('stBarFill');
    const txt = $('stLeft');
    if (fill) fill.style.width = pct + '%';
    if (txt) txt.textContent = `${mmss(left)} / ${mmss(total)}`;
  }

  if (data.alerted) {
    if (Date.now() < alertMutedUntil) return;   // 刚点掉，忽略在途的旧 tick
    if (ui !== 'alert') {
      preview = true;
      testAlert = false;                        // 真提醒，要记进起身记录
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
    state.history = s.history && s.history.days ? s.history : { days: {} };
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
  if (hash.includes('stats')) { setUI('open'); setView('stats'); }
  if (hash.includes('stats-week')) { statsView.range = 'week'; setUI('open'); setView('stats'); }
  if (hash.includes('stats-month')) { statsView.range = 'month'; setUI('open'); setView('stats'); }
  if (hash.includes('alert')) { preview = true; setUI('alert'); }
  if (hash.includes('away')) { stage.classList.add('is-away'); }
  if (hash.includes('wake')) { stage.classList.add('is-away', 'is-wake'); }
  if (hash.includes('update') || hash.includes('ready')) {
    state.update = hash.includes('ready')
      ? { mode: 'auto', status: 'ready', version: '1.4.1', percent: 100 }
      : { mode: 'auto', status: 'available', version: '1.4.1', percent: 0 };
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

// 记了一笔起身，主进程推新数据过来
if (api.onStats) {
  api.onStats((h) => {
    state.history = h && h.days ? h : { days: {} };
    if (view === 'stats') renderStats();
  });
}

/* ================= 浏览器内预览用的假接口 ================= */
function createMock() {
  const KEY = 'island-mock';
  let data = { todos: [], settings: { workMinutes: 45, autostart: true, sound: true, presenceMode: 'smart', idleMin: 5, autoIdle: true, draggable: false }, workSec: 1920 };
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

  // 预览用的假起身记录：近 75 天，今天固定 3 次，方便看效果
  const k2 = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (!data.history || !data.history.days) {
    const days = {};
    const now = new Date();
    for (let i = 1; i < 75; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      if (Math.random() < 0.13 || (d.getDay() === 0 && Math.random() < 0.45)) continue;
      const n = 1 + Math.floor(Math.random() * 4);
      const times = [];
      let t = 9 * 60 + Math.floor(Math.random() * 50);
      for (let j = 0; j < n; j++) {
        times.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
        t += 45 + Math.floor(Math.random() * 55);
      }
      days[k2(d)] = { done: n, snooze: 0, times };
    }
    days[k2(now)] = { done: 3, snooze: 1, times: ['09:12', '10:05', '11:20'] };
    data.history = { days };
  }

  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (_) {} };
  save();   // 假数据也落盘，别每次刷新都换一批

  const recordMock = (kind) => {
    const key = k2(new Date());
    const day = data.history.days[key] || (data.history.days[key] = { done: 0, snooze: 0, times: [] });
    if (kind === 'snooze') {
      day.snooze = (day.snooze || 0) + 1;
    } else {
      day.done = (day.done || 0) + 1;
      const d = new Date();
      day.times.push(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
    }
    save();
  };

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
      history: data.history,
      version: '1.4.1',
      update: null
    }),
    getStats: async () => data.history,
    saveTodos: async (list) => { data.todos = list; save(); return list; },
    saveSettings: async (patch) => { Object.assign(data.settings, patch); save(); return data.settings; },
    dismissAlert: (isTest) => {
      data.workSec = 0;
      if (!isTest) recordMock('done');
    },
    snoozeAlert: (isTest) => {
      data.workSec = Math.max(0, data.settings.workMinutes * 60 - 300);
      if (!isTest) recordMock('snooze');
    },
    setIslandRect: () => {},
    openStats: () => {},
    minimize: () => {},
    pin: () => {},
    hold: () => {},
    quit: () => {},
    dragMove: () => {},
    dragEnd: () => {},
    resetPos: () => {},
    dragStart: () => {},
    checkUpdate: async () => ({ ok: true, state: { status: 'idle' } }),
    updateAction: () => {},
    onTick: (cb) => { tickCb = cb; },
    onPresence: () => {},
    onWake: () => {},
    onSummon: () => {},
    onUpdate: () => {},
    onStats: () => {}
  };
}
