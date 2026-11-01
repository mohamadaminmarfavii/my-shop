const CACHE='haftghalam-web-shell-v1-1';
const SHELL=['./haftghalam-mobile-web-v1.1.html'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE&&k.startsWith('haftghalam-web-shell-')).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const u=new URL(event.request.url);
  if(event.request.mode==='navigate'&&u.origin===self.location.origin){
    event.respondWith(fetch(event.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put('./haftghalam-mobile-web-v1.1.html',copy));return r}).catch(()=>caches.match('./haftghalam-mobile-web-v1.1.html')));
  }
});
self.addEventListener('message',event=>{
  if(event.data&&event.data.type==='REFRESH_CACHE'){
    event.waitUntil(caches.delete(CACHE).then(()=>caches.open(CACHE)).then(c=>c.addAll(SHELL)));
  }
});
