/* 내 서재 - 개인용 EPUB 리더 (epub.js 기반, 모든 데이터는 브라우저 IndexedDB에만 저장) */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- 설정 ---------- */
const DEFAULTS = { size: 21, lh: 1.8, font: 'gothic', theme: 'light', flow: 'paged', spread: 'auto', align: 'left' };
let S = { ...DEFAULTS };
try { S = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('reader.settings') || '{}') }; } catch (e) {}
const saveSettings = () => { try { localStorage.setItem('reader.settings', JSON.stringify(S)); } catch (e) {} };

const THEMES = {
  light: { bg: '#ffffff', fg: '#222222', link: '#2b57d6', meta: '#ffffff' },
  sepia: { bg: '#f4ecd8', fg: '#4a3a2a', link: '#a0612b', meta: '#f4ecd8' },
  dark:  { bg: '#1e1f22', fg: '#d6d6d6', link: '#8fb0ff', meta: '#1e1f22' },
  black: { bg: '#000000', fg: '#bdbdbd', link: '#8fb0ff', meta: '#000000' },
};
const FONTS = {
  gothic:   '"Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic","Nanum Gothic",sans-serif',
  myeongjo: '"AppleMyungjo","Noto Serif KR","Nanum Myeongjo","Batang",serif',
};
const HL_COLORS = { yellow: '#ffd84d', green: '#7ddc8a', blue: '#7cb8ff', pink: '#ff9ec4' };

/* ---------- IndexedDB ---------- */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('myebooks', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('meta', { keyPath: 'id' });
        d.createObjectStore('files', { keyPath: 'id' });
        d.createObjectStore('state', { keyPath: 'id' });
      };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode);
      const out = fn(t.objectStore(store));
      t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  },
  get: (s, id) => DB.tx(s, 'readonly', st => st.get(id)),
  all: s => DB.tx(s, 'readonly', st => st.getAll()),
  put: (s, v) => DB.tx(s, 'readwrite', st => st.put(v)),
  del: (s, id) => DB.tx(s, 'readwrite', st => st.delete(id)),
};

/* ---------- 유틸 ---------- */
let toastTimer;
function toast(msg, ms = 2200) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms);
}
function ask(msg, okLabel = '확인') {
  return new Promise(res => {
    $('#dialogMsg').textContent = msg; $('#dialogOk').textContent = okLabel; $('#dialog').hidden = false;
    const done = v => { $('#dialog').hidden = true; $('#dialogOk').onclick = $('#dialogCancel').onclick = null; res(v); };
    $('#dialogOk').onclick = () => done(true); $('#dialogCancel').onclick = () => done(false);
  });
}
async function sha(buf) {
  try {
    const h = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  } catch (e) { return 'b' + buf.byteLength + '-' + Date.now(); }
}
const debounce = (fn, ms) => { let t; const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; f.flush = (...a) => { clearTimeout(t); fn(...a); }; return f; };
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

/* ---------- 테마 (바깥 UI) ---------- */
function applyChromeTheme() {
  document.body.dataset.theme = S.theme;
  const m = $('meta[name=theme-color]'); if (m) m.content = THEMES[S.theme].meta;
}

/* =====================================================
   서재
   ===================================================== */
const coverURLs = [];
let editMode = false;
const shelf0 = $('#shelf');
async function renderShelf() {
  const keep = $('#library').scrollTop;
  coverURLs.splice(0).forEach(u => URL.revokeObjectURL(u));
  const metas = await DB.all('meta');
  // 순서 값이 없는 책(이전 버전에서 추가한 책)은 추가한 순서대로 뒤에 붙임
  let maxOrder = Math.max(0, ...metas.filter(m => m.order != null).map(m => m.order));
  for (const m of metas.filter(m => m.order == null).sort((a, b) => a.added - b.added)) { m.order = ++maxOrder; await DB.put('meta', m); }
  metas.sort((a, b) => a.order - b.order);
  shelf0.classList.toggle('edit', editMode);
  const shelf = shelf0; shelf.innerHTML = '';
  $('#empty').hidden = metas.length > 0;
  for (const [i, m] of metas.entries()) {
    const card = document.createElement('div'); card.className = 'card';
    let cover = '<div class="ph">' + esc(m.title) + '</div>';
    if (m.cover) {
      const u = URL.createObjectURL(new Blob([m.cover.buf], { type: m.cover.type || 'image/jpeg' })); coverURLs.push(u);
      cover = '<img alt="" src="' + u + '">';
    }
    const pct = Math.round((m.progress || 0) * 100);
    card.innerHTML = '<div class="cover">' + cover + '<div class="bar"><i style="width:' + pct + '%"></i></div></div>' +
      '<div class="t">' + esc(m.title) + '</div><div class="a">' + esc(m.author || '') + (pct ? (m.author ? ' · ' : '') + pct + '%' : '') + '</div>' +
      '<button class="del" aria-label="삭제">×</button>' +
      '<span class="pos">' + (i + 1) + '</span>';
    card.addEventListener('click', e => {
      if (e.target.closest('.del') || editMode) return;
      openBook(m.id);
    });
    $('.del', card).addEventListener('click', async e => {
      e.stopPropagation();
      if (await ask('“' + m.title + '”을(를) 삭제할까요?\n이 책의 북마크·메모도 함께 지워져요.', '삭제')) {
        await DB.del('meta', m.id); await DB.del('files', m.id); await DB.del('state', m.id); renderShelf(); toast('삭제했어요');
      }
    });
    if (editMode) attachDrag(card, m);
    shelf.appendChild(card);
  }
  $('#library').scrollTop = keep;
}


