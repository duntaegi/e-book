/* 기기 동기화 (Firebase Firestore)
   같은 '동기화 코드'를 넣은 기기끼리 읽던 위치 · 북마크 · 독서 기록을 맞춰요.
   - 책 파일은 올라가지 않아요. 기기마다 같은 epub 파일을 따로 추가해 두세요.
     (책은 파일 내용으로 구분하므로, 같은 파일이면 같은 책으로 알아봐요)
   - 올라가는 것: 책 구분번호, 읽던 위치, 북마크(쪽 이름과 앞 60자 미리보기), 독서 시간 기록
   - 보기 설정(글자 크기·테마 등)은 기기마다 다르게 쓰려고 맞추지 않아요.
   - 같은 항목을 두 기기에서 바꿨다면 더 나중에 바꾼 쪽을 남겨요. 인터넷이 없으면 모아 뒀다가 연결되면 올려요. */
(() => {
'use strict';
const R = window.__reader;
if (!R) return;

const FB_CONFIG = {
  apiKey: 'AIzaSyApjJJJ9Qlk5GX8M5IRdPmSScJC32NByUg',
  authDomain: 'study-sync-3b8da.firebaseapp.com',
  projectId: 'study-sync-3b8da',
  storageBucket: 'study-sync-3b8da.firebasestorage.app',
  messagingSenderId: '749575887157',
  appId: '1:749575887157:web:a1e93170139f6f2a66547c'
};
const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 헷갈리는 O·0·I·1은 뺌
const CODE_RE = /^[A-HJ-NP-Z2-9]{20}$/;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- 항목 ----------
   p:<책>            읽던 위치 (시각은 위치를 저장한 시각)
   b:<책>:<북마크>   북마크 하나
   s:<연월>:<기록>   독서 기록 하나 */
const ym = ms => { const d = new Date(ms || 0); return String(d.getUTCFullYear() * 100 + d.getUTCMonth() + 1); };
function parseKey(k) {
  const a = k.split(':');
  if (a[0] === 'p') return { kind: 'p', bid: a[1] };
  if (a[0] === 'b') return { kind: 'b', bid: a[1], id: a.slice(2).join(':') };
  return { kind: 's', ym: a[1], sid: a.slice(2).join(':') };
}
function docOf(k) {
  const p = parseKey(k);
  return p.kind === 's' ? 'l' + p.ym : 'k' + String(p.bid).replace(/[^A-Za-z0-9]/g, '').slice(0, 48);
}
async function collect() {
  const items = new Map(), books = new Set(); let haveLog = false;
  for (const s of await R.DB.all('state')) {
    if (!s || s.id === 'folders') continue;
    if (s.id === 'readlog') { haveLog = true; for (const r of s.sessions || []) if (r && r.sid) items.set('s:' + ym(r.st) + ':' + r.sid, r); continue; }
    books.add(s.id);
    if (s.cfi) items.set('p:' + s.id, { cfi: s.cfi, percentage: s.percentage || 0, pos: s.pos || null, t: s.posUpdated || 0 });
    for (const b of s.bookmarks || []) if (b && b.id) items.set('b:' + s.id + ':' + b.id, b);
  }
  return { items, books, haveLog };
}
// 바뀌었는지만 보면 되므로 짧은 해시로 비교 (cyrb53)
function hash(s) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const norm = v => JSON.stringify(v);

/* ---------- 상태 ---------- */
let Y = { on: false, code: '', base: {}, stamp: {}, dirty: {}, fresh: false, db: null, fs: null, ready: false, busy: false, err: '', last: 0 };
function loadCfg() {
  let c = {}, s = {};
  try { c = JSON.parse(localStorage.getItem('rsync.cfg')) || {}; } catch (e) {}
  try { s = JSON.parse(localStorage.getItem('rsync.st')) || {}; } catch (e) {}
  Y.on = !!(c.on && CODE_RE.test(c.code || '')); Y.code = Y.on ? c.code : '';
  Y.base = s.base || {}; Y.stamp = s.stamp || {}; Y.dirty = s.dirty || {};
}
function save() {
  try {
    localStorage.setItem('rsync.cfg', JSON.stringify({ on: Y.on, code: Y.code }));
    localStorage.setItem('rsync.st', JSON.stringify({ base: Y.base, stamp: Y.stamp, dirty: Y.dirty }));
  } catch (e) {}
}
// 모든 동기화 작업은 한 줄로 세워서 하나씩 (서로 겹쳐서 기록이 엇갈리지 않게)
let chain = Promise.resolve();
const run = fn => (chain = chain.then(fn).catch(e => { console.warn('sync', e); }));
const forget = k => { delete Y.base[k]; delete Y.stamp[k]; delete Y.dirty[k]; };
const pending = () => Object.keys(Y.dirty).length;

/* 이 기기에서 달라진 것을 찾아 '보낼 목록'에 넣음 */
async function scan() {
  if (!Y.on) return 0;
  const { items, books, haveLog } = await collect();
  const now = Date.now(); let n = 0;
  for (const [k, v] of items) {
    const h = hash(norm(v));
    if (Y.base[k] === h) continue;
    Y.base[k] = h; Y.dirty[k] = 1; n++;
    if (k[0] === 'p') Y.stamp[k] = v.t || 1;
    else if (Y.fresh) Y.stamp[k] = (k[0] === 'b' ? v.created : (v.en || v.st)) || 1;   // 처음 켤 때는 원래 만든 시각으로
    else Y.stamp[k] = Math.max(now, (Y.stamp[k] || 0) + 1);
  }
  for (const k of Object.keys(Y.base)) {
    if (items.has(k)) continue;
    const p = parseKey(k);
    if (p.kind === 'p') { if (!books.has(p.bid)) forget(k); continue; }   // 위치는 지우지 않음. 책을 지운 경우는 기억을 비워 두면 다음에 다시 받아와요
    if (p.kind === 'b' && !books.has(p.bid)) { forget(k); continue; }       // 책 자체를 지운 것이지 북마크를 지운 게 아님
    if (p.kind === 's' && !haveLog) { forget(k); continue; }
    delete Y.base[k]; Y.dirty[k] = 1; Y.stamp[k] = Math.max(now, (Y.stamp[k] || 0) + 1); n++;   // 지운 것도 알려야 다른 기기에서 지워짐
  }
  Y.fresh = false;
  if (n) { save(); pushSoon(); status(); }
  return n;
}

/* 서버에서 받은 것을 합침: 항목마다 더 나중에 바뀐 쪽을 남김 */
async function merge(docs) {
  await scan();
  const ops = [];
  for (const d of docs) for (const k of Object.keys((d && d.items) || {})) {
    const e = d.items[k]; if (!e || typeof e.t !== 'number') continue;
    let v = null, rh = null;
    if (typeof e.v === 'string') { try { v = JSON.parse(e.v); rh = hash(norm(v)); } catch (err) { continue; } }
    const lh = Y.base[k] === undefined ? null : Y.base[k], lt = Y.stamp[k] || 0;
    if (rh === lh) { if (e.t >= lt) { Y.stamp[k] = e.t; delete Y.dirty[k]; } continue; }
    if (e.t > lt || (e.t === lt && String(rh) > String(lh))) ops.push({ k, v, t: e.t, h: rh });
    else Y.dirty[k] = 1;   // 이 기기 쪽이 더 최신이면 다시 올림
  }
  let applied = 0;
  if (ops.length) applied = await applyOps(ops);
  save(); pushSoon();
  return applied;
}
const settle = o => { if (o.v === null) delete Y.base[o.k]; else Y.base[o.k] = o.h; Y.stamp[o.k] = o.t; delete Y.dirty[o.k]; };
const upsert = (arr, key, id, v) => { const i = arr.findIndex(x => x[key] === id); if (v === null) { if (i >= 0) arr.splice(i, 1); } else if (i >= 0) arr[i] = v; else arr.push(v); };

async function applyOps(ops) {
  const cur = R.cur(), curId = cur && cur.id;
  const byBook = new Map(), logOps = [];
  for (const o of ops) {
    const p = parseKey(o.k);
    if (p.kind === 's') logOps.push([o, p]);
    else { if (!byBook.has(p.bid)) byBook.set(p.bid, []); byBook.get(p.bid).push([o, p]); }
  }
  let applied = 0, shelf = false, askPos = null;
  for (const [bid, list] of byBook) {
    if (bid === curId) {
      // 지금 읽고 있는 책: 읽는 화면은 건드리지 않고, 북마크만 바꾸고 위치는 물어봄
      let marks = false;
      for (const [o, p] of list) {
        if (p.kind === 'p') {
          if (o.v && o.v.cfi && o.v.t > (cur.state.posUpdated || 0)) askPos = o;   // 설정/기록은 사용자가 '이동'을 고른 뒤에
          continue;
        }
        upsert(cur.state.bookmarks || (cur.state.bookmarks = []), 'id', p.id, o.v); settle(o); marks = true; applied++;
      }
      if (marks) { R.saveState(); R.refreshMarks(); }
      continue;
    }
    const st = (await R.DB.get('state', bid)) || { id: bid, cfi: null, percentage: 0, bookmarks: [], highlights: [], posUpdated: 0 };
    let posOk = false;
    for (const [o, p] of list) {
      if (p.kind === 'p') {
        if (o.v && o.v.cfi && o.v.t > (st.posUpdated || 0)) {
          st.cfi = o.v.cfi; st.percentage = o.v.percentage || 0; st.pos = o.v.pos || undefined; st.posUpdated = o.v.t; posOk = true;
        }
        settle(o); applied++;
      } else { upsert(st.bookmarks || (st.bookmarks = []), 'id', p.id, o.v); settle(o); applied++; }
    }
    await R.DB.put('state', st);
    if (posOk) {
      try { const lp = JSON.parse(localStorage.getItem('pos.' + bid) || 'null'); if (lp && (lp.t || 0) < st.posUpdated) localStorage.removeItem('pos.' + bid); } catch (e) {}
      const m = await R.DB.get('meta', bid);
      if (m) { m.progress = st.percentage || 0; await R.DB.put('meta', m); shelf = true; }
    }
  }
  if (logOps.length) {
    await R.logTask(async () => {
      const o = (await R.DB.get('state', 'readlog')) || { id: 'readlog', sessions: [] };
      for (const [op, p] of logOps) { upsert(o.sessions, 'sid', p.sid, op.v); settle(op); applied++; }
      await R.DB.put('state', o);
    });
  }
  if (shelf && !$('#library').hidden) R.renderShelf();
  if (askPos) offerJump(askPos);
  return applied;
}

/* 읽는 중인 책에 다른 기기의 더 최근 위치가 도착하면 이동할지 물어봄 */
let offering = false;
async function offerJump(o) {
  const cur = R.cur(); if (offering || !cur) return;
  const here = Math.round((cur.state.percentage || 0) * 1000) / 10, there = Math.round((o.v.percentage || 0) * 1000) / 10;
  if (Math.abs(here - there) < 0.5) { settle(o); save(); return; }
  offering = true;
  const go = await dialog(`<p>다른 기기에서 <b>${there}%</b>까지 읽었어요.<br>지금 이 기기는 ${here}%예요.<br>그 위치로 이동할까요?</p>`, [['이 기기에서 계속', 0], ['이동하기', 1, 'primary']]);
  offering = false;
  const c = R.cur(); if (!c || c.id !== cur.id) return;
  if (go) {
    c.state.cfi = o.v.cfi; c.state.percentage = o.v.percentage || 0; c.state.pos = o.v.pos || undefined; c.state.posUpdated = o.v.t;
    settle(o); save();
    try { await R.goTo(o.v.pos, o.v.cfi); } catch (e) {}
  }
}

/* ---------- 서버로 올리기 ---------- */
let pushT = 0;
function pushSoon() { if (!Y.on) return; clearTimeout(pushT); pushT = setTimeout(() => run(push), 2500); }
async function push() {
  if (!Y.on || !Y.db || !Y.ready || Y.busy || !pending()) return;
  const { items } = await collect();
  const docs = {}, sent = [];
  for (const k of Object.keys(Y.dirty)) {
    const v = items.get(k);
    if (v === undefined && k[0] === 'p') { delete Y.dirty[k]; continue; }
    const t = k[0] === 'p' ? (v.t || 1) : (Y.stamp[k] || Date.now());
    Y.stamp[k] = t;
    const id = docOf(k);
    (docs[id] || (docs[id] = { items: {} })).items[k] = { v: v === undefined ? null : norm(v), t };
    sent.push([k, t]);
  }
  if (!sent.length) { save(); return; }
  Y.busy = true; status();
  try {
    const fs = Y.fs, ids = Object.keys(docs);
    for (let i = 0; i < ids.length; i += 400) {
      const b = fs.writeBatch(Y.db);
      ids.slice(i, i + 400).forEach(id => b.set(fs.doc(Y.db, 'ebook', Y.code, 'd', id), docs[id], { merge: true }));
      await b.commit();
    }
    if (!Y.on) return;
    sent.forEach(([k, t]) => { if (Y.stamp[k] === t) delete Y.dirty[k]; });
    Y.err = ''; Y.last = Date.now(); save();
  } catch (e) {
    Y.err = (e && e.code) || 'push';
    setTimeout(pushSoon, 30000);
  } finally {
    Y.busy = false; status();
    if (Y.on && pending()) pushSoon();
  }
}

/* ---------- 서버와 연결 ---------- */
async function start() {
  if (!Y.on || Y.db || Y.loading) return;
  Y.loading = true; status();
  try {
    const [appMod, fs] = await Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-firestore.js')]);
    if (!Y.on) return;
    const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(FB_CONFIG);
    Y.fs = fs; Y.db = fs.getFirestore(app); Y.err = '';
    const code = Y.code;
    Y.unsub = fs.onSnapshot(fs.collection(Y.db, 'ebook', code, 'd'), snap => run(async () => {
      if (!Y.on || Y.code !== code) return;
      const docs = snap.docChanges().filter(c => c.type !== 'removed').map(c => c.doc.data());
      const got = docs.length ? await merge(docs) : 0;
      if (!snap.metadata.fromCache) { Y.err = ''; Y.last = Date.now(); }
      if (!Y.ready) {
        Y.ready = true;
        if (Y.hello) { Y.hello = false; R.toast(got ? '다른 기기의 기록을 받아 합쳤어요' : '동기화를 켰어요'); }
      }
      save(); push(); status();
    }), e => { Y.err = (e && e.code) || 'listen'; status(); stop(); setTimeout(start, 30000); });
  } catch (e) {
    Y.err = 'load'; Y.db = null;   // 인터넷이 없어서 동기화 부품을 못 받음 → 연결되면 다시 시도
  } finally { Y.loading = false; status(); }
}
function stop() {
  try { Y.unsub && Y.unsub(); } catch (e) {}
  try { Y.db && Y.fs.terminate(Y.db); } catch (e) {}
  Y.unsub = null; Y.db = null; Y.ready = false; Y.busy = false;
}
function enable(code, hello) {
  stop();
  Y.on = true; Y.code = code; Y.base = {}; Y.stamp = {}; Y.dirty = {}; Y.fresh = true; Y.err = ''; Y.hello = hello;
  save();
  run(scan).then(() => { start(); });
}
function disable() {
  stop(); clearTimeout(pushT);
  Y.on = false; Y.code = ''; Y.base = {}; Y.stamp = {}; Y.dirty = {};
  try { localStorage.removeItem('rsync.st'); } catch (e) {}
  save(); status();
}
function statusText() {
  if (!Y.on) return '꺼짐';
  if (Y.err === 'permission-denied') return '서버가 거절함 (규칙 확인 필요)';
  if (Y.err && !navigator.onLine) return '인터넷 없음 · 연결되면 맞춰요';
  if (Y.err) return '연결 안 됨 · 잠시 후 다시 시도';
  if (!Y.ready) return '연결 중…';
  const n = pending();
  if (n) return Y.busy ? `기록 ${n}개 보내는 중…` : `보낼 기록 ${n}개`;
  if (Y.last) { const d = new Date(Y.last), p = x => String(x).padStart(2, '0'); return `켜짐 · ${p(d.getHours())}:${p(d.getMinutes())}에 맞춤`; }
  return '켜짐';
}
/* 서재 위쪽 칩: 동기화가 됐는지 한눈에 (초록=이 기기 기록이 서버에 다 올라감, 파랑=진행 중, 빨강=안 됨, 회색=꺼짐) */
function chipState() {
  if (!Y.on) return ['off', '동기화 꺼짐'];
  if (!navigator.onLine) return ['bad', '오프라인'];
  if (Y.err === 'permission-denied') return ['bad', '동기화 거절됨'];
  if (Y.err) return ['bad', '동기화 안 됨'];
  if (!Y.ready) return ['busy', '연결 중…'];
  if (Y.busy || pending()) return ['busy', '동기화 중…'];
  const d = Y.last ? new Date(Y.last) : null, p = x => String(x).padStart(2, '0');
  return ['ok', '동기화 완료' + (d ? ` ${p(d.getHours())}:${p(d.getMinutes())}` : '')];
}
function status() {
  const b = $('#btnSync');
  if (b) {
    b.textContent = !Y.on ? '동기화' : Y.err && Y.err !== 'load' ? '동기화 !' : '동기화 ✓';
    b.title = '동기화: ' + statusText();
  }
  const c = $('#syncChip');
  if (c) { const [cls, txt] = chipState(); c.className = 'schip ' + cls; $('#syncChipTxt').textContent = txt; }
}

/* ---------- 화면 ---------- */
function dialog(html, buttons) {
  return new Promise(res => {
    const box = document.createElement('div'); box.className = 'dialog';
    box.innerHTML = '<div class="dialog-box sy-box">' + html + '<div class="dialog-actions sy-act">' +
      buttons.map(([label, val, cls], i) => `<button class="btn ${cls || 'ghost'}" data-i="${i}">${esc(label)}</button>`).join('') + '</div></div>';
    document.body.appendChild(box);
    const done = v => { box.remove(); res(v); };
    box.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) done(buttons[+b.dataset.i][1]); });
    box._done = done;
  });
}
const fmt = c => c.replace(/(.{5})(?=.)/g, '$1-');
function newCode() { const u = new Uint32Array(20); crypto.getRandomValues(u); return [...u].map(x => ABC[x % 32]).join(''); }

