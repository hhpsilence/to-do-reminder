/* ================= 起身记录 · 详细页 =================
   数据走和岛同一条 IPC（stats:get），主进程记一笔就推一次 stats，
   这页开着的时候会自动跟着变。直接拿浏览器打开时用假数据兜底。 */

const api = window.islandAPI || null;
const $ = (id) => document.getElementById(id);

const WD = ['日', '一', '二', '三', '四', '五', '六'];
const pad2 = (n) => String(n).padStart(2, '0');
const hKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseKey = (k) => {
  const p = String(k).split('-').map(Number);
  return new Date(p[0], (p[1] || 1) - 1, p[2] || 1);
};
const addDays = (d, n) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
};
// 周一为一周之始
const weekStart = (d) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};
const hm2min = (t) => {
  const p = String(t).split(':');
  return (Number(p[0]) || 0) * 60 + (Number(p[1]) || 0);
};

const TODAY = new Date();
const TODAY_KEY = hKey(TODAY);

let history = { days: {} };
let cur = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);   // 正在看的月份
let sel = null;                                                 // 选中的日期 key

/* ---------- 取数 ---------- */
const doneOf = (k) => {
  const v = history.days[k];
  return v && v.done ? v.done : 0;
};
const timesOf = (k) => {
  const v = history.days[k];
  return v && Array.isArray(v.times) ? v.times : [];
};
const level = (n) => (n >= 4 ? 'hl4' : n === 3 ? 'hl3' : n === 2 ? 'hl2' : n === 1 ? 'hl1' : 'hl0');

// 连续天数：今天还没起身不算断，从昨天往前数
function streak() {
  let n = 0;
  let d = new Date();
  if (doneOf(hKey(d)) === 0) d = addDays(d, -1);
  while (n < 400 && doneOf(hKey(d)) > 0) { n++; d = addDays(d, -1); }
  return n;
}

/* ---------- 本月汇总 ---------- */
function monthData() {
  const y = cur.getFullYear(), m = cur.getMonth();
  const len = new Date(y, m + 1, 0).getDate();
  const isCur = y === TODAY.getFullYear() && m === TODAY.getMonth();
  const last = isCur ? TODAY.getDate() : len;

  let total = 0, zero = 0, run = 0, best = 0;
  for (let d = 1; d <= last; d++) {
    const c = doneOf(`${y}-${pad2(m + 1)}-${pad2(d)}`);
    total += c;
    if (c === 0) { zero++; run = 0; } else { run++; if (run > best) best = run; }
  }
  return { total, zero, best, elapsed: last, avg: last ? total / last : 0 };
}

/* ---------- 渲染 ---------- */
function renderBar() {
  $('mLabel').textContent = `${cur.getFullYear()} 年 ${cur.getMonth() + 1} 月`;
  const atNow = cur.getFullYear() === TODAY.getFullYear() && cur.getMonth() === TODAY.getMonth();
  $('mNext').disabled = atNow;
}

function renderKpis() {
  const s = monthData();
  $('kpis').innerHTML = `
    <div class="kpi"><b>${s.total}<small>次</small></b><span>本月合计</span></div>
    <div class="kpi"><b>${s.avg.toFixed(1)}<small>次</small></b><span>日均</span></div>
    <div class="kpi"><b>${s.zero}<small>天</small></b><span>没有记录</span></div>
    <div class="kpi"><b>${s.best}<small>天</small></b><span>最长连续</span></div>`;
}

function renderGrid() {
  const y = cur.getFullYear(), m = cur.getMonth();
  const len = new Date(y, m + 1, 0).getDate();
  const startDow = new Date(y, m, 1).getDay();

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push('<div class="cell void"></div>');

  for (let d = 1; d <= len; d++) {
    const k = `${y}-${pad2(m + 1)}-${pad2(d)}`;
    if (k > TODAY_KEY) {
      cells.push(`<div class="cell future"><u>${d}</u></div>`);
      continue;
    }
    const c = doneOf(k);
    const times = timesOf(k);
    const cls = ['cell', 'pick', level(c)];
    if (c === 0) cls.push('zero');
    if (k === TODAY_KEY) cls.push('today');
    if (k === sel) cls.push('sel');
    cells.push(`<div class="${cls.join(' ')}" data-d="${k}" title="${m + 1}月${d}日 · ${c} 次">
      <u>${d}</u>
      <span class="cnt"><b>${c}</b>${c > 0 ? '<i>次</i>' : ''}</span>
      ${times.length ? `<em>${times.slice(0, 2).join(' ')}${times.length > 2 ? ' …' : ''}</em>` : ''}
    </div>`);
  }
  // 补齐成整行，不然最后一行会被拉成一条细边
  while (cells.length % 7) cells.push('<div class="cell void"></div>');

  $('grid').innerHTML = cells.join('');
}

