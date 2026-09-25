// App shell v48: corrected Gyeonggi coordinates and stop-ordered road routing.
const CACHE_NAME='bus-map-shell-v49-20260925-announcement-pauses';
const SHELL_FILES=['./','./index.html','./planner.js','./request-guard.js','./mobile-patch.js','./gapless-patch.js','./traffic-map-patch.js','./ios-touch-patch.js','./gyeonggi-stops-patch.js','./route-shapes.js','./route-geometry.js','./gyeonggi-data.js','./manifest.webmanifest','./icon.png','./apple-touch-icon.png'];
const SHELL_URLS=new Set(SHELL_FILES.map(f=>new URL(f,self.registration.scope).href));
const PATCH_URLS=new Set(['request-guard.js','mobile-patch.js','gapless-patch.js','traffic-map-patch.js','ios-touch-patch.js','gyeonggi-stops-patch.js'].map(f=>new URL('./'+f,self.registration.scope).href));
const PAGE_PATCH='<script src="./request-guard.js?v=47"></script><script src="./mobile-patch.js?v=47"></script><script src="./gapless-patch.js?v=49"></script><script src="./traffic-map-patch.js?v=47"></script><script src="./ios-touch-patch.js?v=47"></script><script src="./gyeonggi-stops-patch.js?v=47"></script>';
async function patchedHtmlResponse(response){
 let text=await response.text();
 text=text.replace(/<script src="\.\/(?:request-guard|mobile-patch|gapless-patch|traffic-map-patch|ios-touch-patch|gyeonggi-stops-patch)\.js\?v=\d+"><\/script>/g,'');
 if(!text.includes('gyeonggi-stops-patch.js?v=47'))text=/<\/body>/i.test(text)?text.replace(/<\/body>/i,PAGE_PATCH+'</body>'):text+PAGE_PATCH;
 const h=new Headers(response.headers);h.set('content-type','text/html; charset=utf-8');h.delete('content-length');
 return new Response(text,{status:response.status,statusText:response.statusText,headers:h});
}
self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ns=>Promise.all(ns.filter(n=>n.startsWith('bus-map-shell-')&&n!==CACHE_NAME).map(n=>caches.delete(n)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const req=event.request;if(req.method!=='GET'||new URL(req.url).origin!==location.origin)return;
 if(req.mode==='navigate'){event.respondWith((async()=>{const c=await caches.open(CACHE_NAME);let r=null;try{r=await fetch(req,{cache:'no-cache'});if(r&&r.ok)await c.put(new URL('./index.html',self.registration.scope).href,r.clone())}catch(e){r=await c.match(new URL('./index.html',self.registration.scope).href)}if(!r)r=await c.match(new URL('./index.html',self.registration.scope).href);return r?patchedHtmlResponse(r):r})());return}
 const u=new URL(req.url);u.search='';if(!SHELL_URLS.has(u.href))return;
 event.respondWith((async()=>{const c=await caches.open(CACHE_NAME);if(PATCH_URLS.has(u.href)){try{const f=await fetch(req,{cache:'no-cache'});if(f.ok){await c.put(u.href,f.clone());return f}}catch(e){}const x=await c.match(u.href);if(x)return x;return fetch(req)}const x=await c.match(u.href);if(x)return x;const r=await fetch(req);if(r.ok)await c.put(u.href,r.clone());return r})());
});