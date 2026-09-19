// Cache the complete local app, including the published TOPIS route shapes.
// Live API requests and map tiles keep their normal network behavior.
const CACHE_NAME='bus-map-shell-v18-20260919';
const SHELL_FILES=['./','./index.html','./planner.js','./route-shapes.js','./route-geometry.js','./gyeonggi-data.js','./manifest.webmanifest','./icon.png','./apple-touch-icon.png'];
const SHELL_URLS=new Set(SHELL_FILES.map(file=>new URL(file,self.registration.scope).href));

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(SHELL_FILES)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys().then(names=>Promise.all(
      names.filter(n=>n.startsWith('bus-map-shell-')&&n!==CACHE_NAME).map(n=>caches.delete(n))
    )).then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET' || new URL(req.url).origin!==location.origin)return;
  if(req.mode==='navigate'){
    event.respondWith(
      fetch(req).then(res=>{
        if(res && res.ok){
          const copy=res.clone();
          event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.put(new URL('./index.html',self.registration.scope).href,copy)));
        }
        return res;
      }).catch(()=>caches.match(new URL('./index.html',self.registration.scope).href))
    );
    return;
  }
  const url=new URL(req.url);url.search='';
  if(!SHELL_URLS.has(url.href))return;
  event.respondWith(caches.open(CACHE_NAME).then(async cache=>{
    const cached=await cache.match(url.href);
    if(cached)return cached;
    const res=await fetch(req);
    if(res.ok)await cache.put(url.href,res.clone());
    return res;
  }));
});
