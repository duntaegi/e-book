const V = 'reader-v10';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'manifest.json', 'lib/epub.min.js', 'lib/jszip.min.js', 'icons/icon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// 네트워크 우선(최신 코드 반영) → 실패 시 캐시 (오프라인에서도 열림)
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(V).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