function renderSide() {
  const side = $('side');
  if (!sel) { side.innerHTML = '<div class="sd-empty">还没有数据</div>'; return; }

  const d = parseKey(sel);
  const key = sel;
  const c = doneOf(key);
  const times = timesOf(key);
  const rec = history.days[key] || {};
  const isToday = key === TODAY_KEY;
  const isFuture = key > TODAY_KEY;

  let cmp = '';
  if (isFuture) {
    cmp = '这天还没到';
  } else {
    const yest = doneOf(hKey(addDays(d, -1)));
    const diff = c - yest;
    cmp = c === 0 && yest === 0
      ? '前一天也没有记录'
      : diff === 0 ? `和前一天一样（${yest} 次）`
        : diff > 0 ? `比前一天多 <i>${diff}</i> 次`
          : `比前一天少 <i>${-diff}</i> 次`;
    if (rec.snooze) cmp += ` ｜ 稍后 ${rec.snooze} 次`;
  }

  let gap = '—';
  if (times.length >= 2) {
    let s = 0;
    for (let i = 1; i < times.length; i++) s += Math.max(0, hm2min(times[i]) - hm2min(times[i - 1]));
    gap = Math.round(s / (times.length - 1)) + ' 分';
  }

  const rows = times.length
    ? times.map((t, i) => {
      const prev = i ? hm2min(times[i - 1]) : 0;
      const g = i ? Math.max(0, hm2min(t) - prev) : 0;
      return `<div class="sd-row"><span class="d"></span><b>${t}</b>
        <span class="k">${i ? `+${g} 分钟` : '第 1 次'}</span></div>`;
    }).join('')
    : `<div class="sd-empty">${isFuture ? '这天还没到' : '这天没有起身记录'}</div>`;

  // 0-24 点的时间轴：一眼看出是上午起得多还是下午
  const pins = times.map((t) =>
    `<div class="pin" style="left:${(3 + (hm2min(t) / 1440) * 94).toFixed(2)}%"></div>`
  ).join('');
  const tl = times.length
    ? `<div class="sd-tl"><div class="rail"></div>${pins}
        <div class="ax"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>
      </div>`
    : '';

  // 这一周：7 根小柱，选中的那天实色
  const ws = weekStart(d);
  const we = addDays(ws, 6);
  const wc = [];
  for (let i = 0; i < 7; i++) wc.push(doneOf(hKey(addDays(ws, i))));
  const wmax = Math.max(1, ...wc);
  const wsum = wc.reduce((a, b) => a + b, 0);
  const bars = wc.map((v, i) => {
    const on = hKey(addDays(ws, i)) === key;
    const h = Math.max(3, Math.round((v / wmax) * 38));
    return `<div class="wb${on ? ' on' : ''}" title="${v} 次"><i style="height:${h}px"></i><u>${WD[(i + 1) % 7]}</u></div>`;
  }).join('');
  const week = `
    <div class="sd-week">
      <div class="sd-wt"><b>这一周</b><span>${ws.getMonth() + 1}/${ws.getDate()} – ${we.getMonth() + 1}/${we.getDate()}</span><em>共 ${wsum} 次</em></div>
      <div class="sd-wbars">${bars}</div>
    </div>`;

  side.innerHTML = `
    <div class="sd-top">
      <b>${d.getMonth() + 1} 月 ${d.getDate()} 日</b>
      <span>周${WD[d.getDay()]}</span>
      ${isToday ? '<span class="pill">今天</span>' : ''}
    </div>
    <div class="sd-big"><b>${c}</b><span>次</span></div>
    <div class="sd-cmp">${cmp}</div>
    ${week}
    <div class="sd-list">${rows}</div>
    ${tl}
    <div class="sd-kpi">
      <div><b>${gap}</b><span>平均间隔</span></div>
      <div><b>${streak()} 天</b><span>当前连续</span></div>
    </div>`;
}

