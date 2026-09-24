// App shell. v30 loads route/signal fixes, then the true gapless announcement queue.
const CACHE_NAME='bus-map-shell-v30-20260924-true-gapless';
const SHELL_FILES=['./','./index.html','./planner.js','./mobile-patch.js','./gapless-patch.js','./route-shapes.js','./route-geometry.js','./gyeonggi-data.js','./manifest.webmanifest','./icon.png','./apple-touch-icon.png'];
const SHELL_URLS=new Set(SHELL_FILES.map(file=>new URL(file,self.registration.scope).href));
const PAGE_PATCH='<script src="./mobile-patch.js?v=30"></script><script src="./gapless-patch.js?v=30"></script>';

async function patchedHtmlResponse(response){
  let text=await response.text();
  if(!text.includes('gapless-patch.js?v=30')){
    if(/<\/body>/i.test(text))text=text.replace(/<\/body>/i,PAGE_PATCH+'</body>');
    else text+=PAGE_PATCH;
  }
  const headers=new Headers(response.headers);
  headers.set('content-type','text/html; charset=utf-8');
  headers.delete('content-length');
  return new Response(text,{status:response.status,statusText:response.statusText,headers});
}

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(SHELL_FILES)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(names=>Promise.all(
    names.filter(n=>n.startsWith('bus-map-shell-')&&n!==CACHE_NAME).map(n=>caches.delete(n))
  )).then(()=>self.clients.claim()));
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET' || new URL(req.url).origin!==location.origin)return;

  if(req.mode==='navigate'){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE_NAME);
      let res=null;
      try{
        res=await fetch(req,{cache:'no-cache'});
        if(res&&res.ok)await cache.put(new URL('./index.html',self.registration.scope).href,res.clone());
      }catch(e){res=await cache.match(new URL('./index.html',self.registration.scope).href);}
      if(!res)res=await cache.match(new URL('./index.html',self.registration.scope).href);
      return res?patchedHtmlResponse(res):res;
    })());
    return;
  }

  const url=new URL(req.url);url.search='';
  if(!SHELL_URLS.has(url.href))return;
  event.respondWith(caches.open(CACHE_NAME).then(async cache=>{
    if(url.href===new URL('./mobile-patch.js',self.registration.scope).href || url.href===new URL('./gapless-patch.js',self.registration.scope).href){
      try{const fresh=await fetch(req,{cache:'no-cache'});if(fresh.ok){await cache.put(url.href,fresh.clone());return fresh;}}catch(e){}
    }
    const cached=await cache.match(url.href);
    if(cached)return cached;
    const res=await fetch(req);
    if(res.ok)await cache.put(url.href,res.clone());
    return res;
  }));
});