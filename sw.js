// App shell + mobile audio/simulation compatibility patch.
const CACHE_NAME='bus-map-shell-v28-20260924-adaptive-announcement';
const SHELL_FILES=['./','./index.html','./planner.js','./route-shapes.js','./route-geometry.js','./gyeonggi-data.js','./manifest.webmanifest','./icon.png','./apple-touch-icon.png'];
const SHELL_URLS=new Set(SHELL_FILES.map(file=>new URL(file,self.registration.scope).href));

const PLANNER_PATCH=String.raw`
(function(){
  if(typeof window==='undefined')return;
  let lastSimPanAt=0;

  function adaptiveFraction(segmentM){
    if(segmentM<=200)return 0.5;
    if(segmentM>=1000)return 2/3;
    return 0.5+((segmentM-200)/800)*(1/6);
  }

  function adaptiveRemainingRadius(segmentM){
    return Math.max(20,segmentM*(1-adaptiveFraction(segmentM)));
  }

  // Live GPS also uses an automatic distance-dependent trigger.
  try{
    const baseOnGuidePosition=onGuidePosition;
    onGuidePosition=function(lat,lng){
      let savedRadius=guideApproachRadiusM;
      try{
        if(guideActive && guideWatchId!=null && guideNextIndex>0 && guideNextIndex<currentGuideStops.length){
          const prev=currentGuideStops[guideNextIndex-1];
          const target=currentGuideStops[guideNextIndex];
          if(prev&&target){
            const segmentM=hav(prev.lat,prev.lng,target.lat,target.lng);
            guideApproachRadiusM=adaptiveRemainingRadius(segmentM);
          }
        }
        return baseOnGuidePosition(lat,lng);
      }finally{
        guideApproachRadiusM=savedRadius;
      }
    };
  }catch(e){}

  try{
    const oldUpdateGuideMarker=updateGuideMarker;
    updateGuideMarker=function(lat,lng){
      oldUpdateGuideMarker(lat,lng);
      if(guideActive && guideWatchId==null && typeof map!=='undefined'){
        const now=performance.now();
        if(now-lastSimPanAt>100){
          lastSimPanAt=now;
          try{map.panTo([lat,lng],{animate:false});}catch(e){}
        }
      }
    };
  }catch(e){}

  function simPositionWithoutFixedRadius(lat,lng){
    const saved=guideApproachRadiusM;
    try{
      guideApproachRadiusM=0;
      onGuidePosition(lat,lng);
    }finally{
      guideApproachRadiusM=saved;
    }
  }

  function maybeAdaptiveSimAnnouncement(traveled,stopArcs){
    if(!guideActive || guideApproachAnnounced)return;
    const idx=guideNextIndex;
    if(idx<=0 || idx>=currentGuideStops.length)return;
    const startArc=stopArcs[idx-1]??0;
    const endArc=stopArcs[idx]??startArc;
    const segmentM=Math.max(0,endArc-startArc);
    if(segmentM<=0)return;
    const triggerArc=startArc+segmentM*adaptiveFraction(segmentM);
    if(traveled<triggerArc)return;
    const target=currentGuideStops[idx];
    const next=currentGuideStops[idx+1]||null;
    announceArrival(target,next);
    guideApproachAnnounced=true;
    try{if(ledConnected)ledSetIndex(idx);}catch(e){}
  }

  try{
    startGuideSim=function(){
      if(!currentGuideStops || currentGuideStops.length<2)return;
      if(!currentRoutePath || currentRoutePath.length<2){
        try{status.textContent='노선 경로를 불러온 뒤 다시 시뮬레이션해 주세요.';}catch(e){}
        return;
      }
      if(guideWatchId!=null){try{navigator.geolocation.clearWatch(guideWatchId);}catch(e){} guideWatchId=null;}
      if(guideSimRaf!=null){cancelAnimationFrame(guideSimRaf);guideSimRaf=null;}

      guideActive=true;
      const startIdx=Math.min(Math.max(guideStartIdx||0,0),currentGuideStops.length-2);
      guideNextIndex=startIdx+1;
      guideApproachAnnounced=false;
      guideMinDistToTarget=Infinity;
      guideLastLat=guideLastLng=guideHeadingDeg=null;
      markGuideProgress();renderGuideBar();updateGuideStatus();
      try{if(ledConnected)ledUploadRoute();}catch(e){}

      const path=currentRoutePath;
      const totalLen=pathLengthM(path);
      const stopArcs=stopArcLengthsAlongPath(path,currentGuideStops);
      let traveled=Math.max(0,Math.min(totalLen,stopArcs[startIdx]||0));
      let lastTs=null,dwellUntil=0;

      const initial=pointAtDistanceM(path,traveled);
      simPositionWithoutFixedRadius(initial[0],initial[1]);

      function tick(now){
        if(!guideActive){guideSimRaf=null;return;}
        if(lastTs==null)lastTs=now;
        let dt=(now-lastTs)/1000;lastTs=now;
        if(!Number.isFinite(dt)||dt<0)dt=0;
        dt=Math.min(dt,0.25);
        if(now<dwellUntil){guideSimRaf=requestAnimationFrame(tick);return;}

        const speed=(typeof SIM_BASE_SPEED_MPS==='number'?SIM_BASE_SPEED_MPS:14)*Math.max(0.1,simSpeedMultiplier||1);
        const beforeIdx=guideNextIndex;
        traveled=Math.min(totalLen,traveled+speed*dt);

        // Short segments (<=200m): announce halfway.
        // Long segments (>=1km): announce around 2/3 of the way.
        // 200m..1km transitions smoothly between those two points.
        maybeAdaptiveSimAnnouncement(traveled,stopArcs);

        const pos=pointAtDistanceM(path,traveled);
        simPositionWithoutFixedRadius(pos[0],pos[1]);

        if(guideActive && guideNextIndex>beforeIdx && guideNextIndex<currentGuideStops.length){
          dwellUntil=now+(GUIDE_DWELL_MS/Math.max(0.1,simSpeedMultiplier||1));
        }
        if(traveled>=totalLen-0.01){
          const last=path[path.length-1];
          simPositionWithoutFixedRadius(last[0],last[1]);
          guideSimRaf=null;
          return;
        }
        guideSimRaf=requestAnimationFrame(tick);
      }
      guideSimRaf=requestAnimationFrame(tick);
    };
  }catch(e){console.error('simulation patch failed',e);}
})();
`;