/* 꾹 눌러서 끌어 순서 바꾸기 (터치/마우스 공통) */
let dragActive = false;
document.addEventListener('touchmove', e => { if (dragActive) e.preventDefault(); }, { passive: false });
function attachDrag(card, meta) {
  let timer = null, startX = 0, startY = 0, dragging = false, pid = null, ghost = null, offX = 0, offY = 0, lastX = 0, lastY = 0, raf = 0;
  const lib = $('#library');
  const cancelTimer = () => { clearTimeout(timer); timer = null; };
  const place = () => {
    if (!dragging) return;
    ghost.style.left = (lastX - offX) + 'px'; ghost.style.top = (lastY - offY) + 'px';
    // 가장자리에서 자동 스크롤
    const r = lib.getBoundingClientRect();
    if (lastY < r.top + 70) lib.scrollTop -= 14; else if (lastY > r.bottom - 70) lib.scrollTop += 14;
    // 포인터 아래 카드 찾기 → 그 앞/뒤로 자리(빈칸) 이동
    const others = [...shelf0.children].filter(c => c !== card && !c.classList.contains('dragging'));
    for (const o of others) {
      const b = o.getBoundingClientRect();
      if (lastX >= b.left && lastX <= b.right && lastY >= b.top && lastY <= b.bottom) {
        const before = card.compareDocumentPosition(o) & Node.DOCUMENT_POSITION_FOLLOWING ? false : true;
        // 슬롯(자리 표시)을 o의 앞 또는 뒤로
        if (before) shelf0.insertBefore(slot, o); else shelf0.insertBefore(slot, o.nextSibling);
        break;
      }
    }
    raf = requestAnimationFrame(place);
  };
  let slot = null;
  const start = () => {
    dragging = true; dragActive = true;
    const r = card.getBoundingClientRect();
    offX = startX - r.left; offY = startY - r.top; lastX = startX; lastY = startY;
    slot = card; card.classList.add('ph-slot');
    ghost = card.cloneNode(true); ghost.classList.add('dragging'); ghost.classList.remove('ph-slot');
    ghost.style.width = r.width + 'px'; document.body.appendChild(ghost);
    if (navigator.vibrate) try { navigator.vibrate(15); } catch (e) {}
    raf = requestAnimationFrame(place);
  };
  const onMove = e => {
    if (e.pointerId !== pid) return;
    lastX = e.clientX; lastY = e.clientY;
    if (!dragging && timer && Math.hypot(e.clientX - startX, e.clientY - startY) > 8) { cancelTimer(); unlisten(); }
  };
  const onUp = e => { if (e.pointerId !== pid) return; const was = dragging; unlisten(); if (was) finish(true); else cancelTimer(); };
  const unlisten = () => { removeEventListener('pointermove', onMove); removeEventListener('pointerup', onUp); removeEventListener('pointercancel', onUp); };
  const finish = async commit => {
    cancelTimer(); cancelAnimationFrame(raf); unlisten();
    if (!dragging) return;
    dragging = false; dragActive = false; if (ghost) { ghost.remove(); ghost = null; }
    card.classList.remove('ph-slot');
    if (commit) {
      const ids = [...shelf0.children].map(c => c._id);
      const metas = await DB.all('meta'); const byId = Object.fromEntries(metas.map(m => [m.id, m]));
      for (let i = 0; i < ids.length; i++) { const m = byId[ids[i]]; if (m && m.order !== i + 1) { m.order = i + 1; await DB.put('meta', m); } }
    }
    renderShelf();
  };
  card._id = meta.id;
  card.addEventListener('pointerdown', e => {
    if (e.target.closest('.del') || (e.pointerType === 'mouse' && e.button !== 0)) return;
    pid = e.pointerId; startX = lastX = e.clientX; startY = lastY = e.clientY;
    cancelTimer(); unlisten(); timer = setTimeout(start, e.pointerType === 'mouse' ? 120 : 280);
    addEventListener('pointermove', onMove); addEventListener('pointerup', onUp); addEventListener('pointercancel', onUp);
  });
  card.addEventListener('contextmenu', e => e.preventDefault());
}

