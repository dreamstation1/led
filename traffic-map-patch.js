(function(){
  if(window.__trafficMapPatchV36)return;
  window.__trafficMapPatchV36=true;

  let layer=null,refreshTimer=null,generation=0;
  const liveCache=new Map();

  const style=document.createElement('style');
  style.textContent=`
    .live-signal-pill{
      display:flex;align-items:center;gap:3px;
      padding:3px 5px;border-radius:8px;
      background:#090b0e;border:1px solid #30363d;
      box-shadow:0 1px 4px #0008;white-space:nowrap;
      transform:translate(-50%,-50%);
    }
    .sig-lamp{
      width:9px;height:9px;border-radius:50%;
      background:#30343a;
      box-shadow:inset 0 0 0 1px #4a5058;
    }
    .sig-lamp.red.on{background:#ff2020;box-shadow:0 0 5px #ff2020}
    .sig-lamp.yellow.on{background:#ffb515;box-shadow:0 0 5px #ffb515}
    .sig-lamp.green.on{background:#38ed63;box-shadow:0 0 5px #38ed63}
    .sig-left{
      width:11px;height:11px;display:flex;align-items:center;justify-content:center;
      color:#565d66;font-size:10px;font-weight:900;line-height:1;
    }
    .sig-left.red{color:#ff4545}.sig-left.yellow{color:#ffc32b}
    .sig-left.green{color:#41f276;text-shadow:0 0 5px #38ed63}
    .route-signal-icon{display:none!important}
    #browseTrafficPanel{display:none!important}
    @media(max-width:768px){
      .live-signal-pill{gap:2px;padding:2px 4px;border-radius:7px}
      .sig-lamp{width:8px;height:8px}
      .sig-left{width:10px;height:10px;font-size:9px}
    }
  `;
  document.head.appendChild(style);

  function sourceFor(lat,lng){return lat>=37.40&&lat<=37.72&&lng>=126.75&&lng<=127.20?'seoul':'nationwide';}
  function directionFor(ix,center){
    const heading=bearingDeg(center.lat,center.lng,ix.lat,ix.lng),fromDeg=(heading+180)%360;
    return TRAFFIC_DIRS.reduce((a,b)=>trafficAngleGap(a.deg,fromDeg)<=trafficAngleGap(b.deg,fromDeg)?a:b);
  }
  function movement(rec,dir,type,source){
    const stem=dir.key+type+'sg',statusKey=stem+(source==='seoul'?'StatNm':'SttsNm'),raw=rec?.[statusKey];
    if(raw==null||raw==='')return {exists:false,color:null};
    return {exists:true,color:trafficStatusColor(raw)};
  }
  function stateFor(rec,ix,center){
    if(!rec)return null;
    const dir=directionFor(ix,center);
    let straight=movement(rec,dir,'St',ix.source);
    const bus=movement(rec,dir,'Bs',ix.source);
    if(!straight.exists&&bus.exists)straight=bus;
    return {straight,left:movement(rec,dir,'Lt',ix.source)};
  }
  function markerHtml(state,loading=false){
    const c=state?.straight?.color||null;
    const lamp=n=>'<span class="sig-lamp '+n+(c===n?' on':'')+'"></span>';
    const left=state?.left?.exists?'<span class="sig-left '+(state.left.color||'')+'">←</span>':'';
    return '<div class="live-signal-pill'+(loading?' loading':'')+'">'+lamp('red')+lamp('yellow')+lamp('green')+left+'</div>';
  }
  function liveIcon(state,loading=false){
    return L.divIcon({className:'',html:markerHtml(state,loading),iconSize:[1,1],iconAnchor:[0,0]});
  }
  async function loadLive(items,center,gen){
    const queue=[...items];
    const worker=async()=>{
      while(queue.length){
        const item=queue.shift(); if(!item||gen!==generation)return;
        const {ix,m}=item,key=(ix.source||'')+':'+ix.crsrdId;
        let cached=liveCache.get(key);
        if(!cached||Date.now()-cached.at>4500){
          try{cached={at:Date.now(),rec:await fetchTrafficLiveRecord(ix)};}
          catch(e){cached={at:Date.now(),rec:null};}
          liveCache.set(key,cached);
        }
        if(gen!==generation)return;
        try{m.setIcon(liveIcon(stateFor(cached.rec,ix,center),false));}catch(e){}
      }
    };
    await Promise.all([worker(),worker(),worker(),worker()]);
  }
  async function refresh(){
    const gen=++generation;clearTimeout(refreshTimer);
    try{
      if(typeof trafficLightOn!=='undefined'&&!trafficLightOn){if(layer){map.removeLayer(layer);layer=null;}return;}
      if(typeof map==='undefined'||typeof L==='undefined'||map.getZoom()<14){if(layer){map.removeLayer(layer);layer=null;}return;}
      const center=map.getCenter(),source=sourceFor(center.lat,center.lng),all=await loadTrafficIntersections(source);
      if(gen!==generation)return;
      const b=map.getBounds().pad(0.08);
      let visible=all.filter(ix=>b.contains([ix.lat,ix.lng]));
      visible.sort((a,b)=>hav(center.lat,center.lng,a.lat,a.lng)-hav(center.lat,center.lng,b.lat,b.lng));
      visible=visible.slice(0,matchMedia('(max-width:768px)').matches?24:40).map(ix=>({...ix,source:ix.source||source}));
      if(layer){try{map.removeLayer(layer);}catch(e){}}
      layer=L.layerGroup().addTo(map);
      const jobs=[];
      for(const ix of visible){
        const m=L.marker([ix.lat,ix.lng],{icon:liveIcon(null,true),zIndexOffset:1000,keyboard:false,interactive:false}).addTo(layer);
        jobs.push({ix,m});
      }
      await loadLive(jobs,center,gen);
    }catch(e){}
  }
  function schedule(){clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,150);}
  try{map.on('moveend zoomend',schedule);}catch(e){}
  setInterval(()=>{try{refresh();}catch(e){}},5000);
  setTimeout(refresh,500);
})();