const PAGE_PATCH=String.raw`<script>
(function(){
  if(window.__gaplessAudioV28)return;
  window.__gaplessAudioV28=true;

  const BufferCache=new Map();
  const LoadCache=new Map();
  let ctx=null;
  let prefetchTimer=null;

  function getCtx(){
    if(ctx)return ctx;
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC)return null;
    ctx=new AC();
    window.__guideAudioContext=ctx;
    return ctx;
  }

  function primeAudio(){
    const c=getCtx();
    if(c && c.state==='suspended')c.resume().catch(function(){});
    try{
      if('speechSynthesis' in window){
        const u=new SpeechSynthesisUtterance(' ');
        u.volume=0;
        speechSynthesis.speak(u);
        setTimeout(function(){try{speechSynthesis.cancel();}catch(e){}},0);
      }
    }catch(e){}
    preloadOne('audio/thisstopis.wav');
    preloadOne('audio/KBS.wav');
  }

  document.addEventListener('pointerdown',primeAudio,{capture:true,passive:true});
  document.addEventListener('touchstart',primeAudio,{capture:true,passive:true});
  document.addEventListener('click',primeAudio,{capture:true,passive:true});
  window.unlockAudioForMobile=primeAudio;

  async function decodeArrayBuffer(c,ab){
    return await new Promise(function(resolve,reject){
      let settled=false;
      function ok(b){if(!settled){settled=true;resolve(b);}}
      function bad(e){if(!settled){settled=true;reject(e);}}
      try{
        const p=c.decodeAudioData(ab.slice(0),ok,bad);
        if(p&&p.then)p.then(ok,bad);
      }catch(e){bad(e);}
    });
  }

  function preloadOne(src){
    if(!src)return Promise.resolve(null);
    if(BufferCache.has(src))return Promise.resolve(BufferCache.get(src));
    if(LoadCache.has(src))return LoadCache.get(src);
    const p=(async function(){
      try{
        const c=getCtx();
        if(!c)return null;
        const res=await fetch(src,{cache:'force-cache'});
        if(!res.ok)return null;
        const ab=await res.arrayBuffer();
        const buf=await decodeArrayBuffer(c,ab);
        BufferCache.set(src,buf);
        return buf;
      }catch(e){return null;}
      finally{LoadCache.delete(src);}
    })();
    LoadCache.set(src,p);
    return p;
  }

  function playBuffer(buf){
    return new Promise(async function(resolve){
      const c=getCtx();
      if(!c||!buf){resolve(false);return;}
      try{if(c.state==='suspended')await c.resume();}catch(e){}
      try{
        const src=c.createBufferSource();
        const gain=c.createGain();
        src.buffer=buf;
        src.playbackRate.value=(typeof window.guideRate==='number'?window.guideRate:1);
        gain.gain.value=(typeof window.guideVolume==='number'?window.guideVolume:1);
        src.connect(gain);gain.connect(c.destination);
        let done=false;
        const timer=setTimeout(function(){if(!done){done=true;try{src.stop();}catch(e){}resolve(false);}},120000);
        src.onended=function(){if(done)return;done=true;clearTimeout(timer);resolve(true);};
        src.start(c.currentTime+0.005);
      }catch(e){resolve(false);}
    });
  }

  window.playClip=async function(src){
    const buf=await preloadOne(src);
    if(!buf){try{window.audioMissCache&&window.audioMissCache.add(src);}catch(e){} return false;}
    return await playBuffer(buf);
  };

  window.playClipAnyExt=async function(paths){
    if(!Array.isArray(paths)||!paths.length)return false;
    const loads=paths.map(preloadOne);
    for(let i=0;i<paths.length;i++){
      const buf=await loads[i];
      if(buf)return await playBuffer(buf);
    }
    return false;
  };

  function possibleAudioPathsForStop(stop){
    const out=[];
    if(!stop)return out;
    const names=[];
    ['name','nameEn','enName','englishName','engName'].forEach(function(k){if(stop[k])names.push(stop[k]);});
    names.forEach(function(name){
      try{
        if(typeof window.audioPaths==='function'){
          const p=window.audioPaths(name);
          if(Array.isArray(p))out.push.apply(out,p);
        }
      }catch(e){}
      out.push('audio/'+name+'.wav');
      out.push('audio/'+name+' (1).wav');
    });
    return [...new Set(out)];
  }

  function preloadUpcoming(){
    try{
      if(!Array.isArray(window.currentGuideStops))return;
      const i=Math.max(0,Number(window.guideNextIndex)||0);
      for(let n=i;n<Math.min(window.currentGuideStops.length,i+3);n++){
        possibleAudioPathsForStop(window.currentGuideStops[n]).forEach(preloadOne);
      }
    }catch(e){}
  }

  try{
    const originalOnGuidePosition=window.onGuidePosition;
    if(typeof originalOnGuidePosition==='function'){
      window.onGuidePosition=function(){
        const r=originalOnGuidePosition.apply(this,arguments);
        if(!prefetchTimer)prefetchTimer=setTimeout(function(){prefetchTimer=null;preloadUpcoming();},50);
        return r;
      };
    }
  }catch(e){}

  try{
    const originalStartGuideSim=window.startGuideSim;
    if(typeof originalStartGuideSim==='function'){
      window.startGuideSim=function(){primeAudio();preloadUpcoming();return originalStartGuideSim.apply(this,arguments);};
    }
  }catch(e){}

  setTimeout(function(){preloadOne('audio/thisstopis.wav');preloadOne('audio/KBS.wav');preloadUpcoming();},300);
})();
</script>`;