/* 본문 순서상 첫 번째 이미지를 표지로 사용 */
async function findFirstImage(b) {
  const mime = p => /\.png$/i.test(p) ? 'image/png' : /\.gif$/i.test(p) ? 'image/gif' : /\.webp$/i.test(p) ? 'image/webp' : /\.svg$/i.test(p) ? 'image/svg+xml' : 'image/jpeg';
  const items = b.spine.spineItems.slice(0, 6);
  for (const item of items) {
    try {
      const el = await item.load(b.load.bind(b));
      const doc = el.ownerDocument || el;
      const node = doc.querySelector('img[src], image, svg image');
      const src = node && (node.getAttribute('src') || node.getAttribute('xlink:href') || node.getAttribute('href'));
      item.unload();
      if (!src || /^data:/.test(src)) {
        if (src) { const blob = await (await fetch(src)).blob(); return { buf: await blob.arrayBuffer(), type: blob.type }; }
        continue;
      }
      const abs = decodeURIComponent(new URL(src, 'http://x' + item.url).pathname);
      const blob = await b.archive.getBlob(abs, mime(abs));
      if (blob && blob.size > 2000) return { buf: await blob.arrayBuffer(), type: blob.type || mime(abs) };
    } catch (e) { try { item.unload(); } catch (_) {} }
  }
  // 본문에 이미지가 없으면 목록 중 첫 이미지 파일
  try {
    const f = Object.keys(b.archive.zip.files).filter(n => /\.(jpe?g|png|webp|gif)$/i.test(n)).sort()[0];
    if (f) { const blob = await b.archive.getBlob('/' + f, mime(f)); if (blob) return { buf: await blob.arrayBuffer(), type: blob.type }; }
  } catch (e) {}
  return null;
}

async function importFile(file) {
  if (!/\.epub$/i.test(file.name) && file.type !== 'application/epub+zip') { toast('epub 파일만 추가할 수 있어요: ' + file.name); return; }
  const buf = await file.arrayBuffer();
  const id = await sha(buf);
  if (await DB.get('meta', id)) { toast('이미 서재에 있는 책이에요'); return; }
  let title = file.name.replace(/\.epub$/i, ''), author = '', cover = null;
  try {
    const b = ePub(buf.slice(0));
    await b.ready;
    const md = await b.loaded.metadata;
    if (md.title) title = md.title; if (md.creator) author = md.creator;
    cover = await findFirstImage(b);
    if (!cover) {
      try {
        const url = await b.coverUrl();
        if (url) { const blob = await (await fetch(url)).blob(); cover = { buf: await blob.arrayBuffer(), type: blob.type }; }
      } catch (e) {}
    }
    b.destroy();
  } catch (e) { console.warn(e); toast('책 정보를 읽지 못했어요. 파일이 손상되었을 수 있어요.'); return; }
  await DB.put('files', { id, data: buf });
  const all = await DB.all('meta');
  const order = Math.max(0, ...all.map(x => x.order || 0)) + 1;
  await DB.put('meta', { id, title, author, cover, added: Date.now(), opened: 0, progress: 0, size: buf.byteLength, order });
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
  toast('추가했어요: ' + title);
}
async function importFiles(files) {
  for (const f of files) await importFile(f);
  await renderShelf();
}
$('#fileInput').addEventListener('change', async e => { const f = [...e.target.files]; e.target.value = ''; await importFiles(f); });
let dragN = 0;
addEventListener('dragenter', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragN++; $('#dropHint').hidden = false; } });
addEventListener('dragleave', () => { dragN = Math.max(0, dragN - 1); if (!dragN) $('#dropHint').hidden = true; });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); dragN = 0; $('#dropHint').hidden = true; if (e.dataTransfer.files.length) importFiles([...e.dataTransfer.files]); });

$('#btnReorder').addEventListener('click', () => {
  editMode = !editMode;
  $('#btnReorder').textContent = editMode ? '완료' : '순서 편집';
  $('#btnReorder').classList.toggle('primary', editMode); $('#btnReorder').classList.toggle('ghost', !editMode);
  $('#reorderTip').hidden = !editMode;
  renderShelf();
});

/* 백업 / 복원 (북마크·메모·진행도·설정) */
$('#btnBackup').addEventListener('click', async () => {
  const metas = await DB.all('meta');
  const choice = await ask('백업 파일을 저장할까요?\n(책 제목, 읽던 위치, 북마크, 하이라이트·메모가 담겨요. 책 파일은 포함되지 않아요.)\n\n이미 만든 백업 파일을 불러오려면 아래 “불러오기”를 누르세요.', '저장하기');
  if (choice) {
    const states = await DB.all('state');
    const books = metas.map(m => ({ id: m.id, title: m.title, author: m.author }));
    states.forEach(s => delete s.locations);
    download('내서재-백업-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify({ v: 1, settings: S, books, states }, null, 1), 'application/json');
  } else {
    $('#restoreInput').click();
  }
});
$('#restoreInput').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const j = JSON.parse(await f.text()); let n = 0;
    for (const s of j.states || []) { const cur = await DB.get('state', s.id); await DB.put('state', { ...(cur || {}), ...s, locations: cur && cur.locations }); n++; }
    if (j.settings) { S = { ...S, ...j.settings }; saveSettings(); applyChromeTheme(); }
    toast('복원했어요 (' + n + '권). 해당 책을 서재에 추가하면 반영돼요.'); renderShelf();
  } catch (err) { toast('백업 파일을 읽지 못했어요'); }
});

