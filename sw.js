// App shell. v39 avoids eager multi-megabyte downloads and reduces GitHub Pages request bursts.
const CACHE_NAME='bus-map-shell-v39-20260924-lazy-cache';
const SHELL_FILES=['./','./index.html','./planner.js','./request-guard.js','./mobile-patch.js','./gapless-patch.js','./traffic-map-patch.js','./ios-touch-patch.js','./route-shapes.js','./route-geometry.js','./gyeonggi-data.js','./manifest.webmanifest','./icon.png','./apple-touch-icon.png'];
const SHELL_URLS=new Set(SHELL_FILES.map(file=>new URL(file,self.registration.scope).href));
const PATCH_URLS=new Set(['request-guard.js','mobile-patch.js','gapless-patch.js','traffic-map-patch.js','ios-touch-patch.js'].map(f=>new URL('./'+f,self.registration.scope).href));
const PAGE_PATCH='<script src="./request-guard.js?v=39"></script><script src="./mobile-patch.js?v=39"></script><script src="./gapless-patch.js?v=39"></script><script src="./traffic-map-patch.js?v=39"></script><script src="./ios-touch-patch.js?v=39"></script>';

async function patchedHtmlResponse(response){
  let text=await response.text();
  if(!text.includes('request-guard.js?v=39')){
    if(/<\/body>/i.test(text))text=text.replace(/<\/body>/i,PAGE_PATCH+'</body>');
    else text+=PAGE_PATCH;
  }
  const headers=new Headers(response.headers);
  headers.set('content-type','text/html; charset=utf-8');headers.delete('content-length');
  return new Response(text,{status:response.status,statusText:response.statusText,headers});
}

// Do not cache the entire app during install. route-shapes.js + gyeonggi-data.js are huge,
// and repeatedly downloading them during every service-worker update can trigger Pages limits.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(
  caches.keys().then(names=>Promise.all(names.filter(n=>n.startsWith('bus-map-shell-')&&n!==CACHE_NAME).map(n=>caches.delete(n)))).then(()=>self.clients.claim())
));

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET'||new URL(req.url).origin!==location.origin)return;

  if(req.mode==='navigate'){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE_NAME);let res=null;
      try{
        res=await fetch(req,{cache:'no-cache'});
        if(res&&res.ok)await cache.put(new URL('./index.html',self.registration.scope).href,res.clone());
      }catch(e){res=await cache.match(new URL('./index.html',self.registration.scope).href);}
      if(!res)res=await cache.match(new URL('./index.html',self.registration.scope).href);
      return res?patchedHtmlResponse(res):res;
    })());return;
  }

  const url=new URL(req.url);url.search='';
  if(!SHELL_URLS.has(url.href))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE_NAME);

    // Small patch files: refresh once when requested, then keep a fallback copy.
    if(PATCH_URLS.has(url.href)){
      try{const fresh=await fetch(req,{cache:'no-cache'});if(fresh.ok){await cache.put(url.href,fresh.clone());return fresh;}}catch(e){}
      const cached=await cache.match(url.href);if(cached)return cached;
      return fetch(req);
    }

    // Large static route/data files: cache-first and fetch only when actually needed.
    const cached=await cache.match(url.href);if(cached)return cached;
    const res=await fetch(req);
    if(res.ok)await cache.put(url.href,res.clone());
    return res;
  })());
});