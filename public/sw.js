// なにが目的なん？ ONLINE — サービスワーカー（ホーム画面に追加・プッシュ通知）
// ゲーム本体は常に最新を読み込む（ネット優先）。オフラインのときだけ保存しておいた画面を出す。
const CACHE = 'nm-v26.4.0';
const PRE = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png', 'privacy.html'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRE)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/socket.io') || u.pathname.startsWith('/api/')) return;   // 通信はそのまま
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok && (u.pathname === '/' || /\.(html|png|webmanifest)$/.test(u.pathname))) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }
    return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
// 🔔 プッシュ通知を受け取って表示する
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (er) { d = { title: 'なにが目的なん？', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'なにが目的なん？', { body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: d.tag || 'nm', renotify: true, data: { url: d.url || './' } }));
});
// 通知を押したら、ゲームを開く（もう開いていればそのタブに切りかえる）
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => { for (const w of ws) if (w.url.startsWith(self.registration.scope) && 'focus' in w) return w.focus(); return self.clients.openWindow(url); }));
});