/* iOS 홈 화면 추가 안내 */
(function () {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  let dismissed = false; try { dismissed = localStorage.getItem('tipDismissed') === '1'; } catch (e) {}
  if (ios && !standalone && !dismissed) $('#iosTip').hidden = false;
  $('#iosTipClose').addEventListener('click', () => { $('#iosTip').hidden = true; try { localStorage.setItem('tipDismissed', '1'); } catch (e) {} });
})();

/* =====================================================
   리더
   ===================================================== */
let book = null, rendition = null, cur = null; // cur: 현재 책 {id, meta, state}
let loc = null, tocFlat = [], locReady = false;
let cfiTool = null, searchMark = null;
const touchGuard = { t: 0 };

const saveState = debounce(async () => {
  if (!cur) return;
  await DB.put('state', cur.state);
  const m = await DB.get('meta', cur.id);
  if (m) { m.progress = cur.state.percentage || 0; m.opened = Date.now(); await DB.put('meta', m); }
}, 500);

function setView(name) { $('#library').hidden = name !== 'library'; $('#reader').hidden = name !== 'reader'; }

async function openBook(id) {
  const [meta, file, st] = await Promise.all([DB.get('meta', id), DB.get('files', id), DB.get('state', id)]);
  if (!meta || !file) { toast('책 파일을 찾을 수 없어요'); return; }
  setView('reader'); $('#loading').hidden = false;
  cur = { id, meta, state: { id, cfi: null, percentage: 0, bookmarks: [], highlights: [], ...(st || {}) } };
  $('#bookTitle').textContent = meta.title;
  locReady = false; loc = null; tocFlat = [];
  $('#slider').disabled = true; $('#slider').value = 0;
  try {
    await initEngine(file.data, cur.state.cfi);
    renderMarks(); renderNotes();
    $('#loading').hidden = true;
    setTimeout(() => setChrome(false), 1800);
  } catch (e) {
    console.error(e); $('#loading').hidden = true; toast('책을 열 수 없어요: ' + (e.message || e)); closeBook();
  }
}


/* epub.js 엔진 시작 (책 열기 / 보기 방식 변경 시 공통) */
async function initEngine(data, cfi) {
  book = ePub(data.slice(0));
  cfiTool = new ePub.CFI();
  locReady = false;
  createRendition();
  await book.ready;
  buildToc();
  await rendition.display(cfi || undefined);
  applyStyles();
  cur.state.highlights.forEach(addHighlightToView);
  if (cur.state.locations) { try { book.locations.load(cur.state.locations); locReady = true; } catch (e) {} }
  const b = book;
  if (!locReady) {
    b.locations.generate(1500).then(() => {
      if (b !== book || !cur) return;
      locReady = true; cur.state.locations = b.locations.save(); saveState(); refreshProgress();
    }).catch(() => {});
  } else refreshProgress();
  $('#slider').disabled = false;
}

function createRendition() {
  const scroll = S.flow === 'scroll';
  rendition = book.renderTo('viewer', {
    width: '100%', height: '100%',
    flow: scroll ? 'scrolled-doc' : 'paginated',
    spread: S.spread === 'none' || scroll ? 'none' : 'auto',
    minSpreadWidth: 1000,
    allowScriptedContent: false,
  });
  rendition.on('relocated', onRelocated);
  rendition.on('selected', onSelected);
  rendition.hooks.content.register(setupContent);
  rendition.on('rendered', () => { /* 새 섹션 렌더 */ });
  applyStyles();
}

function applyStyles() {
  applyChromeTheme();
  if (!rendition) return;
  const t = THEMES[S.theme];
  const family = FONTS[S.font];
  const body = {
    'background': t.bg + ' !important', 'color': t.fg + ' !important',
    'font-size': S.size + 'px !important', 'line-height': S.lh + ' !important',
    'text-align': (S.align === 'justify' ? 'justify' : 'left') + ' !important',
    'word-break': 'keep-all !important', 'overflow-wrap': 'break-word !important',
    '-webkit-text-size-adjust': '100% !important',
  };
  if (family) body['font-family'] = family + ' !important';
  const text = { 'color': 'inherit !important', 'background-color': 'transparent !important', 'line-height': 'inherit !important', 'font-size': '1em !important' };
  if (family) text['font-family'] = 'inherit !important';
  rendition.themes.default({
    'html': { 'background': t.bg + ' !important' },
    'body': body,
    'p, li, blockquote, dd, dt, td, th, span, div, section': text,
    'h1, h2, h3, h4, h5, h6': { 'color': 'inherit !important', 'background-color': 'transparent !important', 'line-height': '1.4 !important', ...(family ? { 'font-family': 'inherit !important' } : {}) },
    'a, a:link, a:visited': { 'color': t.link + ' !important' },
    'img, svg, video': { 'max-width': '100% !important', 'max-height': '92vh !important', 'height': 'auto !important', 'object-fit': 'contain !important' },
    '::selection': { 'background': 'rgba(80,130,255,.35)' },
  });
  rendition.themes.select('default');
}

