(function(){
  if(window.__trafficMapPatchV56)return;
  window.__trafficMapPatchV56=true;

  let layer=null,refreshTimer=null,generation=0,selected=null;
  const liveCache=new Map();

  const style=document.createElement('style');
  style.textContent=`
    .live-signal-pill{display:flex;align-items:center;gap:4px;padding:4px 7px;border-radius:999px;background:#11161c;border:1.5px solid #728191;box-shadow:0 2px 8px #0009;white-space:nowrap;transform:translate(-50%,-50%)}
    .live-signal-pill.near{border-color:#ffd84a;box-shadow:0 0 0 3px #ffd84a40,0 2px 8px #0009}
    .live-signal-pill.loading{opacity:.58}
    .sig-lamp{width:11px;height:11px;border-radius:50%;background:#2b3036;box-shadow:inset 0 0 0 1px #424b55}
    .sig-lamp.red.on{background:#ff3b3b;box-shadow:0 0 8px #ff3b3b}
    .sig-lamp.yellow.on{background:#ffd43b;box-shadow:0 0 8px #ffd43b}
    .sig-lamp.green.on{background:#31e58c;box-shadow:0 0 8px #31e58c}
    .sig-left{width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#2b3036;color:#66717d;font-size:14px;font-weight:900;box-shadow:inset 0 0 0 1px #424b55}
    .sig-left.red{background:#672127;color:#ff7b7b}.sig-left.yellow{background:#705d18;color:#ffe066}.sig-left.green{background:#153e2c;color:#4cf0a1;box-shadow:0 0 8px #31e58c}
    .route-signal-icon{display:none!important;pointer-events:none!important;width:0!important;height:0!important;border:0!important;overflow:hidden!important}
    #browseTrafficPanel{position:absolute;z-index:950;right:10px;top:72px;max-width:min(340px,calc(100vw - 20px));padding:8px 10px;border-radius:10px;background:#111820e8;color:#eef6ff;font-size:12px;line-height:1.4;box-shadow:0 3px 12px #0007;backdrop-filter:blur(6px);display:none;pointer-events:none}
    @media(max-width:768px){#browseTrafficPanel{display:none!important}.live-signal-pill{padding:4px 6px;gap:3px}.sig-lamp{width:10px;height:10px}.sig-left{width:16px;height:16px;font-size:12px}}
  `;
  document.head.appendChild(style);

  const panel=document.createElement('div');panel.id='browseTrafficPanel';
  const mapEl=document.getElementById('map')||document.body;
  if(getComputedStyle(mapEl).position==='static')mapEl.style.position='relative';
  mapEl.appendChild(panel);

  const isPhone=()=>matchMedia('(max-width:768px)').matches;
  function sourceFor(lat,lng){try{return window.trafficSourceForLocation?.(lat,lng)||'nationwide';}catch(e){return 'nationwide';}}
  function showPanel(html){if(isPhone())return;panel.innerHTML=html;panel.style.display='block';}
  function hidePanel(){panel.style.display='none';}

  function nearestToCenter(list,center){let best=null,bd=Infinity;for(const ix of list){const d=hav(center.lat,center.lng,ix.lat,ix.lng);if(d<bd){bd=d;best=ix;}}return best?{ix:best,d:bd}:null;}
  function directionFor(ix,center){const heading=bearingDeg(center.lat,center.lng,ix.lat,ix.lng),fromDeg=(heading+180)%360;return TRAFFIC_DIRS.reduce((a,b)=>trafficAngleGap(a.deg,fromDeg)<=trafficAngleGap(b.deg,fromDeg)?a:b);}
  function movement(rec,dir,type,source){const stem=dir.key+type+'sg',statusKey=stem+(source==='seoul'?'StatNm':'SttsNm'),raw=rec?.[statusKey];if(raw==null||raw==='')return {exists:false,color:null};return {exists:true,color:trafficStatusColor(raw)};}
  function stateFor(rec,ix,center){if(!rec)return null;const dir=directionFor(ix,center);let straight=movement(rec,dir,'St',ix.source);const bus=movement(rec,dir,'Bs',ix.source);if(!straight.exists&&bus.exists)straight=bus;const left=movement(rec,dir,'Lt',ix.source);return {dir,straight,left};}

  function markerHtml(state,near=false,loading=false){
    const c=state?.straight?.color||null;
    const lamp=n=>'<span class="sig-lamp '+n+(c===n?' on':'')+'"></span>';
    const left=state?.left?.exists?'<span class="sig-left '+(state.left.color||'')+'">←</span>':'';
    return '<div class="live-signal-pill'+(near?' near':'')+(loading?' loading':'')+'">'+lamp('red')+lamp('yellow')+lamp('green')+left+'</div>';
  }
  function liveIcon(state,near=false,loading=false){return L.divIcon({className:'',html:markerHtml(state,near,loading),iconSize:[1,1],iconAnchor:[0,0]});}

  async function showIntersection(ix){
    selected=ix;
    if(isPhone())return;
    try{
      const rec=await fetchTrafficLiveRecord(ix),st=stateFor(rec,ix,map.getCenter());
      const bits=[];if(st?.straight?.exists)bits.push('직진 '+st.straight.color);if(st?.left?.exists)bits.push('좌회전 '+st.left.color);
      showPanel('<b>'+esc(ix.name||'교차로')+'</b><div>'+esc(bits.join(' · ')||'신호 상태 확인 불가')+'</div>');
    }catch(e){showPanel('<b>'+esc(ix.name||'교차로')+'</b>');}
  }

  async function loadLive(items,center,gen){
    const queue=[...items];
    const worker=async()=>{while(queue.length){const item=queue.shift();if(!item||gen!==generation)return;const {ix,m,near}=item,key=(ix.source||'')+':'+ix.crsrdId;let cached=liveCache.get(key);if(!cached||Date.now()-cached.at>4500){try{cached={at:Date.now(),rec:await fetchTrafficLiveRecord(ix)};}catch(e){cached={at:Date.now(),rec:null};}liveCache.set(key,cached);}if(gen!==generation)return;const st=stateFor(cached.rec,ix,center);try{m.setIcon(liveIcon(st,near,false));}catch(e){}}};
    await Promise.all([worker(),worker(),worker(),worker()]);
  }

  async function refresh(){
    const gen=++generation;clearTimeout(refreshTimer);
    try{
      // Browse-mode signals are independent from route selection. If the map is visible and zoomed in,
      // show live intersections even before a bus route has been chosen.
      if(typeof map==='undefined'||typeof L==='undefined')return;
      if(typeof trafficLightOn!=='undefined'&&!trafficLightOn){if(layer){map.removeLayer(layer);layer=null;}hidePanel();return;}
      if(map.getZoom()<14){if(layer){map.removeLayer(layer);layer=null;}hidePanel();return;}
      const center=map.getCenter(),source=sourceFor(center.lat,center.lng),all=await loadTrafficIntersections(source);if(gen!==generation)return;
      const b=map.getBounds().pad(0.10);let visible=all.filter(ix=>b.contains([ix.lat,ix.lng]));
      visible.sort((a,b)=>hav(center.lat,center.lng,a.lat,a.lng)-hav(center.lat,center.lng,b.lat,b.lng));
      visible=visible.slice(0,isPhone()?20:32).map(ix=>({...ix,source:ix.source||source}));
      if(layer){try{map.removeLayer(layer);}catch(e){}}
      layer=L.layerGroup().addTo(map);const nearest=nearestToCenter(visible,center),jobs=[];
      for(const ix of visible){const near=nearest&&nearest.ix.crsrdId===ix.crsrdId;const m=L.marker([ix.lat,ix.lng],{icon:liveIcon(null,near,near),zIndexOffset:1000,keyboard:false}).addTo(layer);m.on('click',()=>showIntersection(ix));if(near)jobs.push({ix,m,near});}
      await loadLive(jobs,center,gen);
    }catch(e){console.warn('browse traffic refresh failed',e);}
  }

  function schedule(){clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,160);}
  window.refreshTrafficMapNow=()=>{clearTimeout(refreshTimer);return refresh();};
  window.setTrafficMapEnabled=on=>{if(!on){generation++;clearTimeout(refreshTimer);if(layer){try{map.removeLayer(layer);}catch(e){}layer=null;}hidePanel();return;}refresh();};
  try{map.on('moveend zoomend',schedule);}catch(e){}
  setTimeout(refresh,600);
})();
