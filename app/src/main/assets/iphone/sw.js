// App-shell only. Never cache authenticated requests, SMS bodies or credentials.
const CACHE = 'sms-shell-v10';
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(c => c.addAll(['/', '/manifest.webmanifest','/icon-192.png','/icon-512.png']))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k.startsWith('sms-shell-') && k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin || !(['/', '/index.html', '/manifest.webmanifest','/icon-192.png','/icon-512.png'].includes(url.pathname) || url.pathname.startsWith('/assets/')) || event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok) { const copy=response.clone(); event.waitUntil(caches.open(CACHE).then(c=>c.put(event.request,copy))); }
    return response;
  }).catch(()=>caches.open(CACHE).then(c=>c.match(event.request)).then(r=>r || Response.error())));
});
self.addEventListener('push', event => {
  let payload;
  try { payload = event.data?.json(); } catch { /* Older or invalid payload. */ }
  const preview = typeof payload?.title === 'string' && typeof payload?.body === 'string';
  const address = preview && typeof payload.address === 'string' ? payload.address.slice(0,100) : '';
  const notification = self.registration.showNotification(preview ? payload.title : '互联信息', {
    body: preview ? payload.body : '收到一条新短信',
    icon: '/icon-192.png', tag: address ? 'sms-' + address : 'sms', data: {address}
  });
  // Push can arrive while the app is closed. Opening the app reconciles the count.
  const badge = payload?.badge === false || !self.navigator?.setAppBadge
    ? Promise.resolve()
    : self.navigator.setAppBadge().catch(() => {});
  event.waitUntil(Promise.all([notification, badge]));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const address = event.notification.data?.address;
  const path = address ? '/#conversation=' + encodeURIComponent(address) : '/';
  event.waitUntil((async () => {
    const windows = await clients.matchAll({type: 'window'});
    const client = windows.find(w => new URL(w.url).pathname === '/');
    if (client && address) {
      try {
        const target = await client.navigate(new URL(path, self.location.origin).href);
        if (target) { await target.focus(); return; }
      } catch { /* A closing window can disappear before navigation. */ }
    }
    await clients.openWindow(path);
  })());
});