/* 콘텐츠(iframe) 안에서 탭/스와이프/키보드 처리 */
function setupContent(contents) {
  const doc = contents.document, win = contents.window;
  const frame = win.frameElement;
  const px = e => (e.clientX ?? 0) + (frame ? frame.getBoundingClientRect().left : 0);
  let sx = 0, sy = 0, st = 0, tracking = false;
  doc.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { tracking = false; return; }
    tracking = true; sx = px(e.touches[0]); sy = e.touches[0].clientY; st = Date.now();
  }, { passive: true });
  doc.addEventListener('touchend', e => {
    if (!tracking) return; tracking = false;
    touchGuard.t = Date.now();
    const t = e.changedTouches[0], dx = px(t) - sx, dy = t.clientY - sy, dt = Date.now() - st;
    const sel = win.getSelection && win.getSelection().toString();
    if (sel) return;
    if (S.flow === 'paged' && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 800) { dx < 0 ? goNext() : goPrev(); return; }
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && dt < 500) handleTap(px(t), e.target);
  }, { passive: true });
  doc.addEventListener('click', e => {
    if (Date.now() - touchGuard.t < 700) return; // 터치는 위에서 처리
    if (win.getSelection && win.getSelection().toString()) return;
    handleTap(px(e), e.target);
  });
  doc.addEventListener('keydown', onKey);
}
function handleTap(x, target) {
  if (target && target.closest && target.closest('a')) return;
  if (!$('#annot').hidden) { closeAnnot(); return; }
  if (!$('#settings').hidden) { $('#settings').hidden = true; return; }
  const w = innerWidth;
  if (x < w * 0.28) goPrev();
  else if (x > w * 0.72) goNext();
  else toggleChrome();
}

function scrollEl() { return rendition && rendition.manager && rendition.manager.container; }
function goNext() {
  if (!rendition) return;
  if (S.flow === 'scroll') {
    const c = scrollEl();
    if (c && c.scrollTop + c.clientHeight < c.scrollHeight - 6) { c.scrollBy({ top: c.clientHeight * 0.88, behavior: 'smooth' }); return; }
  }
  rendition.next();
}
function goPrev() {
  if (!rendition) return;
  if (S.flow === 'scroll') {
    const c = scrollEl();
    if (c && c.scrollTop > 6) { c.scrollBy({ top: -c.clientHeight * 0.88, behavior: 'smooth' }); return; }
  }
  rendition.prev();
}
function onKey(e) {
  if (!cur || $('#reader').hidden) return;
  if (/INPUT|TEXTAREA/.test((e.target && e.target.tagName) || '')) return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault && e.preventDefault(); goNext(); }
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { goPrev(); }
  else if (e.key === 'Escape') { closeOverlays() || setChrome(true); }
}
addEventListener('keydown', onKey);

/* 크롬(상단/하단 바) */
function setChrome(show) { $('#topbar').classList.toggle('hide', !show); $('#bottombar').classList.toggle('hide', !show); }
function toggleChrome() { setChrome($('#topbar').classList.contains('hide')); }
function closeOverlays() {
  let any = false;
  if (!$('#drawer').hidden) { closeDrawer(); any = true; }
  if (!$('#settings').hidden) { $('#settings').hidden = true; any = true; }
  if (!$('#annot').hidden) { closeAnnot(); any = true; }
  return any;
}

/* 위치/진행도 */
function flattenToc(items, depth = 0, out = []) {
  for (const it of items || []) { out.push({ label: (it.label || '').trim(), href: it.href, depth }); flattenToc(it.subitems, depth + 1, out); }
  return out;
}
function spineIndexOf(href) {
  try { const s = book.spine.get(href.split('#')[0]); return s ? s.index : -1; } catch (e) { return -1; }
}
function chapterFor(cfiLoc) {
  let best = null, bi = -1;
  const idx = cfiLoc && cfiLoc.start ? cfiLoc.start.index : -1;
  for (const t of tocFlat) { if (t.idx <= idx && t.idx >= bi) { best = t; bi = t.idx; } }
  return best;
}
function onRelocated(l) {
  loc = l;
  const cfi = l.start.cfi;
  let pct = l.start.percentage || 0;
  if (locReady) { try { pct = book.locations.percentageFromCfi(cfi); } catch (e) {} }
  cur.state.cfi = cfi; cur.state.percentage = pct; saveState();
  refreshProgress();
  updateBookmarkButton();
  highlightToc();
}
function refreshProgress() {
  if (!loc) return;
  let pct = cur.state.percentage || 0;
  if (locReady) { try { pct = book.locations.percentageFromCfi(loc.start.cfi); cur.state.percentage = pct; } catch (e) {} }
  const ch = chapterFor(loc);
  $('#chapterLabel').textContent = ch ? ch.label : '';
  $('#progressLabel').textContent = (pct * 100).toFixed(1) + '%' + (locReady ? '' : ' (계산 중…)');
  $('#slider').value = Math.round(pct * 1000);
}
$('#slider').addEventListener('change', e => {
  if (!locReady) { toast('전체 위치 계산이 끝나면 사용할 수 있어요'); return; }
  const cfi = book.locations.cfiFromPercentage(e.target.value / 1000);
  rendition.display(cfi);
});
$('#slider').addEventListener('input', e => { $('#progressLabel').textContent = (e.target.value / 10).toFixed(1) + '%'; });
$('#btnPrev').addEventListener('click', goPrev);
$('#btnNext').addEventListener('click', goNext);

