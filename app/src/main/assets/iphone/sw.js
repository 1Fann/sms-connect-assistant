// App-shell only. Never cache authenticated requests, SMS bodies or credentials.
const CACHE = 'sms-shell-v10';
// Publish an updated shell only after its versioned entry chunks are available.
async function refreshShell(request, cache) {
  const response=await fetch(request);
  if(response.ok) {
    try {
      const html=await response.clone().text();
      const assets=[...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map(m=>m[1]))];
      await Promise.all(assets.map(async path=>{
        const url=new URL(path,self.location.origin).href;
        if(await cache.match(url))return;
        const asset=await fetch(url);
        if(!asset.ok)throw Error('Shell asset unavailable');
        await cache.put(url,asset);
      }));
      await cache.put(new URL('/',self.location.origin).href,response.clone());
    } catch { /* Keep the previous complete shell when an update is interrupted. */ }
  }
  return response;
}
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(c => Promise.all([
  refreshShell(new URL('/',self.location.origin).href,c),
  c.addAll(['/manifest.webmanifest','/icon-192.png','/icon-512.png'])
]))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k.startsWith('sms-shell-') && k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin || !(['/', '/index.html', '/manifest.webmanifest','/icon-192.png','/icon-512.png'].includes(url.pathname) || url.pathname.startsWith('/assets/')) || event.request.method !== 'GET') return;
  if(url.pathname==='/' || url.pathname==='/index.html') {
    const cache=caches.open(CACHE);
    const update=cache.then(c=>refreshShell(event.request,c));
    event.waitUntil(update.then(()=>{}).catch(()=>{}));
    event.respondWith(cache.then(c=>c.match(new URL('/',self.location.origin).href))
      .then(cached=>cached || update).catch(()=>Response.error()));
    return;
  }
  // Content-hashed assets have a new URL whenever their contents change.
  if (/^\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.(?:js|css)$/.test(url.pathname)) {
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE);
      const cached=await cache.match(event.request);
      if(cached)return cached;
      const response=await fetch(event.request);
      if(response.ok)event.waitUntil(cache.put(event.request,response.clone()));
      return response;
    })());
    return;
  }
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
  event.waitUntil(Promise.allSettled([notification, badge]));
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