async function patchedPlannerResponse(response){
  const text=await response.text();
  const headers=new Headers(response.headers);
  headers.set('content-type','application/javascript; charset=utf-8');
  headers.delete('content-length');
  return new Response(text+PLANNER_PATCH,{status:response.status,statusText:response.statusText,headers});
}

async function patchedHtmlResponse(response){
  let text=await response.text();
  if(text.includes('__gaplessAudioV28'))return new Response(text,{status:response.status,statusText:response.statusText,headers:response.headers});
  if(/<\/body>/i.test(text))text=text.replace(/<\/body>/i,PAGE_PATCH+'</body>');
  else text+=PAGE_PATCH;
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
  if(url.href===new URL('./planner.js',self.registration.scope).href){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE_NAME);
      let res=null;
      try{res=await fetch(req,{cache:'no-cache'});if(res&&res.ok)await cache.put(url.href,res.clone());}
      catch(e){res=await cache.match(url.href);}
      if(!res)res=await cache.match(url.href);
      return res?patchedPlannerResponse(res):new Response(PLANNER_PATCH,{headers:{'content-type':'application/javascript; charset=utf-8'}});
    })());
    return;
  }

  if(!SHELL_URLS.has(url.href))return;
  event.respondWith(caches.open(CACHE_NAME).then(async cache=>{
    const cached=await cache.match(url.href);
    if(cached)return cached;
    const res=await fetch(req);
    if(res.ok)await cache.put(url.href,res.clone());
    return res;
  }));
});