async function openSync() {
  if (Y.on) {
    const v = await dialog(`<p><b>동기화 코드</b><br><span class="sy-code">${fmt(Y.code)}</span></p>
      <p class="muted small">다른 기기에서 <b>동기화 → 코드 입력</b>을 누르고 이 코드를 넣으면 읽던 위치와 북마크가 맞춰져요. 코드를 아는 사람은 기록을 볼 수 있으니 남에게 알려 주지 마세요.<br>책 파일은 기기마다 같은 파일을 따로 추가해야 해요.</p>
      <p class="muted small">상태: ${esc(statusText())}</p>`,
      [['코드 복사', 'copy', 'primary'], ['동기화 끄기', 'off', 'danger'], ['닫기', null]]);
    if (v === 'copy') { try { await navigator.clipboard.writeText(fmt(Y.code)); R.toast('코드를 복사했어요'); } catch (e) { R.toast('복사가 안 돼요. 코드를 길게 눌러 복사하세요'); } }
    if (v === 'off') {
      const ok = await dialog('<p>동기화를 끌까요?<br><span class="muted small">이 기기의 기록은 그대로 남아요. 이후 이 기기에서 읽은 기록은 다른 기기로 가지 않아요.</span></p>', [['취소', 0], ['끄기', 1, 'danger']]);
      if (ok) { disable(); R.toast('동기화를 껐어요'); }
    }
    return;
  }
  const v = await dialog(`<p><b>기기 동기화</b></p>
    <p class="muted small">아이패드와 폰에 같은 동기화 코드를 넣으면 <b>읽던 위치 · 북마크 · 독서 기록</b>이 자동으로 맞춰져요.<br>
    · 처음 켜는 기기: <b>새 코드 만들기</b><br>· 두 번째 기기: <b>코드 입력</b><br>
    책 파일은 올라가지 않아요. 두 기기에 같은 epub 파일을 따로 추가해 두세요.</p>`,
    [['새 코드 만들기', 'new', 'primary'], ['코드 입력', 'enter'], ['취소', null]]);
  if (v === 'new') { enable(newCode(), true); status(); openSync(); }
  else if (v === 'enter') {
    let raw = '';
    const go = await new Promise(res => {
      const box = document.createElement('div'); box.className = 'dialog';
      box.innerHTML = '<div class="dialog-box sy-box"><p><b>동기화 코드 입력</b><br><span class="muted small">첫 기기에서 만든 코드를 넣으세요. (대소문자, 하이픈은 상관없어요)</span></p>' +
        '<input id="syIn" class="sy-in" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXXX-XXXXX-XXXXX-XXXXX">' +
        '<div class="dialog-actions sy-act"><button class="btn primary" data-k="1">연결</button><button class="btn ghost" data-k="0">취소</button></div></div>';
      document.body.appendChild(box);
      const inp = box.querySelector('input'); setTimeout(() => inp.focus(), 60);
      const done = ok => { raw = inp.value; box.remove(); res(ok); };
      box.addEventListener('click', e => { const k = e.target.closest('[data-k]'); if (k) done(k.dataset.k === '1'); });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') done(true); });
    });
    if (!go) return;
    const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!CODE_RE.test(code)) { await dialog('<p>코드가 맞지 않아요.<br><span class="muted small">20글자 코드(하이픈 제외)를 다시 확인해 주세요.</span></p>', [['확인', 1, 'primary']]); return; }
    enable(code, true); status(); R.toast('연결하는 중이에요…');
  }
}

/* ---------- 시작 ---------- */
loadCfg();
R.DB.onWrite = () => { if (Y.on) { clearTimeout(Y.scanT); Y.scanT = setTimeout(() => run(scan), 1500); } };
$('#btnSync').addEventListener('click', openSync);
$('#syncChip').addEventListener('click', openSync);
window.addEventListener('online', () => { status(); if (Y.on) { if (!Y.db) start(); else pushSoon(); } });
window.addEventListener('offline', status);
document.addEventListener('visibilitychange', () => {
  if (!Y.on) return;
  if (document.visibilityState === 'hidden') run(scan).then(() => run(push));
  else if (!Y.db) start();
});
status();
if (Y.on) run(scan).then(() => start());
window.__sync = { state: () => Y, scan: () => run(scan), push: () => run(push), statusText };   // 점검용
})();