/* 목차 */
function buildToc() {
  tocFlat = flattenToc(book.navigation.toc).map(t => ({ ...t, idx: spineIndexOf(t.href) })).filter(t => t.idx >= 0);
  const box = $('#tab-toc'); box.innerHTML = '';
  if (!tocFlat.length) { box.innerHTML = '<div class="none">이 책에는 목차가 없어요</div>'; return; }
  tocFlat.forEach((t, i) => {
    const b = document.createElement('button'); b.className = 'toc-item'; b.dataset.i = i;
    b.style.paddingLeft = (10 + t.depth * 18) + 'px'; b.textContent = t.label || '(제목 없음)';
    b.onclick = () => { rendition.display(t.href); closeDrawer(); };
    box.appendChild(b);
  });
}
function highlightToc() {
  const ch = chapterFor(loc); if (!ch) return;
  const i = tocFlat.indexOf(ch);
  $$('#tab-toc .toc-item').forEach(b => b.classList.toggle('cur', +b.dataset.i === i));
}

/* 북마크 */
function bookmarkIn(l) {
  if (!l) return [];
  return cur.state.bookmarks.filter(b => {
    try { return cfiTool.compare(b.cfi, l.start.cfi) >= 0 && cfiTool.compare(b.cfi, l.end.cfi) <= 0; } catch (e) { return false; }
  });
}
function updateBookmarkButton() {
  const on = bookmarkIn(loc).length > 0;
  const b = $('#btnBookmark'); b.textContent = on ? '★' : '☆'; b.classList.toggle('on', on);
}
$('#btnBookmark').addEventListener('click', () => {
  if (!loc) return;
  const here = bookmarkIn(loc);
  if (here.length) { cur.state.bookmarks = cur.state.bookmarks.filter(b => !here.includes(b)); toast('북마크를 지웠어요'); }
  else {
    const ch = chapterFor(loc);
    let text = '';
    try { text = (rendition.getRange(loc.start.cfi).toString() || '').trim(); } catch (e) {}
    cur.state.bookmarks.push({ id: uid(), cfi: loc.start.cfi, label: ch ? ch.label : '', pct: cur.state.percentage, text: text.slice(0, 60), created: Date.now() });
    toast('북마크를 추가했어요');
  }
  saveState(); updateBookmarkButton(); renderMarks();
});
function renderMarks() {
  const box = $('#tab-marks'); const list = [...cur.state.bookmarks].sort((a, b) => (a.pct || 0) - (b.pct || 0));
  if (!list.length) { box.innerHTML = '<div class="none">북마크가 없어요<br>상단의 ☆ 를 눌러 지금 위치를 저장하세요</div>'; return; }
  box.innerHTML = '';
  list.forEach(b => {
    const w = document.createElement('div'); w.className = 'mark-wrap mark-row';
    w.innerHTML = '<button class="mark"><small>' + esc(b.label || '') + ' · ' + ((b.pct || 0) * 100).toFixed(1) + '%</small>' + esc(b.text || '(위치)') + '</button><button class="icon small" aria-label="삭제">🗑</button>';
    $('.mark', w).onclick = () => { rendition.display(b.cfi); closeDrawer(); };
    $('.icon', w).onclick = () => { cur.state.bookmarks = cur.state.bookmarks.filter(x => x !== b); saveState(); renderMarks(); updateBookmarkButton(); };
    box.appendChild(w);
  });
}

