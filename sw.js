// App shell v70: red-to-green prediction and adjacent bus stops.
const CACHE_NAME='bus-map-shell-v152-20261024-audio-manager';
const SHELL_FILES=['./audio-settings.json','./audio-library-manager.js','./subway.js','./subway-api.js','./subway-routing.js','./data/subway-network.json','./','./index.html','./audio-library.html','./audio-files.json','./planner.js','./request-guard.js','./mobile-patch.js','./gapless-patch.js','./traffic-map-patch.js','./utic-map-patch.js','./traffic-intersections.js','./cctv-data.json','./ios-touch-patch.js','./gyeonggi-stops-patch.js','./route-shapes.js','./route-geometry.js','./gyeonggi-data.js','./manifest.webmanifest','./icon.png','./apple-touch-icon.png'];
const SHELL_URLS=new Set(SHELL_FILES.map(f=>new URL(f,self.registration.scope).href));
const PATCH_URLS=new Set(['audio-settings.json','audio-library-manager.js','subway.js','subway-api.js','subway-routing.js','planner.js','request-guard.js','mobile-patch.js','gapless-patch.js','traffic-map-patch.js','utic-map-patch.js','ios-touch-patch.js','gyeonggi-stops-patch.js','audio-files.json'].map(f=>new URL('./'+f,self.registration.scope).href));
const PAGE_PATCH='<script src="./request-guard.js?v=47"></script><script src="./mobile-patch.js?v=63"></script><script src="./gapless-patch.js?v=69"></script><script src="./traffic-map-patch.js?v=81"></script><script src="./utic-map-patch.js?v=73"></script><script src="./ios-touch-patch.js?v=54"></script><script src="./gyeonggi-stops-patch.js?v=47"></script>';
async function patchedHtmlResponse(response){
 let text=await response.text();
 // Refresh the planner URL even when the HTML came from an older offline shell.
 text=text.replace(/<script src=["'](?:\.\/)?planner\.js(?:\?[^"']*)?["']><\/script>/g,'<script src="./planner.js?v=20261020-mobile2"></script>');
 text=text.replace(/<script src="\.\/(?:request-guard|mobile-patch|gapless-patch|traffic-map-patch|utic-map-patch|ios-touch-patch|gyeonggi-stops-patch)\.js\?v=\d+"><\/script>/g,'');
 if(!text.includes('traffic-map-patch.js?v=81'))text=/<\/body>/i.test(text)?text.replace(/<\/body>/i,PAGE_PATCH+'</body>'):text+PAGE_PATCH;
 if(!text.includes('subway.js?'))text=text.replace(/<\/body>/i,'<script src="./subway-routing.js?v=1"></script><script src="./subway-api.js?v=1"></script><script src="./subway.js?v=1"></script></body>');
 const h=new Headers(response.headers);h.set('content-type','text/html; charset=utf-8');h.delete('content-length');
 return new Response(text,{status:response.status,statusText:response.statusText,headers:h});
}
self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ns=>Promise.all(ns.filter(n=>n.startsWith('bus-map-shell-')&&n!==CACHE_NAME).map(n=>caches.delete(n)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const req=event.request;if(req.method!=='GET'||new URL(req.url).origin!==location.origin)return;
 // Only the main map is an app-shell page. Other pages under this scope (the
 // driver assistant in driver/, the extension download...) are left alone:
 // they must not get the map's patch scripts or be cached as index.html.
 const nav=new URL(req.url),scope=new URL(self.registration.scope);
 if(req.mode==='navigate'&&nav.pathname!==scope.pathname&&nav.pathname!==scope.pathname+'index.html')return;
 if(req.mode==='navigate'){event.respondWith((async()=>{const c=await caches.open(CACHE_NAME);let r=null;try{r=await fetch(req,{cache:'no-cache'});if(r&&r.ok)await c.put(new URL('./index.html',self.registration.scope).href,r.clone())}catch(e){r=await c.match(new URL('./index.html',self.registration.scope).href)}if(!r)r=await c.match(new URL('./index.html',self.registration.scope).href);return r?patchedHtmlResponse(r):r})());return}
 const u=new URL(req.url);u.search='';if(!SHELL_URLS.has(u.href))return;
 event.respondWith((async()=>{const c=await caches.open(CACHE_NAME);if(PATCH_URLS.has(u.href)){try{const f=await fetch(req,{cache:'no-cache'});if(f.ok){await c.put(u.href,f.clone());return f}}catch(e){}const x=await c.match(u.href);if(x)return x;return fetch(req)}const x=await c.match(u.href);if(x)return x;const r=await fetch(req);if(r.ok)await c.put(u.href,r.clone());return r})());
});
