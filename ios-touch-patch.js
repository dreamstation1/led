(function(){
  if(window.__iosTouchPatchV33)return;
  window.__iosTouchPatchV33=true;

  const style=document.createElement('style');
  style.textContent=`
    #browseTrafficPanel{pointer-events:none!important;top:auto!important;bottom:18px!important;}
    .live-signal-marker,.route-signal-icon,.leaflet-marker-icon,.leaflet-control,button{touch-action:manipulation;-webkit-tap-highlight-color:transparent;}
    .live-signal-marker{pointer-events:auto!important;}
    .leaflet-control-container{position:relative;z-index:2000;}
  `;
  document.head.appendChild(style);

  function fixLocationButton(){
    let btn=null;
    try{if(typeof locBtn!=='undefined'&&locBtn)btn=locBtn;}catch(e){}
    if(!btn){
      btn=[...document.querySelectorAll('button,[role="button"],a')].find(el=>{
        const t=((el.textContent||'')+' '+(el.title||'')+' '+(el.getAttribute('aria-label')||'')).trim();
        return /내\s*위치|현재\s*위치|위치\s*찾기|locate|location/i.test(t);
      })||null;
    }
    if(!btn||btn.dataset.iosTouchFixed==='1')return;
    btn.dataset.iosTouchFixed='1';
    btn.style.position=btn.style.position||'relative';
    btn.style.zIndex='3000';
    btn.style.pointerEvents='auto';
    btn.style.touchAction='manipulation';

    let lastTouch=0;
    const run=e=>{
      const now=Date.now();
      if(now-lastTouch<450)return;
      lastTouch=now;
      if(e){try{e.preventDefault();e.stopPropagation();}catch(_){} }
      try{
        if(typeof btn.onclick==='function')btn.onclick.call(btn,e||new Event('click'));
        else btn.click();
      }catch(err){console.warn('location button touch failed',err);}
    };
    btn.addEventListener('touchend',run,{passive:false});
    btn.addEventListener('pointerup',e=>{if(e.pointerType==='touch')run(e);},{passive:false});
  }

  function fixMapMarkers(){
    document.querySelectorAll('.leaflet-marker-icon').forEach(el=>{
      el.style.pointerEvents='auto';
      el.style.touchAction='manipulation';
    });
  }

  setInterval(()=>{fixLocationButton();fixMapMarkers();},1000);
  setTimeout(()=>{fixLocationButton();fixMapMarkers();},100);
})();