/* 하이라이트 / 메모 */
let annot = null; // {cfiRange, text, hl?}
function hlStyles(color) { return { 'fill': HL_COLORS[color] || color, 'fill-opacity': '0.38', 'mix-blend-mode': S.theme === 'dark' || S.theme === 'black' ? 'normal' : 'multiply' }; }
function addHighlightToView(h) {
  try {
    rendition.annotations.remove(h.cfiRange, 'highlight');
    rendition.annotations.add('highlight', h.cfiRange, { id: h.id }, () => openAnnotFor(h), 'hl-' + h.id, hlStyles(h.color));
  } catch (e) { console.warn('highlight failed', e); }
}
function onSelected(cfiRange, contents) {
  let text = '';
  try { text = rendition.getRange(cfiRange).toString().trim(); } catch (e) {}
  if (!text) return;
  const existing = cur.state.highlights.find(h => h.cfiRange === cfiRange);
  annot = { cfiRange, text, hl: existing || null, contents };
  showAnnot();
}
function openAnnotFor(h) { annot = { cfiRange: h.cfiRange, text: h.text, hl: h, contents: null }; showAnnot(); }
function showAnnot() {
  closeDrawer(); $('#settings').hidden = true;
  $('#annotQuote').textContent = annot.text.length > 140 ? annot.text.slice(0, 140) + '…' : annot.text;
  $('#annotNote').value = annot.hl ? (annot.hl.note || '') : '';
  $('#annotDelete').hidden = !annot.hl;
  setColorUI(annot.hl ? annot.hl.color : null);
  $('#annot').hidden = false;
}
function setColorUI(c) { $$('#annotColors button').forEach(b => b.classList.toggle('on', b.dataset.c === c)); }
function closeAnnot() {
  $('#annot').hidden = true;
  try { annot && annot.contents && annot.contents.window.getSelection().removeAllRanges(); } catch (e) {}
  annot = null;
}
function saveAnnot(color) {
  if (!annot) return;
  const note = $('#annotNote').value.trim();
  if (annot.hl) {
    annot.hl.note = note; if (color) annot.hl.color = color;
    addHighlightToView(annot.hl);
  } else {
    const col = color || 'yellow';
    const ch = chapterFor(loc);
    const h = { id: uid(), cfiRange: annot.cfiRange, text: annot.text, note, color: col, label: ch ? ch.label : '', pct: cur.state.percentage, created: Date.now() };
    cur.state.highlights.push(h); annot.hl = h; addHighlightToView(h);
    $('#annotDelete').hidden = false;
  }
  saveState(); renderNotes();
}
$('#annotColors').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  setColorUI(b.dataset.c); saveAnnot(b.dataset.c);
  try { annot.contents && annot.contents.window.getSelection().removeAllRanges(); } catch (e) {}
});
$('#annotSave').addEventListener('click', () => { saveAnnot($('#annotColors .on') ? $('#annotColors .on').dataset.c : 'yellow'); toast('저장했어요'); closeAnnot(); });
$('#annotClose').addEventListener('click', closeAnnot);
$('#annotCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(annot.text); toast('복사했어요'); } catch (e) { toast('복사할 수 없어요'); }
});
$('#annotDelete').addEventListener('click', () => {
  if (!annot || !annot.hl) return;
  try { rendition.annotations.remove(annot.hl.cfiRange, 'highlight'); } catch (e) {}
  cur.state.highlights = cur.state.highlights.filter(h => h !== annot.hl);
  saveState(); renderNotes(); closeAnnot(); toast('삭제했어요');
});
function renderNotes() {
  const box = $('#noteList'); const list = [...cur.state.highlights].sort((a, b) => (a.pct || 0) - (b.pct || 0));
  if (!list.length) { box.innerHTML = '<div class="none">하이라이트·메모가 없어요<br>글자를 길게 눌러 선택하면 표시할 수 있어요</div>'; return; }
  box.innerHTML = '';
  list.forEach(h => {
    const d = document.createElement('div'); d.className = 'note-card'; d.style.setProperty('--c', HL_COLORS[h.color]);
    d.innerHTML = '<small>' + esc(h.label || '') + ' · ' + ((h.pct || 0) * 100).toFixed(1) + '%</small><div class="q">' + esc(h.text) + '</div>' + (h.note ? '<div class="n">' + esc(h.note) + '</div>' : '') +
      '<div class="row-actions"><button class="btn ghost small">편집</button></div>';
    $('.q', d).onclick = () => { rendition.display(h.cfiRange); closeDrawer(); };
    $('.btn', d).onclick = () => openAnnotFor(h);
    box.appendChild(d);
  });
}
$('#btnExportNotes').addEventListener('click', () => {
  const list = [...cur.state.highlights].sort((a, b) => (a.pct || 0) - (b.pct || 0));
  if (!list.length && !cur.state.bookmarks.length) { toast('내보낼 내용이 없어요'); return; }
  let md = '# ' + cur.meta.title + '\n' + (cur.meta.author ? '_' + cur.meta.author + '_\n' : '') + '\n';
  if (list.length) md += '## 하이라이트·메모\n\n' + list.map(h => '> ' + h.text.replace(/\n+/g, ' ') + '\n' + (h.note ? '\n' + h.note + '\n' : '') + '\n— ' + (h.label || '') + ' (' + ((h.pct || 0) * 100).toFixed(0) + '%)\n').join('\n') + '\n';
  if (cur.state.bookmarks.length) md += '## 북마크\n\n' + cur.state.bookmarks.map(b => '- ' + (b.label || '') + ' (' + ((b.pct || 0) * 100).toFixed(0) + '%) ' + (b.text || '')).join('\n') + '\n';
  download((cur.meta.title || 'notes').replace(/[\\/:*?"<>|]/g, '_') + '-메모.md', md, 'text/markdown');
});

/* 검색 */
let searchToken = 0;
$('#searchForm').addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('#searchInput').value.trim(); if (!q) return;
  $('#searchInput').blur();
  const token = ++searchToken, box = $('#searchResults'), status = $('#searchStatus');
  box.innerHTML = ''; clearSearchMark();
  const items = book.spine.spineItems; let found = 0; const MAX = 300;
  for (let i = 0; i < items.length; i++) {
    if (token !== searchToken) return;
    const item = items[i];
    status.textContent = '검색 중… ' + Math.round((i / items.length) * 100) + '% (' + found + '건)';
    let res = [];
    try { await item.load(book.load.bind(book)); res = item.find(q) || []; } catch (err) {} finally { try { item.unload(); } catch (e) {} }
    const ch = chapterFor({ start: { index: item.index } });
    for (const r of res) {
      if (found >= MAX) break; found++;
      const b = document.createElement('button'); b.className = 'res';
      const ex = r.excerpt || '', k = ex.toLowerCase().indexOf(q.toLowerCase());
      const html = k >= 0 ? esc(ex.slice(0, k)) + '<mark>' + esc(ex.slice(k, k + q.length)) + '</mark>' + esc(ex.slice(k + q.length)) : esc(ex);
      b.innerHTML = '<small>' + esc(ch ? ch.label : '') + '</small>' + html;
      b.onclick = async () => {
        clearSearchMark();
        await rendition.display(r.cfi);
        try { rendition.annotations.highlight(r.cfi, {}, () => {}, 'search-hl', { 'fill': '#ff8a00', 'fill-opacity': '0.45' }); searchMark = r.cfi; } catch (e) {}
        closeDrawer();
      };
      box.appendChild(b);
    }
    if (found >= MAX) break;
  }
  if (token === searchToken) status.textContent = found ? (found >= MAX ? MAX + '건 이상 찾았어요' : found + '건 찾았어요') : '검색 결과가 없어요';
});
function clearSearchMark() { if (searchMark) { try { rendition.annotations.remove(searchMark, 'highlight'); } catch (e) {} searchMark = null; } }

/* 드로어 */
function openDrawer(tab) {
  $('#settings').hidden = true; closeAnnot();
  $('#drawer').hidden = false; $('#scrim').hidden = false; setTab(tab || 'toc');
  if ((tab || 'toc') === 'toc') { const c = $('#tab-toc .cur'); if (c) c.scrollIntoView({ block: 'center' }); }
  if (tab === 'search') setTimeout(() => $('#searchInput').focus(), 50);
}
function closeDrawer() { $('#drawer').hidden = true; $('#scrim').hidden = true; }
function setTab(t) {
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  ['toc', 'search', 'marks', 'notes'].forEach(n => ($('#tab-' + n).hidden = n !== t));
}
$$('.tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
$('#drawerClose').addEventListener('click', closeDrawer);
$('#scrim').addEventListener('click', closeDrawer);
$('#btnToc').addEventListener('click', () => openDrawer('toc'));

/* 설정 시트 */
function syncSettingsUI() {
  $('#fsVal').textContent = S.size + 'px'; $('#lhVal').textContent = S.lh.toFixed(1);
  $$('#settings .seg').forEach(seg => $$('button', seg).forEach(b => b.classList.toggle('on', S[seg.dataset.key] === b.dataset.v)));
}
$('#btnSettings').addEventListener('click', () => { closeDrawer(); closeAnnot(); const s = $('#settings'); s.hidden = !s.hidden; syncSettingsUI(); });
$$('[data-close]').forEach(b => b.addEventListener('click', () => ($('#' + b.dataset.close).hidden = true)));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
$('#fsDown').onclick = () => { S.size = clamp(S.size - 1, 12, 48); changed(); };
$('#fsUp').onclick = () => { S.size = clamp(S.size + 1, 12, 48); changed(); };
$('#lhDown').onclick = () => { S.lh = clamp(Math.round((S.lh - 0.1) * 10) / 10, 1.2, 2.8); changed(); };
$('#lhUp').onclick = () => { S.lh = clamp(Math.round((S.lh + 0.1) * 10) / 10, 1.2, 2.8); changed(); };
$$('#settings .seg').forEach(seg => seg.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const k = seg.dataset.key; S[k] = b.dataset.v; changed(k);
}));
function changed(key) {
  saveSettings(); syncSettingsUI(); applyChromeTheme();
  if (!rendition) return;
  if (key === 'flow' || key === 'spread') { rebuildRendition(); return; }
  applyStyles();
  // 글자 크기/줄간격이 바뀌면 같은 위치를 유지
  if (loc && (key === undefined)) rendition.display(cur.state.cfi);
  if (key === 'theme') cur.state.highlights.forEach(addHighlightToView);
}
async function rebuildRendition() {
  const cfi = cur.state.cfi;
  const file = await DB.get('files', cur.id);
  try { rendition.destroy(); } catch (e) {}
  try { book.destroy(); } catch (e) {}
  $('#viewer').innerHTML = '';
  await initEngine(file.data, cfi);
}

/* 책 닫기 */
function closeBook() {
  saveState.flush();
  closeOverlays();
  try { rendition && rendition.destroy(); } catch (e) {}
  try { book && book.destroy(); } catch (e) {}
  rendition = null; book = null; cur = null; loc = null; $('#viewer').innerHTML = '';
  setChrome(true); setView('library'); renderShelf();
}
$('#btnBack').addEventListener('click', closeBook);
document.addEventListener('visibilitychange', () => { if (document.hidden && cur) saveState.flush(); });
addEventListener('pagehide', () => { if (cur) saveState.flush(); });
addEventListener('beforeunload', () => { if (cur) saveState.flush(); });

/* 시작 */
(async function init() {
  applyChromeTheme();
  try { await DB.open(); } catch (e) { toast('이 브라우저에서는 저장소를 사용할 수 없어요 (사생활 보호 모드?)', 6000); return; }
  await renderShelf();
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
})();
