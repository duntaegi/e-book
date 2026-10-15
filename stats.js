/* 독서 기록: 홈 화면 캘린더 + 일/주/월/년 통계 화면 (저장소와는 무관, 데이터는 app.js가 넘겨줌) */
(function () {
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const dkey = t => { const d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const sod = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => { const x = sod(d); x.setDate(x.getDate() + n); return x; };
const monday = d => { const x = sod(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const WD = ['월', '화', '수', '목', '금', '토', '일'];
const WDK = ['일', '월', '화', '수', '목', '금', '토'];
const fmt = sec => {
  if (sec < 60) return sec > 0 ? sec + '초' : '0분';
  const m = Math.round(sec / 60); if (m < 60) return m + '분';
  const h = Math.floor(m / 60), r = m % 60; return r ? h + '시간 ' + r + '분' : h + '시간';
};
const fmtS = sec => { const m = Math.round(sec / 60); return m < 60 ? m + '분' : (m / 60).toFixed(1) + '시간'; };
const hm = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };

const SHORT = 60;
let host = { load: async () => [], show() {}, hide() {}, remove: async () => {}, edit: async () => {}, ask: async () => true };
let LOG = [];
let byDay = new Map();
let st = { mode: 'day', date: new Date() };

function index() {
  byDay = new Map();
  for (const s of LOG) {
    const k = dkey(s.st); const o = byDay.get(k) || { sec: 0, rp: 0, n: 0 };
    o.sec += s.sec || 0; o.rp += s.rp || 0; o.n++; byDay.set(k, o);
  }
}
function streak() {
  let d = sod(new Date());
  const ok = x => (byDay.get(dkey(x)) || { sec: 0 }).sec >= 60;
  if (!ok(d)) d = addDays(d, -1);
  let n = 0; while (ok(d)) { n++; d = addDays(d, -1); }
  return n;
}
function range(mode, date) {
  const d = sod(date);
  if (mode === 'day') return [d, addDays(d, 1)];
  if (mode === 'week') { const a = monday(d); return [a, addDays(a, 7)]; }
  if (mode === 'month') return [new Date(d.getFullYear(), d.getMonth(), 1), new Date(d.getFullYear(), d.getMonth() + 1, 1)];
  return [new Date(d.getFullYear(), 0, 1), new Date(d.getFullYear() + 1, 0, 1)];
}
const inRange = (a, b) => LOG.filter(s => s.st >= a.getTime() && s.st < b.getTime());
const sum = (arr, f) => arr.reduce((t, x) => t + (f(x) || 0), 0);

/* 월 캘린더 (홈 카드 / 월 화면 공용) */
function calGrid(year, month) {
  const first = new Date(year, month, 1), days = new Date(year, month + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7, today = dkey(Date.now());
  let h = '<div class="cal">' + WD.map(w => '<div class="cw">' + w + '</div>').join('');
  for (let i = 0; i < lead; i++) h += '<div class="cd empty"></div>';
  for (let d = 1; d <= days; d++) {
    const k = year + '-' + pad(month + 1) + '-' + pad(d);
    const o = byDay.get(k); const sec = o ? o.sec : 0;
    h += '<button class="cd' + (k === today ? ' today' : '') + (sec >= 30 ? ' on' : '') + '" data-go="day:' + k + '"><b>' + d + '</b><small>' + (sec >= 30 ? fmtS(sec) : '') + '</small></button>';
  }
  return h + '</div>';
}

/* 통계 화면 */
function label() {
  const [a] = range(st.mode, st.date); const d = sod(st.date);
  if (st.mode === 'day') return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WDK[d.getDay()] + ')';
  if (st.mode === 'week') { const e = addDays(a, 6); return (a.getMonth() + 1) + '월 ' + a.getDate() + '일 – ' + (e.getMonth() + 1) + '월 ' + e.getDate() + '일'; }
  if (st.mode === 'month') return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월';
  return d.getFullYear() + '년';
}
function bars(items, dense) {
  const mx = Math.max(1, ...items.map(i => i.val));
  return '<div class="bars' + (dense ? ' dense' : '') + '">' + items.map(i =>
    '<div class="bar"' + (i.go ? ' data-go="' + i.go + '"' : '') + '><span class="bv">' + (i.val >= 30 ? fmtS(i.val) : '') + '</span>' +
    '<div class="bc"><i style="height:' + (i.val > 0 ? Math.max(3, Math.round(i.val / mx * 100)) : 0) + '%"></i></div>' +
    '<span class="bl' + (i.hl ? ' hl' : '') + '">' + i.label + '</span></div>').join('') + '</div>';
}
function bookList(ss) {
  const m = new Map();
  for (const s of ss) { const o = m.get(s.bid) || { title: s.title, sec: 0, rp: 0, n: 0 }; o.sec += s.sec || 0; o.rp += s.rp || 0; o.n++; o.title = s.title || o.title; m.set(s.bid, o); }
  const arr = [...m.values()].sort((a, b) => b.sec - a.sec); if (!arr.length) return '';
  const mx = arr[0].sec || 1;
  return '<h3 class="st-h">읽은 책</h3>' + arr.map(o =>
    '<div class="brow"><div class="bt">' + esc(o.title) + '</div><div class="bm">' + fmt(o.sec) + ' · ' + o.rp + '쪽 · ' + o.n + '회</div>' +
    '<div class="bbar"><i style="width:' + Math.max(3, Math.round(o.sec / mx * 100)) + '%"></i></div></div>').join('');
}
function sessionList(ss) {
  if (!ss.length) return '';
  return '<h3 class="st-h">읽은 기록</h3>' + ss.slice().sort((a, b) => a.st - b.st).map(s => {
    let pg;
    if (s.pf != null && s.pt != null) pg = s.pf + ' → ' + s.pt + '쪽 <span class="muted">(' + (s.rp || 0) + '쪽 읽음)</span>';
    else pg = Math.round((s.c0 || 0) * 1000) / 10 + '% → ' + Math.round((s.c1 || 0) * 1000) / 10 + '%';
    return '<div class="srow"><div class="stime">' + hm(s.st) + ' – ' + hm(s.en) + '</div><div class="sbody"><div class="bt">' + esc(s.title) + '</div><div class="bm">' + pg + '</div></div><div class="sdur">' + fmt(s.sec) + '</div><button class="sedit" data-edit="' + esc(s.sid) + '" aria-label="이 기록 고치기">✎</button><button class="sdel" data-del="' + esc(s.sid) + '" aria-label="이 기록 지우기">×</button></div>';
  }).join('');
}
function cleanBtn() {
  const n = LOG.filter(s => (s.sec || 0) < SHORT).length;
  return n ? '<div class="st-clean"><button class="btn small ghost" data-clean="1">1분 미만 기록 ' + n + '개 한 번에 지우기</button></div>' : '';
}
function render() {
  const el = $('#stats'); if (!el) return;
  const [a, b] = range(st.mode, st.date); const ss = inRange(a, b);
  const tot = sum(ss, s => s.sec), pages = sum(ss, s => s.rp);
  const days = new Set(ss.map(s => dkey(s.st))).size;
  const atEnd = b.getTime() > Date.now();
  let t3;
  if (st.mode === 'day') t3 = ['세션', ss.length + '회'];
  else t3 = ['읽은 날', days + '일'];
  let chart = '', list = '';
  if (st.mode === 'day') {
    const hrs = new Array(24).fill(0);
    for (const s of ss) {
      const dur = Math.max(1, s.en - s.st);
      for (let h = 0; h < 24; h++) {
        const h0 = new Date(a.getFullYear(), a.getMonth(), a.getDate(), h).getTime(), h1 = h0 + 3600000;
        const ov = Math.min(h1, s.en) - Math.max(h0, s.st); if (ov > 0) hrs[h] += (s.sec || 0) * ov / dur;
      }
    }
    chart = bars(hrs.map((v, h) => ({ label: h % 6 === 0 ? h + '시' : '', val: v })), true);
    list = sessionList(ss);
  } else if (st.mode === 'week') {
    const items = []; for (let i = 0; i < 7; i++) { const d = addDays(a, i), k = dkey(d.getTime()); items.push({ label: WD[i], val: (byDay.get(k) || { sec: 0 }).sec, go: 'day:' + k, hl: k === dkey(Date.now()) }); }
    chart = bars(items); list = bookList(ss);
  } else if (st.mode === 'month') {
    chart = calGrid(a.getFullYear(), a.getMonth()); list = bookList(ss);
  } else {
    const per = new Array(12).fill(0); for (const s of ss) per[new Date(s.st).getMonth()] += s.sec || 0;
    const nm = new Date().getMonth(), ny = new Date().getFullYear();
    chart = bars(per.map((v, i) => ({ label: (i + 1) + '월', val: v, go: 'month:' + a.getFullYear() + '-' + pad(i + 1) + '-01', hl: a.getFullYear() === ny && i === nm })));
    list = bookList(ss);
  }
  const avg = st.mode !== 'day' && days ? '<div class="muted small st-avg">읽은 날 기준 하루 평균 ' + fmt(Math.round(tot / days)) + '</div>' : '';
  el.innerHTML =
    '<div class="st-wrap"><header class="st-head"><button class="icon" data-act="back" aria-label="서재로">‹</button><b>독서 기록</b></header>' +
    '<div class="seg st-seg">' + [['month', '월별'], ['week', '주별'], ['day', '일별'], ['year', '연도별']].map(([k, n]) => '<button data-mode="' + k + '"' + (st.mode === k ? ' class="on"' : '') + '>' + n + '</button>').join('') + '</div>' +
    '<div class="st-nav"><button class="icon small" data-nav="-1">‹</button><div class="st-label">' + label() + '</div><button class="icon small" data-nav="1"' + (atEnd ? ' disabled' : '') + '>›</button></div>' +
    '<div class="st-tiles"><div><span>읽은 시간</span><b>' + fmt(tot) + '</b></div><div><span>읽은 쪽수</span><b>' + pages + '쪽</b></div><div><span>' + t3[0] + '</span><b>' + t3[1] + '</b></div></div>' +
    avg + '<div class="st-chart">' + chart + '</div>' +
    (list || (ss.length ? '' : '<p class="muted st-none">이 기간에는 읽은 기록이 없어요.</p>')) +
    cleanBtn() + '<p class="muted small st-note">쪽수는 글자 크기·화면에 따라 달라지는 추정값이에요.</p></div>';
}
function bindStats() {
  const el = $('#stats'); if (!el) return;
  el.addEventListener('click', e => {
    const t = e.target.closest('button, [data-go]'); if (!t || t.disabled) return;
    if (t.dataset.edit) { editRec(t.dataset.edit); return; }
    if (t.dataset.del) { removeRecs([t.dataset.del], '이 읽은 기록을 지울까요?'); return; }
    if (t.dataset.clean) { const ids = LOG.filter(s => (s.sec || 0) < SHORT).map(s => s.sid); removeRecs(ids, '1분 미만의 짧은 기록 ' + ids.length + '개를 모두 지울까요?'); return; }
    if (t.dataset.act === 'back') { host.hide(); return; }
    if (t.dataset.mode) { st.mode = t.dataset.mode; render(); return; }
    if (t.dataset.nav) {
      const n = +t.dataset.nav, d = st.date;
      if (st.mode === 'day') st.date = addDays(d, n);
      else if (st.mode === 'week') st.date = addDays(d, 7 * n);
      else if (st.mode === 'month') st.date = new Date(d.getFullYear(), d.getMonth() + n, 1);
      else st.date = new Date(d.getFullYear() + n, 0, 1);
      render(); $('#stats').scrollTop = 0; return;
    }
    if (t.dataset.go) { const [mode, k] = t.dataset.go.split(':'); st = { mode, date: parseKey(k) }; render(); $('#stats').scrollTop = 0; }
  });
}

function editRec(sid) {
  const s = LOG.find(x => x.sid === sid); if (!s) return;
  document.getElementById('stEdit')?.remove();
  const mins = Math.max(0, Math.round((s.sec || 0) / 60));
  const box = document.createElement('div'); box.id = 'stEdit'; box.className = 'dialog';
  box.innerHTML = '<div class="dialog-box st-editbox"><b>' + esc(s.title) + '</b>' +
    '<div class="erow"><label class="pickf">날짜<span class="pick" id="eDateT"></span><input id="eDate" type="date" value="' + dkey(s.st) + '"></label>' +
    '<label class="pickf">시작 시각<span class="pick" id="eTimeT"></span><input id="eTime" type="time" value="' + hm(s.st) + '"></label></div>' +
    '<label>읽은 시간 (분)<input id="eMin" type="number" inputmode="numeric" min="0" value="' + mins + '"></label>' +
    '<div class="erow"><label>시작 쪽<input id="ePf" type="number" inputmode="numeric" min="0" value="' + (s.pf ?? '') + '"></label>' +
    '<label>끝 쪽<input id="ePt" type="number" inputmode="numeric" min="0" value="' + (s.pt ?? '') + '"></label></div>' +
    '<label>읽은 쪽수<input id="eRp" type="number" inputmode="numeric" min="0" value="' + (s.rp ?? 0) + '"></label>' +
    '<div class="muted small">시작·끝 쪽을 고치면 읽은 쪽수가 자동으로 계산돼요.</div>' +
    '<div class="dialog-actions"><button class="btn ghost" data-e="cancel">취소</button><button class="btn primary" data-e="save">저장</button></div></div>';
  document.body.appendChild(box);
  const g = id => box.querySelector('#' + id);
  const num = v => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : null; };
  const auto = () => { const a = num(g('ePf').value), b = num(g('ePt').value); if (a != null && b != null) g('eRp').value = Math.max(0, b - a); };
  const paint = () => {
    const dv = g('eDate').value, tv = g('eTime').value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dv)) { const d = parseKey(dv); g('eDateT').textContent = (d.getFullYear() !== new Date().getFullYear() ? d.getFullYear() + '년 ' : '') + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WDK[d.getDay()] + ')'; } else g('eDateT').textContent = '날짜 선택';
    g('eTimeT').textContent = tv || '시각 선택';
  };
  ['input', 'change'].forEach(ev => { g('eDate').addEventListener(ev, paint); g('eTime').addEventListener(ev, paint); }); paint();
  g('ePf').addEventListener('input', auto); g('ePt').addEventListener('input', auto);
  box.addEventListener('click', async e => {
    const b = e.target.closest('[data-e]'); if (!b) return;
    if (b.dataset.e === 'cancel') { box.remove(); return; }
    const m = num(g('eMin').value), pf = num(g('ePf').value), pt = num(g('ePt').value), rp = num(g('eRp').value);
    if (m == null) { g('eMin').focus(); return; }
    const dv = g('eDate').value, tv = g('eTime').value;
    let st2 = s.st;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dv) && /^\d{2}:\d{2}$/.test(tv)) { const [y, mo, d] = dv.split('-').map(Number), [h, mi] = tv.split(':').map(Number); st2 = new Date(y, mo - 1, d, h, mi).getTime(); }
    const patch = { sec: m * 60, pf, pt, rp: rp == null ? 0 : rp, edited: true, st: st2, en: st2 + Math.max(1, m * 60) * 1000 };
    box.remove(); await host.edit(sid, patch); await refresh(); const y = $('#stats').scrollTop; render(); $('#stats').scrollTop = y;
  });
}
async function removeRecs(ids, msg) {
  if (!ids.length || !(await host.ask(msg + '\n(지운 기록은 되돌릴 수 없어요)', '지우기'))) return;
  await host.remove(ids); await refresh(); const y = $('#stats').scrollTop; render(); $('#stats').scrollTop = y;
}
async function refresh() { try { LOG = (await host.load()) || []; } catch (e) { LOG = []; } index(); }
async function open(date, mode) { await refresh(); st = { mode: mode || 'month', date: date || new Date() }; render(); host.show(); $('#stats').scrollTop = 0; }
async function update() { await refresh(); }

window.Stats = {
  init(h) { host = h; bindStats(); },
  update, open,
  summary() { const k = dkey(Date.now()); return { today: (byDay.get(k) || { sec: 0 }).sec, has: k2 => (byDay.get(k2) || { sec: 0 }).sec >= 30, fmt, dkey }; },
};
})();
