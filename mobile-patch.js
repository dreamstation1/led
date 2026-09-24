(function(){
  if(window.__mobilePatchV29)return;
  window.__mobilePatchV29=true;

  /* ---------- adaptive guide + simulation ---------- */
  let lastSimPanAt=0;
  function adaptiveFraction(segmentM){
    if(segmentM<=200)return 0.5;
    if(segmentM>=1000)return 2/3;
    return 0.5+((segmentM-200)/800)*(1/6);
  }
  function adaptiveRemainingRadius(segmentM){return Math.max(20,segmentM*(1-adaptiveFraction(segmentM)));}

  try{
    const baseOnGuidePosition=onGuidePosition;
    onGuidePosition=function(lat,lng){
      let savedRadius=guideApproachRadiusM;
      try{
        if(guideActive && guideWatchId!=null && guideNextIndex>0 && guideNextIndex<currentGuideStops.length){
          const prev=currentGuideStops[guideNextIndex-1], target=currentGuideStops[guideNextIndex];
          if(prev&&target)guideApproachRadiusM=adaptiveRemainingRadius(hav(prev.lat,prev.lng,target.lat,target.lng));
        }
        return baseOnGuidePosition(lat,lng);
      }finally{guideApproachRadiusM=savedRadius;}
    };
  }catch(e){}

  try{
    const oldUpdateGuideMarker=updateGuideMarker;
    updateGuideMarker=function(lat,lng){
      oldUpdateGuideMarker(lat,lng);
      if(guideActive && guideWatchId==null && typeof map!=='undefined'){
        const now=performance.now();
        if(now-lastSimPanAt>100){lastSimPanAt=now;try{map.panTo([lat,lng],{animate:false});}catch(e){}}
      }
    };
  }catch(e){}

  function simPositionWithoutFixedRadius(lat,lng){
    const saved=guideApproachRadiusM;
    try{guideApproachRadiusM=0;onGuidePosition(lat,lng);}finally{guideApproachRadiusM=saved;}
  }
  function maybeAdaptiveSimAnnouncement(traveled,stopArcs){
    if(!guideActive || guideApproachAnnounced)return;
    const idx=guideNextIndex;
    if(idx<=0 || idx>=currentGuideStops.length)return;
    const startArc=stopArcs[idx-1]??0,endArc=stopArcs[idx]??startArc,segmentM=Math.max(0,endArc-startArc);
    if(segmentM<=0 || traveled<startArc+segmentM*adaptiveFraction(segmentM))return;
    const target=currentGuideStops[idx],next=currentGuideStops[idx+1]||null;
    announceArrival(target,next);guideApproachAnnounced=true;
    try{if(ledConnected)ledSetIndex(idx);}catch(e){}
  }
  try{
    startGuideSim=function(){
      if(!currentGuideStops || currentGuideStops.length<2)return;
      if(!currentRoutePath || currentRoutePath.length<2){try{status.textContent='노선 경로를 불러온 뒤 다시 시뮬레이션해 주세요.';}catch(e){}return;}
      if(guideWatchId!=null){try{navigator.geolocation.clearWatch(guideWatchId);}catch(e){}guideWatchId=null;}
      if(guideSimRaf!=null){cancelAnimationFrame(guideSimRaf);guideSimRaf=null;}
      guideActive=true;
      const startIdx=Math.min(Math.max(guideStartIdx||0,0),currentGuideStops.length-2);
      guideNextIndex=startIdx+1;guideApproachAnnounced=false;guideMinDistToTarget=Infinity;
      guideLastLat=guideLastLng=guideHeadingDeg=null;
      markGuideProgress();renderGuideBar();updateGuideStatus();
      try{if(ledConnected)ledUploadRoute();}catch(e){}
      const path=currentRoutePath,totalLen=pathLengthM(path),stopArcs=stopArcLengthsAlongPath(path,currentGuideStops);
      let traveled=Math.max(0,Math.min(totalLen,stopArcs[startIdx]||0)),lastTs=null,dwellUntil=0;
      const initial=pointAtDistanceM(path,traveled);simPositionWithoutFixedRadius(initial[0],initial[1]);
      function tick(now){
        if(!guideActive){guideSimRaf=null;return;}
        if(lastTs==null)lastTs=now;
        let dt=(now-lastTs)/1000;lastTs=now;if(!Number.isFinite(dt)||dt<0)dt=0;dt=Math.min(dt,0.25);
        if(now<dwellUntil){guideSimRaf=requestAnimationFrame(tick);return;}
        const speed=(typeof SIM_BASE_SPEED_MPS==='number'?SIM_BASE_SPEED_MPS:14)*Math.max(0.1,simSpeedMultiplier||1);
        const beforeIdx=guideNextIndex;traveled=Math.min(totalLen,traveled+speed*dt);
        maybeAdaptiveSimAnnouncement(traveled,stopArcs);
        const pos=pointAtDistanceM(path,traveled);simPositionWithoutFixedRadius(pos[0],pos[1]);
        if(guideActive && guideNextIndex>beforeIdx && guideNextIndex<currentGuideStops.length)dwellUntil=now+(GUIDE_DWELL_MS/Math.max(0.1,simSpeedMultiplier||1));
        if(traveled>=totalLen-0.01){const last=path[path.length-1];simPositionWithoutFixedRadius(last[0],last[1]);guideSimRaf=null;return;}
        guideSimRaf=requestAnimationFrame(tick);
      }
      guideSimRaf=requestAnimationFrame(tick);
    };
  }catch(e){console.error('simulation patch failed',e);}

  /* ---------- gapless iPhone audio ---------- */
  const BufferCache=new Map(),LoadCache=new Map();
  let audioCtx=null,prefetchTimer=null;
  function getCtx(){
    if(audioCtx)return audioCtx;
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return null;
    audioCtx=new AC();window.__guideAudioContext=audioCtx;return audioCtx;
  }
  async function decodeArrayBuffer(c,ab){
    return await new Promise(function(resolve,reject){let settled=false;const ok=b=>{if(!settled){settled=true;resolve(b);}},bad=e=>{if(!settled){settled=true;reject(e);}};try{const p=c.decodeAudioData(ab.slice(0),ok,bad);if(p&&p.then)p.then(ok,bad);}catch(e){bad(e);}});
  }
  function preloadOne(src){
    if(!src)return Promise.resolve(null);if(BufferCache.has(src))return Promise.resolve(BufferCache.get(src));if(LoadCache.has(src))return LoadCache.get(src);
    const p=(async()=>{try{const c=getCtx();if(!c)return null;const res=await fetch(src,{cache:'force-cache'});if(!res.ok)return null;const buf=await decodeArrayBuffer(c,await res.arrayBuffer());BufferCache.set(src,buf);return buf;}catch(e){return null;}finally{LoadCache.delete(src);}})();
    LoadCache.set(src,p);return p;
  }
  function primeAudio(){
    const c=getCtx();if(c&&c.state==='suspended')c.resume().catch(()=>{});
    try{if('speechSynthesis' in window){const u=new SpeechSynthesisUtterance(' ');u.volume=0;speechSynthesis.speak(u);setTimeout(()=>{try{speechSynthesis.cancel();}catch(e){}},0);}}catch(e){}
    preloadOne('audio/thisstopis.wav');preloadOne('audio/KBS.wav');
  }
  document.addEventListener('pointerdown',primeAudio,{capture:true,passive:true});
  document.addEventListener('touchstart',primeAudio,{capture:true,passive:true});
  document.addEventListener('click',primeAudio,{capture:true,passive:true});
  window.unlockAudioForMobile=primeAudio;
  function playBuffer(buf){
    return new Promise(async resolve=>{const c=getCtx();if(!c||!buf){resolve(false);return;}try{if(c.state==='suspended')await c.resume();}catch(e){}try{const src=c.createBufferSource(),gain=c.createGain();src.buffer=buf;src.playbackRate.value=(typeof guideRate==='number'?guideRate:1);gain.gain.value=(typeof guideVolume==='number'?guideVolume:1);src.connect(gain);gain.connect(c.destination);let done=false;const timer=setTimeout(()=>{if(!done){done=true;try{src.stop();}catch(e){}resolve(false);}},120000);src.onended=()=>{if(done)return;done=true;clearTimeout(timer);resolve(true);};src.start(c.currentTime+0.005);}catch(e){resolve(false);}});
  }
  try{playClip=async function(src){const buf=await preloadOne(src);if(!buf){try{audioMissCache.add(src);}catch(e){}return false;}return await playBuffer(buf);};}catch(e){}
  try{playClipAnyExt=async function(paths){if(!Array.isArray(paths)||!paths.length)return false;const loads=paths.map(preloadOne);for(let i=0;i<loads.length;i++){const buf=await loads[i];if(buf)return await playBuffer(buf);}return false;};}catch(e){}
  function possibleAudioPathsForStop(stop){
    const out=[];if(!stop)return out;const names=[];['name','nameEn','enName','englishName','engName'].forEach(k=>{if(stop[k])names.push(stop[k]);});
    names.forEach(name=>{try{if(typeof audioPaths==='function'){const p=audioPaths(name);if(Array.isArray(p))out.push(...p);}}catch(e){}out.push('audio/'+name+'.wav','audio/'+name+' (1).wav');});return [...new Set(out)];
  }
  function preloadUpcoming(){try{if(!Array.isArray(currentGuideStops))return;const i=Math.max(0,Number(guideNextIndex)||0);for(let n=i;n<Math.min(currentGuideStops.length,i+3);n++)possibleAudioPathsForStop(currentGuideStops[n]).forEach(preloadOne);}catch(e){}}
  try{const oldPos=onGuidePosition;onGuidePosition=function(){const r=oldPos.apply(this,arguments);if(!prefetchTimer)prefetchTimer=setTimeout(()=>{prefetchTimer=null;preloadUpcoming();},50);return r;};}catch(e){}
  try{const oldSim=startGuideSim;startGuideSim=function(){primeAudio();preloadUpcoming();return oldSim.apply(this,arguments);};}catch(e){}
  setTimeout(()=>{preloadOne('audio/thisstopis.wav');preloadOne('audio/KBS.wav');preloadUpcoming();},300);

  /* ---------- route-aware live traffic lights ---------- */
  let routeSignalLayer=null,routeSignals=[],routeSignature='',nextSignal=null;
  let trackedUser=null,userWatchId=null,trafficTickTimer=null,trafficPaintTimer=null,trafficGeneration=0;

  const style=document.createElement('style');
  style.textContent=`
    .route-signal-icon{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#171b21;border:2px solid #79d2ff;box-shadow:0 2px 9px #0008;font-size:15px}
    .route-signal-icon.next{border-color:#ffd54a;box-shadow:0 0 0 3px #ffd54a55,0 2px 9px #0008}
    .tl-arrow{display:inline-flex;width:18px;height:18px;border-radius:50%;align-items:center;justify-content:center;background:#243028;color:#234;font-size:14px;font-weight:1000;margin:0 2px;box-shadow:inset 0 0 0 1px #3b4a40}.tl-arrow.on{background:#36e7a4;color:#062e20;box-shadow:0 0 10px #36e7a4}
    #trafficWidget{cursor:pointer}.route-signal-summary{font-size:11px;color:#aeb9c7;margin-top:5px}
  `;
  document.head.appendChild(style);

  function pathSig(path){if(!Array.isArray(path)||path.length<2)return '';const a=path[0],b=path[path.length-1];return path.length+':'+a[0].toFixed(5)+','+a[1].toFixed(5)+':'+b[0].toFixed(5)+','+b[1].toFixed(5);}
  function nearestPathIndex(path,lat,lng){let best=0,bd=Infinity;const stride=Math.max(1,Math.floor(path.length/1400));for(let i=0;i<path.length;i+=stride){const d=hav(lat,lng,path[i][0],path[i][1]);if(d<bd){bd=d;best=i;}}return {index:best,distance:bd};}
  function routeHeadingAt(path,i){const a=path[Math.max(0,i-4)],b=path[Math.min(path.length-1,i+4)];return bearingDeg(a[0],a[1],b[0],b[1]);}
  function routeTurnAt(path,i){const a=path[Math.max(0,i-7)],b=path[i],c=path[Math.min(path.length-1,i+7)];const h1=bearingDeg(a[0],a[1],b[0],b[1]),h2=bearingDeg(b[0],b[1],c[0],c[1]);return ((h2-h1+540)%360)-180;}

  async function buildRouteSignals(force=false){
    try{
      if(!trafficLightOn || !Array.isArray(currentRoutePath) || currentRoutePath.length<2){clearRouteSignals();return [];}
      const sig=pathSig(currentRoutePath);if(!force&&sig===routeSignature&&routeSignals.length)return routeSignals;
      routeSignature=sig;const path=currentRoutePath;
      const lats=path.map(p=>p[0]),lngs=path.map(p=>p[1]);const minLat=Math.min(...lats)-.001,maxLat=Math.max(...lats)+.001,minLng=Math.min(...lngs)-.001,maxLng=Math.max(...lngs)+.001;
      const mid=path[Math.floor(path.length/2)],source=mid[0]>=37.40&&mid[0]<=37.72&&mid[1]>=126.75&&mid[1]<=127.20?'seoul':'nationwide';
      const list=await loadTrafficIntersections(source),found=[];
      for(const ix of list){
        if(ix.lat<minLat||ix.lat>maxLat||ix.lng<minLng||ix.lng>maxLng)continue;
        const snap=nearestPathIndex(path,ix.lat,ix.lng);if(snap.distance>65)continue;
        found.push({...ix,pathIndex:snap.index,pathDistance:snap.distance,routeHeading:routeHeadingAt(path,snap.index),turnDelta:routeTurnAt(path,snap.index),source});
      }
      found.sort((a,b)=>a.pathIndex-b.pathIndex);routeSignals=found.slice(0,140);drawRouteSignals();updateRouteSignalSummary();return routeSignals;
    }catch(e){console.warn('route signal build failed',e);return routeSignals;}
  }
  function clearRouteSignals(){routeSignals=[];routeSignature='';nextSignal=null;if(routeSignalLayer){try{map.removeLayer(routeSignalLayer);}catch(e){}routeSignalLayer=null;}updateRouteSignalSummary();}
  function signalIcon(isNext){return L.divIcon({className:'',html:'<div class="route-signal-icon'+(isNext?' next':'')+'">🚦</div>',iconSize:[24,24],iconAnchor:[12,12]});}
  function drawRouteSignals(){
    if(typeof map==='undefined'||typeof L==='undefined')return;if(routeSignalLayer){try{map.removeLayer(routeSignalLayer);}catch(e){}}
    routeSignalLayer=L.layerGroup().addTo(map);
    routeSignals.forEach(ix=>{const m=L.marker([ix.lat,ix.lng],{icon:signalIcon(nextSignal&&nextSignal.crsrdId===ix.crsrdId),zIndexOffset:600}).addTo(routeSignalLayer);ix._marker=m;m.bindPopup('<b>🚦 '+esc(ix.name)+'</b><br>노선상 교차로 · 실시간 신호 확인 가능');m.on('click',()=>showSignalNow(ix,true));});
  }
  function updateRouteSignalSummary(){
    const box=document.getElementById('routeBusSummary');if(!box)return;let el=document.getElementById('routeSignalSummary');if(!el){el=document.createElement('span');el.id='routeSignalSummary';el.className='rbs-plan';box.appendChild(el);}
    if(!routeSignals.length){el.textContent='🚦 노선 신호 확인 중';return;}
    el.textContent='🚦 노선상 '+routeSignals.length+'개'+(nextSignal?' · 다음 '+nextSignal.name:'');
  }
  function currentPos(){
    if(typeof guideLastLat!=='undefined'&&guideLastLat!=null)return {lat:guideLastLat,lng:guideLastLng,heading:guideHeadingDeg,source:'guide'};
    if(trackedUser)return {...trackedUser,source:'user'};
    return null;
  }
  function chooseNextRouteSignal(pos){
    if(!routeSignals.length)return null;if(!Array.isArray(currentRoutePath)||currentRoutePath.length<2)return routeSignals[0];
    if(!pos)return routeSignals[0];const snap=nearestPathIndex(currentRoutePath,pos.lat,pos.lng);
    let cand=routeSignals.find(ix=>ix.pathIndex>=snap.index+1);if(!cand)cand=routeSignals[routeSignals.length-1];return cand;
  }
  function movement(rec,dir,type,source,now){
    const stem=dir.key+type+'sg',statusKey=stem+(source==='seoul'?'StatNm':'SttsNm'),rawStatus=rec?.[statusKey];
    if(rawStatus==null||rawStatus==='')return {exists:false,color:null,seconds:null,expiresAt:null};
    const color=trafficStatusColor(rawStatus),raw=rec?.[stem+(source==='seoul'?'RmdrCs':'RmndCs')],duration=raw==null||raw===''?null:Number(raw)/(source==='seoul'?10:1000),valid=Number.isFinite(duration)&&duration>=0&&duration<3600,timestamp=trafficRecordTime(rec),expiresAt=valid?timestamp+duration*1000:null;
    return {exists:true,color,seconds:expiresAt==null?null:Math.max(0,Math.ceil((expiresAt-now)/1000)),expiresAt};
  }
  function pickPhaseV29(rec,headingDeg,source='seoul',turnDelta=0,now=Date.now()){
    if(!rec||headingDeg==null||!Number.isFinite(Number(headingDeg)))return null;const timestamp=trafficRecordTime(rec),age=now-timestamp;if(!Number.isFinite(timestamp)||age<-3000||age>TRAFFIC_MAX_AGE_MS)return null;
    const fromDeg=(Number(headingDeg)+180)%360,dir=TRAFFIC_DIRS.reduce((a,b)=>trafficAngleGap(a.deg,fromDeg)<=trafficAngleGap(b.deg,fromDeg)?a:b);
    let straight=movement(rec,dir,'St',source,now);const bus=movement(rec,dir,'Bs',source,now),left=movement(rec,dir,'Lt',source,now);if(!straight.exists&&bus.exists)straight=bus;
    if(!straight.exists&&!left.exists)return null;const turningLeft=turnDelta<-32&&turnDelta>-155;
    const governing=turningLeft&&left.exists?left:straight.exists?straight:left;
    return {color:governing.color,straightColor:straight.color,leftColor:left.color,leftExists:left.exists,turningLeft,seconds:governing.seconds,timestamp,expiresAt:governing.expiresAt,label:dir.label+' 진입 · '+(turningLeft&&left.exists?'좌회전':'직진')};
  }
  function renderPhaseV29(phase,message=''){
    const el=document.getElementById('trafficWidget');if(!el)return;if(!phase){el.hidden=!message;el.textContent=message;return;}
    const now=Date.now();if(now-phase.timestamp>TRAFFIC_MAX_AGE_MS||(phase.expiresAt!=null&&phase.expiresAt<=now)){el.hidden=false;el.textContent=phase.name+' · 최신 신호 확인 중';return;}
    const dot=(c,on)=>'<span class="tl-dot tl-'+c+(on?' on':'')+'"></span>',redOn=phase.straightColor==='red'||(phase.turningLeft&&phase.leftColor==='red'),yellowOn=phase.straightColor==='yellow'||phase.leftColor==='yellow',greenOn=phase.straightColor==='green',arrow=phase.leftExists?'<span class="tl-arrow'+(phase.leftColor==='green'?' on':'')+'">←</span>':'';
    const dist=phase.distance!=null?' · '+fmtDist(phase.distance)+' 앞':'';el.hidden=false;el.innerHTML='<div class="tl-row"><span class="tl-lights">'+dot('red',redOn)+dot('yellow',yellowOn)+arrow+dot('green',greenOn)+'</span>'+(phase.seconds==null?'':'<span class="tl-sec">'+phase.seconds+'초</span>')+'<span class="tl-meta">'+esc(phase.name)+' · '+esc(phase.label)+dist+' · 참고 정보</span></div>';
    el.onclick=()=>{if(phase.lat!=null){map.setView([phase.lat,phase.lng],Math.max(map.getZoom(),17));const ix=routeSignals.find(x=>x.crsrdId===phase.crsrdId);try{ix?._marker?.openPopup();}catch(e){}}};
  }
  async function showSignalNow(ix,center=false){
    if(!ix)return;try{const rec=await fetchTrafficLiveRecord(ix),phase=pickPhaseV29(rec,ix.routeHeading??0,ix.source||'seoul',ix.turnDelta||0);if(center)map.setView([ix.lat,ix.lng],Math.max(map.getZoom(),17));renderPhaseV29(phase?{...phase,name:ix.name,lat:ix.lat,lng:ix.lng,crsrdId:ix.crsrdId}:null,ix.name+' · 최신 신호 정보가 없습니다');}catch(e){renderPhaseV29(null,e.message||'신호 정보를 불러오지 못했습니다');}
  }
  function markNextSignal(ix){nextSignal=ix;routeSignals.forEach(s=>{if(s._marker)s._marker.setIcon(signalIcon(ix&&s.crsrdId===ix.crsrdId));});updateRouteSignalSummary();}
  async function trafficTick(){
    try{
      if(!trafficLightOn)return;await buildRouteSignals();const pos=currentPos();let ix=chooseNextRouteSignal(pos);
      if(!ix){const lat=pos?.lat??map.getCenter().lat,lng=pos?.lng??map.getCenter().lng,source=lat>=37.40&&lat<=37.72&&lng>=126.75&&lng<=127.20?'seoul':'nationwide',list=await loadTrafficIntersections(source),heading=pos?.heading??null;ix=trafficIntersectionAhead(list,lat,lng,heading);if(ix)ix={...ix,source,routeHeading:heading??bearingDeg(lat,lng,ix.lat,ix.lng),turnDelta:0};}
      if(!ix){markNextSignal(null);renderPhaseV29(null,'다가오는 신호 정보를 찾는 중입니다');return;}
      markNextSignal(ix);const rec=await fetchTrafficLiveRecord(ix),heading=ix.routeHeading??pos?.heading??bearingDeg(pos?.lat??ix.lat,pos?.lng??ix.lng,ix.lat,ix.lng),phase=pickPhaseV29(rec,heading,ix.source||'seoul',ix.turnDelta||0),distance=pos?hav(pos.lat,pos.lng,ix.lat,ix.lng):null;
      renderPhaseV29(phase?{...phase,name:ix.name,lat:ix.lat,lng:ix.lng,crsrdId:ix.crsrdId,distance}:null,ix.name+' · 현재 진행 방향의 최신 신호 정보가 없습니다');
    }catch(e){renderPhaseV29(null,e.message||'신호 정보를 불러오지 못했습니다');}
  }
  function startTrafficV29(){
    trafficGeneration++;if(trafficTickTimer)clearTimeout(trafficTickTimer);if(trafficPaintTimer)clearInterval(trafficPaintTimer);
    const gen=trafficGeneration;const loop=async()=>{await trafficTick();if(gen===trafficGeneration&&trafficLightOn)trafficTickTimer=setTimeout(loop,TRAFFIC_POLL_MS);};
    trafficPaintTimer=setInterval(()=>{if(nextSignal){}},250);loop();
  }
  try{const oldStop=stopTrafficLightPolling;oldStop();stopTrafficLightPolling=function(){trafficGeneration++;if(trafficTickTimer)clearTimeout(trafficTickTimer);if(trafficPaintTimer)clearInterval(trafficPaintTimer);trafficTickTimer=trafficPaintTimer=null;nextSignal=null;renderPhaseV29(null);};startTrafficLightPolling=startTrafficV29;}catch(e){}

  try{
    if(typeof locBtn!=='undefined')locBtn.onclick=()=>{
      if(!navigator.geolocation)return;if(userWatchId!=null){navigator.geolocation.clearWatch(userWatchId);userWatchId=null;}
      let first=true,prev=null;
      userWatchId=navigator.geolocation.watchPosition(p=>{const lat=p.coords.latitude,lng=p.coords.longitude;let heading=Number.isFinite(p.coords.heading)?p.coords.heading:null;if(heading==null&&prev&&hav(prev.lat,prev.lng,lat,lng)>=2)heading=bearingDeg(prev.lat,prev.lng,lat,lng);trackedUser={lat,lng,heading};prev={lat,lng};if(userMarker)userMarker.setLatLng([lat,lng]);else userMarker=L.marker([lat,lng]).addTo(map).bindPopup('내 위치');if(first){first=false;map.setView([lat,lng],17);try{userMarker.openPopup();}catch(e){}}trafficTick();},{enableHighAccuracy:true,maximumAge:0,timeout:15000});
    };
  }catch(e){}

  setInterval(()=>{try{buildRouteSignals();}catch(e){}},2500);
  setTimeout(()=>{try{buildRouteSignals(true);if(trafficLightOn)startTrafficV29();}catch(e){}},700);
})();
