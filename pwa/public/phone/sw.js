const cacheName='commlink-phone-shell-v1';
const app='/phone/';
const shell=[app,app+'manifest.webmanifest',app+'icon-192.png',app+'icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(cacheName).then(cache=>cache.addAll(shell))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(
  keys.filter(k=>k.startsWith('commlink-phone-shell-') && k!==cacheName).map(k=>caches.delete(k))
))));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||!(shell.includes(url.pathname)||url.pathname.startsWith('/assets/')))return;
  event.respondWith((async()=>{
    const cache=await caches.open(cacheName);
    try {
      const response=await fetch(event.request);
      if(response.ok)await cache.put(event.request,response.clone());
      return response;
    } catch { return await cache.match(event.request)||Response.error() }
  })());
});
self.addEventListener('push',event=>event.waitUntil(Promise.all([
  self.registration.showNotification('互联电话',{body:'有新的未接来电',tag:'phone-missed',icon:app+'icon-192.png'}),
  self.navigator.setAppBadge?.().catch(()=>{})
])));
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
