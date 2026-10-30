// App-shell only. Never cache authenticated requests, SMS bodies or credentials.
const CACHE = 'sms-shell-v5';
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(c => c.addAll(['/', '/manifest.webmanifest','/icon-192.png','/icon-512.png']))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin || url.pathname.startsWith('/api/') || event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok) { const copy=response.clone(); event.waitUntil(caches.open(CACHE).then(c=>c.put(event.request,copy))); }
    return response;
  }).catch(()=>caches.match(event.request).then(r=>r || Response.error())));
});
self.addEventListener('push', event => event.waitUntil(self.registration.showNotification('短信互联助手', {body:'收到一条新短信',icon:'/icon-192.png',tag:'sms'})));
self.addEventListener('notificationclick', event => {event.notification.close(); event.waitUntil(clients.openWindow('/'));});
