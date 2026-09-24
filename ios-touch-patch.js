(function(){
  if(window.__iosTouchPatchV35)return;
  window.__iosTouchPatchV35=true;

  const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  if(!isIOS)return;

  const style=document.createElement('style');
  style.textContent=`
    #browseTrafficPanel{display:none!important;pointer-events:none!important;}
    .leaflet-control-container{pointer-events:none;}
    .leaflet-control-container .leaflet-control,.leaflet-control-container button,.leaflet-control-container a{pointer-events:auto!important;}
    .live-signal-marker,.route-signal-icon,.leaflet-marker-icon{pointer-events:auto!important;touch-action:manipulation!important;-webkit-tap-highlight-color:transparent;}
    #iosLocTapFix{position:fixed;z-index:2147483647;background:transparent;border:0;padding:0;margin:0;opacity:.001;display:none;touch-action:manipulation;-webkit-tap-highlight-color:transparent;}
  `;
  document.head.appendChild(style);

  let overlay=document.createElement('button');
  overlay.id='iosLocTapFix';
  overlay.type='button';
  overlay.setAttribute('aria-label','내 위치');
  document.body.appendChild(overlay);

  let targetBtn=null;
  let lastFire=0;

  function findLocBtn(){
    try{if(typeof locBtn!=='undefined'&&locBtn)return locBtn;}catch(e){}
    const els=[...document.querySelectorAll('button,[role="button"],a')];
    return els.find(el=>{
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
    overlay.style.display='block';
    overlay.style.left=r.left+'px';
    overlay.style.top=r.top+'px';
    overlay.style.width=r.width+'px';
    overlay.style.height=r.height+'px';
  }

  function ownLocate(){
    if(!navigator.geolocation)return;
    navigator.geolocation.getCurrentPosition(p=>{
      const lat=p.coords.latitude,lng=p.coords.longitude;
      try{
        if(typeof userMarker!=='undefined'&&userMarker)userMarker.setLatLng([lat,lng]);
        else if(typeof userMarker!=='undefined')userMarker=L.marker([lat,lng]).addTo(map).bindPopup('내 위치');
      }catch(e){}
      try{map.setView([lat,lng],17);}catch(e){}
    },err=>{
      try{if(typeof status!=='undefined'&&status)status.textContent='위치 권한을 확인해 주세요 · '+(err.message||'위치를 가져오지 못했습니다');}catch(e){}
    },{enableHighAccuracy:true,maximumAge:0,timeout:15000});
  }

  function fire(e){
    const now=Date.now();
    if(now-lastFire<700)return;
    lastFire=now;
    if(e){e.preventDefault();e.stopPropagation();}
    targetBtn=findLocBtn();
    try{
      if(targetBtn&&typeof targetBtn.onclick==='function'){
        targetBtn.onclick.call(targetBtn,new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
        return;
      }
    }catch(err){console.warn('original location handler failed',err);}
    ownLocate();
  }

  overlay.addEventListener('click',fire,{passive:false});
  overlay.addEventListener('touchend',fire,{passive:false});

  window.addEventListener('resize',syncOverlay,{passive:true});
  window.addEventListener('scroll',syncOverlay,{passive:true});
  try{map.on('move zoom moveend zoomend',syncOverlay);}catch(e){}
  setInterval(syncOverlay,300);
  setTimeout(syncOverlay,50);
})();
