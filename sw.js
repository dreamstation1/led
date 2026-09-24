// Cache the complete local app, including the published TOPIS route shapes.
// Live API requests and map tiles keep their normal network behavior.
const CACHE_NAME='bus-map-shell-v26-20260924-mobile-sim-audio';
const SHELL_FILES=['./','./index.html','./planner.js','./route-shapes.js','./route-geometry.js','./gyeonggi-data.js','./manifest.webmanifest','./icon.png','./apple-touch-icon.png'];
const SHELL_URLS=new Set(SHELL_FILES.map(file=>new URL(file,self.registration.scope).href));

const PLANNER_PATCH=String.raw`

/* 2026-09-24: iPhone audio + robust simulation + follow fix */
(function(){
  if(typeof window==='undefined')return;

  let mobileGuideAudio=null;
  let mobileGuideAudioPrimed=false;
  let audioObjectUrl=null;
  let lastSimPanAt=0;

  function getMobileGuideAudio(){
    if(mobileGuideAudio)return mobileGuideAudio;
    mobileGuideAudio=document.createElement('audio');
    mobileGuideAudio.preload='auto';
    mobileGuideAudio.playsInline=true;
    mobileGuideAudio.setAttribute('playsinline','');
    mobileGuideAudio.setAttribute('webkit-playsinline','');
    mobileGuideAudio.style.display='none';
    document.body.appendChild(mobileGuideAudio);
    return mobileGuideAudio;
  }

  function primeMobileGuideAudio(){
    if(mobileGuideAudioPrimed)return;
    try{
      const a=getMobileGuideAudio();
      a.pause();
      a.src='audio/KBS.wav';
      a.currentTime=0;
      a.muted=false;
      a.volume=0;
      a.playbackRate=1;
      const p=a.play();
      if(p&&p.then){
        p.then(function(){
          a.pause();
          try{a.currentTime=0;}catch(e){}
          a.volume=(typeof guideVolume==='number'?guideVolume:1);
          mobileGuideAudioPrimed=true;
        }).catch(function(){});
      }else{
        mobileGuideAudioPrimed=true;
      }
    }catch(e){}

    try{
      const AC=window.AudioContext||window.webkitAudioContext;
      if(AC){
        window.__guideAudioContext=window.__guideAudioContext||new AC();
        if(window.__guideAudioContext.state==='suspended')window.__guideAudioContext.resume().catch(function(){});
      }
    }catch(e){}

    try{
      if('speechSynthesis' in window){
        const u=new SpeechSynthesisUtterance(' ');
        u.volume=0;
        speechSynthesis.speak(u);
        speechSynthesis.cancel();
      }
    }catch(e){}
  }

  document.addEventListener('pointerdown',primeMobileGuideAudio,{capture:true,passive:true});
  document.addEventListener('touchstart',primeMobileGuideAudio,{capture:true,passive:true});
  document.addEventListener('click',primeMobileGuideAudio,{capture:true,passive:true});
  try{ unlockAudioForMobile=primeMobileGuideAudio; }catch(e){}

  async function fetchAudioBlob(src){
    const controller=('AbortController' in window)?new AbortController():null;
    const timer=setTimeout(function(){if(controller)controller.abort();},8000);
    try{
      const res=await fetch(src,{cache:'force-cache',signal:controller?controller.signal:undefined});
      if(!res.ok)return null;
      return await res.blob();
    }catch(e){
      return null;
    }finally{
      clearTimeout(timer);
    }
  }

  playClip=async function(src){
    const blob=await fetchAudioBlob(src);
    if(!blob){
      try{audioMissCache.add(src);}catch(e){}
      return false;
    }

    return await new Promise(function(resolve){
      const a=getMobileGuideAudio();
      let done=false;
      let startTimer=null;
      let hardTimer=null;

      function cleanup(){
        clearTimeout(startTimer);clearTimeout(hardTimer);
        a.removeEventListener('ended',onEnded);
        a.removeEventListener('error',onError);
        a.removeEventListener('playing',onPlaying);
      }
      function finish(ok){
        if(done)return;
        done=true;
        cleanup();
        if(!ok){try{a.pause();}catch(e){}}
        if(audioObjectUrl){try{URL.revokeObjectURL(audioObjectUrl);}catch(e){}audioObjectUrl=null;}
        resolve(ok);
      }
      function onEnded(){finish(true);}
      function onError(){finish(false);}
      function onPlaying(){clearTimeout(startTimer);}

      try{
        a.pause();
        if(audioObjectUrl){try{URL.revokeObjectURL(audioObjectUrl);}catch(e){}}
        audioObjectUrl=URL.createObjectURL(blob);
        a.src=audioObjectUrl;
        a.muted=false;
        a.volume=(typeof guideVolume==='number'?guideVolume:1);
        a.playbackRate=(typeof guideRate==='number'?guideRate:1);
        a.addEventListener('ended',onEnded);
        a.addEventListener('error',onError);
        a.addEventListener('playing',onPlaying);
        startTimer=setTimeout(function(){finish(false);},6000);
        hardTimer=setTimeout(function(){finish(false);},120000);
        const p=a.play();
        if(p&&p.catch)p.catch(function(){finish(false);});
      }catch(e){finish(false);}
    });
  };

  playClipAnyExt=async function(paths){
    for(const p of paths){
      if(await playClip(p))return true;
    }
    return false;
  };

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

  try{
    startGuideSim=function(){
      if(!currentGuideStops || currentGuideStops.length<2)return;
      if(!currentRoutePath || currentRoutePath.length<2){
        try{status.textContent='노선 경로를 불러온 뒤 다시 시뮬레이션해 주세요.';}catch(e){}
        return;
      }

      if(guideWatchId!=null){
        try{navigator.geolocation.clearWatch(guideWatchId);}catch(e){}
        guideWatchId=null;
      }
      if(guideSimRaf!=null){cancelAnimationFrame(guideSimRaf);guideSimRaf=null;}

      guideActive=true;
      const startIdx=Math.min(Math.max(guideStartIdx||0,0),currentGuideStops.length-2);
      guideNextIndex=startIdx+1;
      guideApproachAnnounced=false;
      guideMinDistToTarget=Infinity;
      guideLastLat=guideLastLng=guideHeadingDeg=null;
      markGuideProgress();
      renderGuideBar();
      updateGuideStatus();
      try{if(ledConnected)ledUploadRoute();}catch(e){}
      try{status.textContent='시뮬레이션을 시작합니다'+(startIdx>0?' · '+currentGuideStops[startIdx].name+'에서 출발':'')+' (속도 '+fmtSpeed(simSpeedMultiplier)+')';}catch(e){}

      const path=currentRoutePath;
      const totalLen=pathLengthM(path);
      const stopArcs=stopArcLengthsAlongPath(path,currentGuideStops);
      let traveled=Math.max(0,Math.min(totalLen,stopArcs[startIdx]||0));
      let lastTs=null;
      let dwellUntil=0;

      const initial=pointAtDistanceM(path,traveled);
      onGuidePosition(initial[0],initial[1]);

      function tick(now){
        if(!guideActive){guideSimRaf=null;return;}
        if(lastTs==null)lastTs=now;
        let dt=(now-lastTs)/1000;
        lastTs=now;
        if(!Number.isFinite(dt)||dt<0)dt=0;
        dt=Math.min(dt,0.25);

        if(now<dwellUntil){
          guideSimRaf=requestAnimationFrame(tick);
          return;
        }

        const speed=(typeof SIM_BASE_SPEED_MPS==='number'?SIM_BASE_SPEED_MPS:14)*Math.max(0.1,simSpeedMultiplier||1);
        const beforeIdx=guideNextIndex;
        traveled=Math.min(totalLen,traveled+speed*dt);
        const pos=pointAtDistanceM(path,traveled);
        onGuidePosition(pos[0],pos[1]);

        if(guideActive && guideNextIndex>beforeIdx && guideNextIndex<currentGuideStops.length){
          dwellUntil=now+(GUIDE_DWELL_MS/Math.max(0.1,simSpeedMultiplier||1));
        }

        if(traveled>=totalLen-0.01){
          const last=path[path.length-1];
          onGuidePosition(last[0],last[1]);
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

async function patchedPlannerResponse(response){
  const text=await response.text();
  const headers=new Headers(response.headers);
  headers.set('content-type','application/javascript; charset=utf-8');
  headers.delete('content-length');
  return new Response(text+PLANNER_PATCH,{status:response.status,statusText:response.statusText,headers});
}

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

  if(url.href===new URL('./planner.js',self.registration.scope).href){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE_NAME);
      let res=null;
      try{
        res=await fetch(req,{cache:'no-cache'});
        if(res&&res.ok)await cache.put(url.href,res.clone());
      }catch(e){
        res=await cache.match(url.href);
      }
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
