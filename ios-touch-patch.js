(function(){
  if(window.__appleTouchPatchV51)return;
  window.__appleTouchPatchV51=true;

  const isAppleTouch=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  if(!isAppleTouch)return;

  const isIPad=/iPad/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  document.documentElement.classList.add('apple-touch-device');
  document.documentElement.classList.toggle('ipad-device',isIPad);
  document.documentElement.classList.toggle('iphone-device',!isIPad);

  let vp=document.querySelector('meta[name="viewport"]');
  if(!vp){vp=document.createElement('meta');vp.name='viewport';document.head.appendChild(vp);}
  vp.content='width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover';

  const style=document.createElement('style');
  style.textContent=`
    html.apple-touch-device,html.apple-touch-device body{height:100%;min-height:100%;overscroll-behavior:none;-webkit-text-size-adjust:100%;}
    html.apple-touch-device body{min-height:100dvh;touch-action:manipulation;-webkit-tap-highlight-color:transparent;}
    html.apple-touch-device #map,html.apple-touch-device .leaflet-container{touch-action:none;}
    html.apple-touch-device button,html.apple-touch-device a,html.apple-touch-device input,html.apple-touch-device select,html.apple-touch-device textarea,html.apple-touch-device [role="button"]{touch-action:manipulation;-webkit-tap-highlight-color:transparent;}
    html.apple-touch-device input,html.apple-touch-device select,html.apple-touch-device textarea{font-size:16px!important;}
    html.apple-touch-device #routeHead,html.apple-touch-device #routeStops,html.apple-touch-device #settingsPanel,html.apple-touch-device #plannerPanel,html.apple-touch-device #favoritesPanel,html.apple-touch-device #searchResults,html.apple-touch-device #routeSearchResults{touch-action:pan-y!important;-webkit-overflow-scrolling:touch;}
    html.apple-touch-device input[type="range"]{touch-action:none!important;}
    html.apple-touch-device .leaflet-control-container{pointer-events:none;}
    html.apple-touch-device .leaflet-control-container .leaflet-control,html.apple-touch-device .leaflet-control-container button,html.apple-touch-device .leaflet-control-container a{pointer-events:auto!important;}
    html.apple-touch-device .live-signal-marker,html.apple-touch-device .live-signal-pill,html.apple-touch-device .route-signal-icon,html.apple-touch-device .leaflet-marker-icon{pointer-events:auto!important;touch-action:manipulation!important;}
    html.apple-touch-device #browseTrafficPanel{display:none!important;pointer-events:none!important;}
    #iosLocTapFix{position:fixed;z-index:2147483647;background:transparent;border:0;padding:0;margin:0;opacity:.001;display:none;touch-action:manipulation!important;-webkit-tap-highlight-color:transparent;pointer-events:auto!important;}
    html.ipad-device button,html.ipad-device [role="button"],html.ipad-device .leaflet-control a{min-height:42px;}
    html.ipad-device .leaflet-control-zoom a{width:44px!important;height:44px!important;line-height:44px!important;font-size:24px!important;}
    html.ipad-device .leaflet-bar a{min-width:42px;}
    html.ipad-device .leaflet-popup-content{font-size:15px;line-height:1.45;max-width:min(420px,70vw);}
    html.ipad-device .leaflet-popup-close-button{width:40px!important;height:40px!important;font-size:25px!important;line-height:36px!important;}
    html.ipad-device select,html.ipad-device input[type="text"],html.ipad-device input[type="search"],html.ipad-device input[type="number"]{min-height:42px;}
    html.ipad-device .live-signal-pill{transform:translate(-50%,-50%) scale(1.12)!important;transform-origin:center!important;}
    @media (min-width:700px) and (max-width:1180px){html.ipad-device body{padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right);box-sizing:border-box;}html.ipad-device #map,html.ipad-device .leaflet-container{min-height:420px;}}
  `;
  document.head.appendChild(style);

  document.addEventListener('pointerup',e=>{
    if(e.pointerType!=='pen')return;
    const t=e.target&&e.target.closest?e.target.closest('button,[role="button"],a'):null;
    if(!t||t.disabled)return;
    t.__lastPenPointerUp=Date.now();
    setTimeout(()=>{if(Date.now()-(t.__lastNativeClick||0)>350&&Date.now()-(t.__lastPenPointerUp||0)<500){try{t.click();}catch(_){}}},180);
  },true);
  document.addEventListener('click',e=>{try{if(e.target)e.target.__lastNativeClick=Date.now();}catch(_){}},true);

  const overlay=document.createElement('button');
  overlay.id='iosLocTapFix';overlay.type='button';overlay.setAttribute('aria-label','내 위치');
  document.body.appendChild(overlay);
  let targetBtn=null,lastFire=0,localWatchId=null,firstFix=true,prev=null;

  function findLocBtn(){
    try{if(typeof locBtn!=='undefined'&&locBtn)return locBtn;}catch(e){}
    return [...document.querySelectorAll('button,[role="button"],a')].find(el=>{
      if(el===overlay)return false;
      const t=((el.textContent||'')+' '+(el.title||'')+' '+(el.getAttribute('aria-label')||'')+' '+(el.id||'')+' '+(el.className||'')).trim();
      return /내\s*위치|현재\s*위치|위치\s*찾기|locate|location|locbtn/i.test(t);
    })||null;
  }

  function syncOverlay(){
    targetBtn=findLocBtn();
    if(!targetBtn){overlay.style.display='none';return;}
    const r=targetBtn.getBoundingClientRect();
    if(r.width<4||r.height<4||r.bottom<0||r.right<0||r.top>innerHeight||r.left>innerWidth){overlay.style.display='none';return;}
    overlay.style.display='block';overlay.style.left=r.left+'px';overlay.style.top=r.top+'px';overlay.style.width=r.width+'px';overlay.style.height=r.height+'px';
  }

  function setStatus(msg){
    try{if(typeof status!=='undefined'&&status)status.textContent=msg;}catch(e){}
  }

  function updatePosition(p){
    const lat=p.coords.latitude,lng=p.coords.longitude;
    let heading=Number.isFinite(p.coords.heading)?p.coords.heading:null;
    if(heading==null&&prev){try{heading=bearingDeg(prev.lat,prev.lng,lat,lng);}catch(e){}}
    prev={lat,lng};
    try{if(typeof trackedUser!=='undefined')trackedUser={lat,lng,heading};}catch(e){}
    try{
      if(typeof userMarker!=='undefined'&&userMarker)userMarker.setLatLng([lat,lng]);
      else if(typeof userMarker!=='undefined')userMarker=L.marker([lat,lng]).addTo(map).bindPopup('내 위치');
    }catch(e){}
    try{
      if(firstFix){firstFix=false;map.setView([lat,lng],17);if(typeof userMarker!=='undefined'&&userMarker)userMarker.openPopup();}
    }catch(e){}
    try{if(typeof trafficTick==='function')trafficTick();}catch(e){}
    setStatus('현재 위치 추적 중');
  }

  function startLocate(){
    if(!navigator.geolocation){setStatus('이 브라우저는 위치 기능을 지원하지 않습니다.');return;}
    setStatus('현재 위치 확인 중…');
    firstFix=true;prev=null;
    try{if(localWatchId!=null)navigator.geolocation.clearWatch(localWatchId);}catch(e){}
    try{if(typeof userWatchId!=='undefined'&&userWatchId!=null)navigator.geolocation.clearWatch(userWatchId);}catch(e){}
    const onErr=err=>setStatus(err&&err.code===1?'위치 권한이 꺼져 있습니다. Safari 위치 권한을 허용해 주세요.':'위치를 가져오지 못했습니다 · '+((err&&err.message)||'잠시 후 다시 시도해 주세요.'));
    try{
      localWatchId=navigator.geolocation.watchPosition(updatePosition,onErr,{enableHighAccuracy:true,maximumAge:0,timeout:15000});
      try{if(typeof userWatchId!=='undefined')userWatchId=localWatchId;}catch(e){}
    }catch(e){onErr(e);}
  }

  function fire(e){
    const now=Date.now();if(now-lastFire<650)return;lastFire=now;
    if(e){e.preventDefault();e.stopPropagation();}
    startLocate();
  }

  overlay.addEventListener('pointerup',fire,{passive:false});
  overlay.addEventListener('touchend',fire,{passive:false});
  overlay.addEventListener('click',fire,{passive:false});
  window.addEventListener('resize',syncOverlay,{passive:true});
  window.addEventListener('orientationchange',()=>setTimeout(syncOverlay,250),{passive:true});
  window.addEventListener('scroll',syncOverlay,{passive:true});
  try{map.on('move zoom moveend zoomend',syncOverlay);}catch(e){}
  setInterval(syncOverlay,300);setTimeout(syncOverlay,50);
})();
