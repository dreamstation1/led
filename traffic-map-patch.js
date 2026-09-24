(function(){
  if(window.__trafficMapPatchV44)return;
  window.__trafficMapPatchV44=true;

  let layer=null,refreshTimer=null,generation=0;
  const liveCache=new Map();

  const style=document.createElement('style');
  style.textContent=`
    .live-signal-pill{display:flex!important;flex-direction:row!important;align-items:center!important;gap:3px!important;width:auto!important;height:auto!important;min-width:34px!important;min-height:15px!important;padding:3px 5px!important;border-radius:8px!important;background:#090b0e!important;border:1px solid #30363d!important;box-shadow:0 1px 4px #0008!important;white-space:nowrap!important;transform:translate(-50%,-50%)!important}
    .sig-lamp{display:block!important;box-sizing:border-box!important;flex:0 0 9px!important;width:9px!important;height:9px!important;min-width:9px!important;min-height:9px!important;border-radius:50%!important;background:#30343a!important;box-shadow:inset 0 0 0 1px #4a5058!important}
    .sig-lamp.red.on{background:#ff2020!important;box-shadow:0 0 5px #ff2020!important}.sig-lamp.yellow.on{background:#ffb515!important;box-shadow:0 0 5px #ffb515!important}.sig-lamp.green.on{background:#38ed63!important;box-shadow:0 0 5px #38ed63!important}
    .sig-left{flex:0 0 11px!important;width:11px!important;height:11px!important;display:flex!important;align-items:center!important;justify-content:center!important;color:#565d66!important;font-size:10px!important;font-weight:900!important;line-height:1!important}.sig-left.red{color:#ff4545!important}.sig-left.yellow{color:#ffc32b!important}.sig-left.green{color:#41f276!important;text-shadow:0 0 5px #38ed63!important}
    .route-signal-icon{display:none!important;width:0!important;height:0!important;overflow:hidden!important;pointer-events:none!important}.signal-location-only{width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#171b21;border:1px solid #66717d;box-shadow:0 1px 4px #0008;font-size:12px;transform:translate(-50%,-50%)}#browseTrafficPanel{display:none!important}
    @media(max-width:768px){.live-signal-pill{gap:2px!important;padding:2px 4px!important;min-width:31px!important;min-height:14px!important;border-radius:7px!important}.sig-lamp{flex-basis:8px!important;width:8px!important;height:8px!important;min-width:8px!important;min-height:8px!important}.sig-left{flex-basis:10px!important;width:10px!important;height:10px!important;font-size:9px!important}}
  `;
  document.head.appendChild(style);

  function sourceFor(lat,lng){return lat>=37.40&&lat<=37.72&&lng>=126.75&&lng<=127.20?'seoul':'nationwide';}
  function directionFor(ix,center){const heading=bearingDeg(center.lat,center.lng,ix.lat,ix.lng),fromDeg=(heading+180)%360;return TRAFFIC_DIRS.reduce((a,b)=>trafficAngleGap(a.deg,fromDeg)<=trafficAngleGap(b.deg,fromDeg)?a:b);}
  function movement(rec,dir,type,source){const stem=dir.key+type+'sg',statusKey=stem+(source==='seoul'?'StatNm':'SttsNm'),raw=rec?.[statusKey];if(raw==null||raw==='')return {exists:false,color:null};return {exists:true,color:trafficStatusColor(raw)};}
  function stateFor(rec,ix,center){if(!rec)return null;const dir=directionFor(ix,center);let straight=movement(rec,dir,'St',ix.source);const bus=movement(rec,dir,'Bs',ix.source);if(!straight.exists&&bus.exists)straight=bus;const left=movement(rec,dir,'Lt',ix.source);if(!straight.exists&&!left.exists)return null;if(straight.exists&&!straight.color&&(!left.exists||!left.color))return null;return {straight,left};}
  function markerHtml(state){const c=state.straight?.color||null;const lamp=n=>'<span class="sig-lamp '+n+(c===n?' on':'')+'"></span>';const left=state.left?.exists?'<span class="sig-left '+(state.left.color||'')+'">←</span>':'';return '<div class="live-signal-pill">'+lamp('red')+lamp('yellow')+lamp('green')+left+'</div>';}
  function liveIcon(state){return L.divIcon({className:'live-signal-div-icon',html:state?markerHtml(state):'<div class="signal-location-only">🚦</div>',iconSize:[1,1],iconAnchor:[0,0]});}

  async function getState(ix,center){
    const key=(ix.source||'')+':'+ix.crsrdId;let cached=liveCache.get(key);
    if(!cached||Date.now()-cached.at>14000){try{cached={at:Date.now(),rec:await fetchTrafficLiveRecord(ix)};}catch(e){cached={at:Date.now(),rec:null};}liveCache.set(key,cached);}
    return stateFor(cached.rec,ix,center);
  }

  async function refresh(){
    const gen=++generation;clearTimeout(refreshTimer);
    try{
      if(typeof trafficLightOn!=='undefined'&&!trafficLightOn){if(layer){map.removeLayer(layer);layer=null;}return;}
      if(typeof map==='undefined'||typeof L==='undefined'||map.getZoom()<14){if(layer){map.removeLayer(layer);layer=null;}return;}
      const center=map.getCenter(),source=sourceFor(center.lat,center.lng),all=await loadTrafficIntersections(source);if(gen!==generation)return;
      const b=map.getBounds().pad(0.06);let visible=all.filter(ix=>b.contains([ix.lat,ix.lng]));
      visible.sort((a,b)=>hav(center.lat,center.lng,a.lat,a.lng)-hav(center.lat,center.lng,b.lat,b.lng));
      visible=visible.slice(0,matchMedia('(max-width:768px)').matches?10:18).map(ix=>({...ix,source:ix.source||source}));
      const results=[];
      for(const ix of visible){if(gen!==generation)return;const st=await getState(ix,center);results.push({ix,st});}
      if(gen!==generation)return;
      const newLayer=L.layerGroup().addTo(map);
      for(const x of results)L.marker([x.ix.lat,x.ix.lng],{icon:liveIcon(x.st),zIndexOffset:1000,keyboard:false,interactive:false}).addTo(newLayer);
      if(layer){try{map.removeLayer(layer);}catch(e){}}
      layer=newLayer;
    }catch(e){}
  }

  function schedule(){clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,250);}
  try{map.on('moveend zoomend',schedule);}catch(e){}
  setInterval(()=>{try{refresh();}catch(e){}},15000);
  setTimeout(refresh,700);
})();