function render() {
  renderBar();
  renderKpis();
  renderGrid();
  renderSide();
}

/* ---------- 选日期 ---------- */
// 打开时优先选今天；看的是别的月份就选当月最后一条有记录的日子
function pickDefault() {
  const y = cur.getFullYear(), m = cur.getMonth();
  const isCur = y === TODAY.getFullYear() && m === TODAY.getMonth();
  if (isCur) return TODAY_KEY;
  const len = new Date(y, m + 1, 0).getDate();
  for (let d = len; d >= 1; d--) {
    const k = `${y}-${pad2(m + 1)}-${pad2(d)}`;
    if (doneOf(k) > 0) return k;
  }
  return `${y}-${pad2(m + 1)}-01`;
}

function select(k) {
  sel = k;
  render();
}

function gotoMonth(offset) {
  const next = new Date(cur.getFullYear(), cur.getMonth() + offset, 1);
  const nowFirst = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
  if (next > nowFirst) return;
  cur = next;
  sel = pickDefault();
  render();
}

// 从岛上跳过来：定位到指定那天（那月没记录就落到当月最后一条）
function focusDay(k) {
  if (!k || !/^\d{4}-\d{2}-\d{2}$/.test(k)) return;
  const d = parseKey(k);
  cur = new Date(d.getFullYear(), d.getMonth(), 1);
  sel = doneOf(k) > 0 ? k : pickDefault();
  render();
}

/* ---------- 事件 ---------- */
$('mPrev').addEventListener('click', () => gotoMonth(-1));
$('mNext').addEventListener('click', () => gotoMonth(1));
$('mToday').addEventListener('click', () => {
  cur = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
  sel = TODAY_KEY;
  render();
});

$('grid').addEventListener('click', (e) => {
  const cell = e.target.closest('.cell[data-d]');
  if (!cell) return;
  select(cell.dataset.d);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') { gotoMonth(-1); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { gotoMonth(1); e.preventDefault(); }
  else if (e.key === 't' || e.key === 'T') {
    cur = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
    sel = TODAY_KEY;
    render();
  }
});

$('wMin').addEventListener('click', () => { if (api && api.minimize) api.minimize(); });
$('wClose').addEventListener('click', () => window.close());

if (!api) document.body.classList.add('noapi');

/* ---------- 启动 ---------- */
(async function boot() {
  if (api) {
    try {
      const h = await api.getStats();
      if (h && h.days) history = { days: h.days };
    } catch (_) { /* 读不到就空着 */ }
    if (api.onStats) {
      api.onStats((h) => {
        history = h && h.days ? h : { days: {} };
        render();
      });
    }
    if (api.onFocusDay) api.onFocusDay((k) => focusDay(k));
  } else {
    history = mockHistory();
  }

  const fromHash = (location.hash.match(/d=(\d{4}-\d{2}-\d{2})/) || [])[1];
  if (fromHash) focusDay(fromHash);
  else { sel = pickDefault(); render(); }
})();

/* 浏览器里直接打开时的假数据：近 130 天，看着像真在用 */
function mockHistory() {
  const days = {};
  for (let i = 1; i < 130; i++) {
    const d = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - i);
    if (Math.random() < 0.12 || (d.getDay() === 0 && Math.random() < 0.5)) continue;
    const n = 1 + Math.floor(Math.random() * 4);
    const times = [];
    let t = 9 * 60 + Math.floor(Math.random() * 50);
    for (let j = 0; j < n; j++) {
      times.push(`${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`);
      t += 45 + Math.floor(Math.random() * 55);
    }
    days[hKey(d)] = { done: n, snooze: Math.random() < 0.25 ? 1 : 0, times };
  }
  days[TODAY_KEY] = { done: 3, snooze: 1, times: ['09:12', '10:05', '11:20'] };
  return { days };
}
