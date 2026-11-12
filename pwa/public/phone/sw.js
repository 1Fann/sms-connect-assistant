// App-shell only. Never cache authenticated requests, SMS bodies or credentials.
const CACHE = 'commlink-phone-shell-v3';
const app='/phone/';
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
      await cache.put(new URL('/phone/',self.location.origin).href,response.clone());
    } catch { /* Keep the previous complete shell when an update is interrupted. */ }
  }
  return response;
}
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(c => Promise.all([
  refreshShell(new URL('/phone/',self.location.origin).href,c),
  c.addAll(['/phone/manifest.webmanifest','/phone/icon-192.png','/phone/icon-512.png'])
]))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k.startsWith('commlink-phone-shell-') && k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin || !(['/phone', '/phone/', '/phone/index.html', '/phone/manifest.webmanifest','/phone/icon-192.png','/phone/icon-512.png'].includes(url.pathname) || url.pathname.startsWith('/assets/')) || event.request.method !== 'GET') return;
  if(url.pathname==='/phone/' || url.pathname==='/phone' || url.pathname==='/phone/index.html') {
    const cache=caches.open(CACHE);
    const update=cache.then(c=>refreshShell(event.request,c));
    event.waitUntil(update.then(()=>{}).catch(()=>{}));
    event.respondWith(cache.then(c=>c.match(new URL('/phone/',self.location.origin).href))
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
async function updateMissedBadge(){
  try {
    const request=()=>fetch('/api/v2/call-history/missed',{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(6000)});
    let response=await request();
    if(response.status===401){
      const renewed=await fetch('/api/refresh',{method:'POST',credentials:'include',signal:AbortSignal.timeout(6000)});
      if(renewed.ok)response=await request();
      else return; // Authentication failure is not proof that the calls were viewed.
    }
    if(response.status===401||response.status===403)return;
    if(!response.ok)throw Error('Badge count unavailable');
    const {count}=await response.json();
    if(!Number.isInteger(count)||count<0)throw Error('Invalid badge count');
    if(count)await self.navigator.setAppBadge?.(count);else await self.navigator.clearAppBadge?.();
  }catch{/* The push's initial dot remains when the network is unavailable. */}
}
self.addEventListener('push',event=>event.waitUntil((async()=>{
  await Promise.allSettled([
    self.registration.showNotification('互联电话',{body:'有新的未接来电',tag:'phone-missed',icon:app+'icon-192.png'}),
    self.navigator.setAppBadge?.()
  ]);
  await updateMissedBadge();
  for(const client of await clients.matchAll({type:'window'}))client.postMessage({type:'phone-missed-updated'});
})()));
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const url=new URL('/phone/#missed',self.location.origin).href;
    for(const w of await clients.matchAll({type:'window'})) {
      if(new URL(w.url).pathname!==app)continue;
      try {const target=await w.navigate(url);if(target)return await target.focus()} catch {}
    }
    return clients.openWindow(url);
  })());
});
