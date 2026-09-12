// Minimal app-shell cache so the map still opens (with whatever stop/route
// data was baked into index.html at last load) without a network connection,
// and so Chrome/Android treat the page as an installable PWA. Only the
// handful of local files are cached - map tiles, the OSRM routing calls, and
// the Google Translate lookups are all left to the network as normal, never
// intercepted here, so nothing about live map/route data changes.
const CACHE_NAME='bus-map-shell-v1';
const SHELL_FILES=['./','./index.html','./manifest.webmanifest','./icon.png','./apple-touch-icon.png'];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache=>cache.addAll(SHELL_FILES)).catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys().then(names=>Promise.all(
      names.filter(n=>n!==CACHE_NAME).map(n=>caches.delete(n))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET' || new URL(req.url).origin!==location.origin)return;
  event.respondWith(
    caches.match(req).then(cached=>{
      const network=fetch(req).then(res=>{
        if(res && res.ok){
          const copy=res.clone();
          caches.open(CACHE_NAME).then(cache=>cache.put(req,copy));
        }
        return res;
      }).catch(()=>cached);
      return cached || network;
    })
  );
});
