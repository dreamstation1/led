(function(){
  if(window.__mobilePatchV61)return;
  window.__mobilePatchV61=true;

  /* ---------- adaptive guide + simulation ---------- */
  let lastSimPanAt=0;
  function adaptiveFraction(segmentM){
    if(segmentM<=200)return 0.5;
    if(segmentM>=1000)return 2/3;
    return 0.5+((segmentM-200)/800)*(1/6);
  }
  function adaptiveRemainingRadius(segmentM){return Math.max(20,segmentM*(1-adaptiveFraction(segmentM)));}
  window.guideAutoAnnouncementRadius=adaptiveRemainingRadius;

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
  let routeScrollPausedUntil=0,routeScrollResumeTimer=null;
  function scrollGuideRow(force=false){
    if(!guideActive||(!force&&Date.now()<routeScrollPausedUntil))return;
    const list=document.getElementById('routeStops'),row=document.querySelector(`#routeStops .route-stop[data-guide-index="${guideNextIndex}"]`);if(!list||!row)return;
    list.scrollTo({top:Math.max(0,row.offsetTop-(list.clientHeight-row.offsetHeight)/2),behavior:'smooth'});
  }
  function pauseRouteAutoScroll(){
    if(!guideActive)return;routeScrollPausedUntil=Date.now()+5000;clearTimeout(routeScrollResumeTimer);
    routeScrollResumeTimer=setTimeout(()=>scrollGuideRow(true),5050);
  }
  try{
    const list=document.getElementById('routeStops');
    ['wheel','touchstart','pointerdown'].forEach(type=>list?.addEventListener(type,pauseRouteAutoScroll,{passive:true}));
    const baseMarkGuideProgress=markGuideProgress;
    markGuideProgress=function(){const result=baseMarkGuideProgress();requestAnimationFrame(()=>scrollGuideRow(false));return result;};
  }catch(e){}
  let stopBackgroundSimulation=null,simulationKeepAlive=null,simulationKeepAliveUrl=null,simPrepareGeneration=0;
  function startSimulationKeepAlive(){
    if(simulationKeepAlive)return;
    try{
      // A looping silent media element marks the minimized tab as actively
      // playing media, preventing desktop Chromium from freezing the worker
      // that advances stops and starts announcements.
      const rate=8000,seconds=2,dataBytes=rate*seconds*2,buf=new ArrayBuffer(44+dataBytes),v=new DataView(buf);
      const text=(at,s)=>{for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i));};
      text(0,'RIFF');v.setUint32(4,36+dataBytes,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,dataBytes,true);
      simulationKeepAliveUrl=URL.createObjectURL(new Blob([buf],{type:'audio/wav'}));
      const audio=new Audio(simulationKeepAliveUrl);audio.loop=true;audio.volume=.001;audio.playsInline=true;simulationKeepAlive=audio;
      const p=audio.play();if(p?.catch)p.catch(()=>{});
    }catch(e){simulationKeepAlive=null;}
  }
  function stopSimulationKeepAlive(){
    if(simulationKeepAlive){try{simulationKeepAlive.pause();simulationKeepAlive.removeAttribute('src');}catch(e){}simulationKeepAlive=null;}
    if(simulationKeepAliveUrl){try{URL.revokeObjectURL(simulationKeepAliveUrl);}catch(e){}simulationKeepAliveUrl=null;}
  }
  function backgroundTicker(callback){
    let worker=null,timer=null,url=null,stopped=false;
    const fire=()=>{if(!stopped)callback(Date.now());};
    try{
      const blob=new Blob(['setInterval(()=>postMessage(Date.now()),100)'],{type:'text/javascript'});
      url=URL.createObjectURL(blob);worker=new Worker(url);worker.onmessage=e=>{if(!stopped)callback(Number(e.data)||Date.now());};
    }catch(e){timer=setInterval(()=>fire(),100);}
    return()=>{stopped=true;if(worker)worker.terminate();if(timer)clearInterval(timer);if(url)URL.revokeObjectURL(url);};
  }
  try{
    startGuideSim=async function(){
      if(!currentGuideStops || currentGuideStops.length<2)return;
      if(!currentRoutePath || currentRoutePath.length<2){try{status.textContent='노선 경로를 불러온 뒤 다시 시뮬레이션해 주세요.';}catch(e){}return;}
      if(guideWatchId!=null){try{navigator.geolocation.clearWatch(guideWatchId);}catch(e){}guideWatchId=null;}
      if(stopBackgroundSimulation){stopBackgroundSimulation();stopBackgroundSimulation=null;}
      const prepareGeneration=++simPrepareGeneration;
      stopSimulationKeepAlive();startSimulationKeepAlive();
      if(guideSimRaf!=null){cancelAnimationFrame(guideSimRaf);guideSimRaf=null;}
      guideActive=true;
      const startIdx=Math.min(Math.max(guideStartIdx||0,0),currentGuideStops.length-2);
      guideNextIndex=startIdx+1;guideApproachAnnounced=false;guideMinDistToTarget=Infinity;
      guideLastLat=guideLastLng=guideHeadingDeg=null;
      markGuideProgress();renderGuideBar();updateGuideStatus();
      status.textContent='첫 안내방송 AI 음성을 준비하고 있습니다… 준비가 끝나면 시뮬레이션이 시작됩니다.';
      await announceArrival(currentGuideStops[startIdx],currentGuideStops[startIdx+1]||null,{waitForAi:true});
      if(prepareGeneration!==simPrepareGeneration||!guideActive)return;
      try{if(ledConnected)ledUploadRoute().then(()=>ledSetIndex(startIdx));}catch(e){}
      const path=currentRoutePath,totalLen=pathLengthM(path),stopArcs=stopArcLengthsAlongPath(path,currentGuideStops);
      let traveled=Math.max(0,Math.min(totalLen,stopArcs[startIdx]||0)),lastTs=Date.now(),dwellUntil=0;
      const initialStop=currentGuideStops[startIdx];
      simPositionWithoutFixedRadius(initialStop.lat,initialStop.lng);
      status.textContent='첫 안내방송 완료 · 시뮬레이션을 시작합니다 (속도 '+fmtSpeed(simSpeedMultiplier)+')';
      function tick(now){
        if(!guideActive){if(stopBackgroundSimulation){stopBackgroundSimulation();stopBackgroundSimulation=null;}stopSimulationKeepAlive();guideSimRaf=null;return;}
        let dt=(now-lastTs)/1000;lastTs=now;if(!Number.isFinite(dt)||dt<0)dt=0;dt=Math.min(dt,1);
        if(now<dwellUntil)return;
        const speed=(typeof SIM_BASE_SPEED_MPS==='number'?SIM_BASE_SPEED_MPS:14)*Math.max(0.1,simSpeedMultiplier||1);
        const beforeIdx=guideNextIndex;traveled=Math.min(totalLen,traveled+speed*dt);
        maybeAdaptiveSimAnnouncement(traveled,stopArcs);
        const pos=pointAtDistanceM(path,traveled);simPositionWithoutFixedRadius(pos[0],pos[1]);
        if(guideActive && guideNextIndex>beforeIdx){
          const arrived=currentGuideStops[Math.min(beforeIdx,currentGuideStops.length-1)];
          // The road geometry can run beside or slightly beyond the official
          // stop pole. While dwelling, pin the simulation marker to the exact
          // stop coordinates used by the visible stop marker.
          if(arrived){simPositionWithoutFixedRadius(arrived.lat,arrived.lng);traveled=Math.max(traveled,stopArcs[beforeIdx]||traveled);}
          if(guideNextIndex<currentGuideStops.length)dwellUntil=now+(GUIDE_DWELL_MS/Math.max(0.1,simSpeedMultiplier||1));
        }
        if(traveled>=totalLen-0.01){const lastStop=currentGuideStops[currentGuideStops.length-1],last=lastStop?[lastStop.lat,lastStop.lng]:path[path.length-1];simPositionWithoutFixedRadius(last[0],last[1]);if(stopBackgroundSimulation){stopBackgroundSimulation();stopBackgroundSimulation=null;}stopSimulationKeepAlive();guideSimRaf=null;return;}
      }
      // A Worker timer keeps route time, stop arrivals and announcements alive
      // when the desktop browser window is minimized. The map can repaint when
      // visible again without controlling simulation progress.
      guideSimRaf=-1;stopBackgroundSimulation=backgroundTicker(tick);
    };
  }catch(e){console.error('simulation patch failed',e);}
  try{
    const baseStopGuide=stopGuide;
    stopGuide=function(){simPrepareGeneration++;if(stopBackgroundSimulation){stopBackgroundSimulation();stopBackgroundSimulation=null;}stopSimulationKeepAlive();clearTimeout(routeScrollResumeTimer);return baseStopGuide();};
  }catch(e){}

  /* ---------- audio handled only by gapless-patch.js ---------- */

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
      const mid=path[Math.floor(path.length/2)],source=window.trafficSourceForLocation?.(mid[0],mid[1])||'nationwide';
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
  function drawRouteSignals(){
    // The map-wide signal layer owns all visible traffic-light markers.
    // Route guidance keeps this data only for choosing the next signal; a
    // second marker layer caused duplicates after pans and popup closes.
    if(routeSignalLayer){try{map.removeLayer(routeSignalLayer);}catch(e){}routeSignalLayer=null;}
    routeSignals.forEach(ix=>{ix._marker=null;});
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
  function markNextSignal(ix){nextSignal=ix;updateRouteSignalSummary();}
  async function trafficTick(){
    try{
      if(!trafficLightOn)return;await buildRouteSignals();const pos=currentPos();let ix=chooseNextRouteSignal(pos);
      if(!ix){const lat=pos?.lat??map.getCenter().lat,lng=pos?.lng??map.getCenter().lng,source=window.trafficSourceForLocation?.(lat,lng)||'nationwide',list=await loadTrafficIntersections(source),heading=pos?.heading??null;ix=trafficIntersectionAhead(list,lat,lng,heading);if(ix)ix={...ix,source:ix.source||source,routeHeading:heading??bearingDeg(lat,lng,ix.lat,ix.lng),turnDelta:0};}
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
      if(!navigator.geolocation){status.textContent='이 브라우저는 위치 기능을 지원하지 않습니다.';return;}
      if(userWatchId!=null){
        if(trackedUser){map.setView([trackedUser.lat,trackedUser.lng],17);try{userMarker?.openPopup();}catch(e){}status.textContent='현재 위치를 계속 추적 중입니다.';}
        trafficTick();try{window.refreshTrafficMapNow?.();}catch(e){}
        return;
      }
      status.textContent='현재 위치 권한을 요청하고 있습니다…';
      locBtn.textContent='위치 찾는 중…';
      let first=true,prev=null;
      const onPosition=p=>{
        const lat=p.coords.latitude,lng=p.coords.longitude;let heading=Number.isFinite(p.coords.heading)?p.coords.heading:null;
        if(heading==null&&prev&&hav(prev.lat,prev.lng,lat,lng)>=2)heading=bearingDeg(prev.lat,prev.lng,lat,lng);
        trackedUser={lat,lng,heading};prev={lat,lng};
        if(userMarker)userMarker.setLatLng([lat,lng]);else userMarker=L.marker([lat,lng],{zIndexOffset:1800}).addTo(map).bindPopup('내 위치');
        locBtn.textContent='내 위치 추적 중';status.textContent='현재 위치를 찾았습니다'+(trafficLightOn?' · 주변 실시간 신호등을 확인합니다':'');
        if(first){first=false;map.setView([lat,lng],17);try{userMarker.openPopup();}catch(e){}}
        trafficTick();try{window.refreshTrafficMapNow?.();}catch(e){}
      };
      const onError=e=>{
        if(userWatchId!=null){try{navigator.geolocation.clearWatch(userWatchId);}catch(_){}userWatchId=null;}
        locBtn.textContent='내 위치';
        status.textContent=e?.code===1?'위치 권한이 꺼져 있습니다. 브라우저의 이 사이트 위치 권한을 허용한 뒤 다시 눌러주세요.':e?.code===2?'현재 위치를 확인할 수 없습니다. 휴대폰 위치 기능과 Wi‑Fi/GPS를 확인해주세요.':'위치 확인 시간이 초과됐습니다. 실외나 창가에서 다시 눌러주세요.';
      };
      userWatchId=navigator.geolocation.watchPosition(onPosition,onError,{enableHighAccuracy:true,maximumAge:0,timeout:15000});
    };
  }catch(e){}

  setInterval(()=>{try{buildRouteSignals();}catch(e){}},2500);
  setTimeout(()=>{try{buildRouteSignals(true);if(trafficLightOn)startTrafficV29();}catch(e){}},700);
})();
