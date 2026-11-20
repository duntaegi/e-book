const V = 'reader-v1';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'stats.js', 'sync.js', 'manifest.json', 'lib/epub.min.js', 'lib/jszip.min.js', 'icons/icon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// 네트워크 우선(최신 코드 반영) → 실패 시 캐시 (오프라인에서도 열림)
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // 동기화 서버(Firestore) 통신은 저장하지 않고 그대로 보냄 (실시간 연결이 끊기지 않게)
  try { const h = new URL(e.request.url).hostname; if (h.endsWith('googleapis.com') || h.endsWith('firebaseio.com')) return; } catch (err) {}
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => { const copy = r.clone(); caches.open(V).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
