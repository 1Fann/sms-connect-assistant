const cacheName='commlink-phone-shell-v2';
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
