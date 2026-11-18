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
// Serialise pushes so an older, slower response cannot replace a newer count.
let badgeUpdate = Promise.resolve();
function updateSmsBadge(payload) {
  badgeUpdate=badgeUpdate.then(async()=>{
    if(!self.navigator?.setAppBadge)return;
    try {
      const raw=payload?.app_badge ?? payload?.notification?.app_badge;
      const included=typeof raw==='string'&&/^\d+$/.test(raw)?Number(raw):raw;
      if(Number.isSafeInteger(included)&&included>=0){
        if(included)await self.navigator.setAppBadge(included);else await self.navigator.clearAppBadge?.();
        return;
      }
      const request=()=>fetch('/api/badge',{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(6000)});
      let response=await request();
      if(response.status===401){
        const renewed=await fetch('/api/refresh',{method:'POST',credentials:'include',signal:AbortSignal.timeout(6000)});
        if(!renewed.ok)return;
        response=await request();
      }
      if(!response.ok)return;
      const {count}=await response.json();
      if(!Number.isSafeInteger(count)||count<0)return;
      if(count)await self.navigator.setAppBadge(count);else await self.navigator.clearAppBadge?.();
    }catch{/* Offline or expired access is not an unread count. Leave the badge alone. */}
  });
  return badgeUpdate;
}
self.addEventListener('push', event => {
  // Declarative pushes are displayed by iOS itself. Do not replace its proposal
  // with a generic notification or perform a background network request.
  if(event.notification){event.waitUntil(Promise.resolve());return;}
  let payload;
  try { payload = event.data?.json(); } catch { /* Older or invalid payload. */ }
  const content=payload?.web_push===8030 ? payload.notification : payload;
  const preview = typeof content?.title === 'string' && typeof content?.body === 'string';
  const sender=content?.data?.address ?? payload?.address;
  const address = preview && typeof sender === 'string' ? sender.slice(0,100) : '';
  const notification = self.registration.showNotification(preview ? content.title : '互联信息', {
    body: preview ? content.body : '收到一条新短信',
    icon: '/icon-192.png', tag: address ? 'sms-' + address : 'sms', data: {address}
  });
  // Never replace the unread total with a synthetic 1 on each notification.
  const badge = payload?.badge === false ? Promise.resolve() : updateSmsBadge(payload);
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
