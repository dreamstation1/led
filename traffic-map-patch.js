(function(){
  if(window.__trafficMapPatchV32)return;
  window.__trafficMapPatchV32=true;

  let layer=null;
  let refreshTimer=null;
  let generation=0;
  let selected=null;
  const liveCache=new Map();

  const style=document.createElement('style');
  style.textContent=`
    .live-signal-marker{display:flex;align-items:center;gap:2px;padding:3px 4px;border-radius:7px;background:#101419;border:1.5px solid #6fd2ff;box-shadow:0 2px 8px #000a;white-space:nowrap;transform:translate(-50%,-50%)}
    .live-signal-marker.near{border-color:#ffd84a;box-shadow:0 0 0 3px #ffd84a44,0 2px 8px #000a}
    .live-signal-marker.loading{opacity:.58}
    .ls-lamp{width:8px;height:8px;border-radius:50%;background:#24292f;box-shadow:inset 0 0 0 1px #3a414a}
    .ls-lamp.red.on{background:#ff3b3b;box-shadow:0 0 7px #ff3b3b}
    .ls-lamp.yellow.on{background:#ffd43b;box-shadow:0 0 7px #ffd43b}
    .ls-lamp.green.on{background:#31e58c;box-shadow:0 0 7px #31e58c}
    .ls-arrow{width:15px;height:15px;border-radius:5px;display:flex;align-items:center;justify-content:center;background:#24292f;color:#616a74;font-weight:900;font-size:12px;line-height:1;box-shadow:inset 0 0 0 1px #3a414a}
    .ls-arrow.red{background:#6d1f25;color:#ff6b6b}.ls-arrow.yellow{background:#6b5717;color:#ffe066}.ls-arrow.green{background:#163f2d;color:#48f0a0;box-shadow:0 0 7px #31e58c}
    .ls-dir{font-size:8px;color:#b8c3cf;margin-left:1px;max-width:28px;overflow:hidden;text-overflow:ellipsis}
    #browseTrafficPanel{position:absolute;z-index:950;right:10px;top:72px;max-width:min(340px,calc(100vw - 20px));padding:8px 10px;border-radius:10px;background:#111820e8;color:#eef6ff;font-size:12px;line-height:1.4;box-shadow:0 3px 12px #0007;backdrop-filter:blur(6px);display:none}
    #browseTrafficPanel b{font-size:13px}#browseTrafficPanel .sub{opacity:.75;font-size:11px;margin-top:2px}
  `;
  document.head.appendChild(style);

  const panel=document.createElement('div');
  panel.id='browseTrafficPanel';
  const mapEl=document.getElementById('map')||document.body;
  if(getComputedStyle(mapEl).position==='static')mapEl.style.position='relative';
  mapEl.appendChild(panel);

  function sourceFor(lat,lng){return lat>=37.40&&lat<=37.72&&lng>=126.75&&lng<=127.20?'seoul':'nationwide';}
  function showPanel(html){panel.innerHTML=html;panel.style.display='block';}
  function hidePanel(){if(!selected)panel.style.display='none';}
  function colorEmoji(c){return c==='green'?'🟢':c==='yellow'?'🟡':c==='red'?'🔴':'⚫';}

  function nearestToCenter(list,center){
    let best=null,bd=Infinity;
    for(const ix of list){const d=hav(center.lat,center.lng,ix.lat,ix.lng);if(d<bd){bd=d;best=ix;}}
    return best?{ix:best,d:bd}:null;
  }

  function directionFor(rec,ix,center){
    const heading=bearingDeg(center.lat,center.lng,ix.lat,ix.lng);
    const fromDeg=(heading+180)%360;
    return TRAFFIC_DIRS.reduce((a,b)=>trafficAngleGap(a.deg,fromDeg)<=trafficAngleGap(b.deg,fromDeg)?a:b);
  }

  function movement(rec,dir,type,source){
    const stem=dir.key+type+'sg';
    const statusKey=stem+(source==='seoul'?'StatNm':'SttsNm');
    const raw=rec?.[statusKey];
    if(raw==null||raw==='')return {exists:false,color:null};
    return {exists:true,color:trafficStatusColor(raw)};
  }

  function stateFor(rec,ix,center){
    if(!rec)return null;
    const dir=directionFor(rec,ix,center);
    let straight=movement(rec,dir,'St',ix.source);
    const bus=movement(rec,dir,'Bs',ix.source);
    if(!straight.exists&&bus.exists)straight=bus;
    const left=movement(rec,dir,'Lt',ix.source);
    const right=movement(rec,dir,'Rt',ix.source);
    return {dir,straight,left,right};
  }

  function markerHtml(state,near=false,loading=false){
    if(!state){
      return '<div class="live-signal-marker'+(near?' near':'')+(loading?' loading':'')+'"><span class="ls-lamp red"></span><span class="ls-lamp yellow"></span><span class="ls-lamp green"></span></div>';
    }
    const c=state.straight?.color;
    const lamp=(name)=>'<span class="ls-lamp '+name+(c===name?' on':'')+'"></span>';
    const arrow=(sym,m)=>m?.exists?'<span class="ls-arrow '+(m.color||'')+'">'+sym+'</span>':'';
    return '<div class="live-signal-marker'+(near?' near':'')+'">'+lamp('red')+lamp('yellow')+lamp('green')+arrow('←',state.left)+arrow('→',state.right)+'<span class="ls-dir">'+esc(state.dir.label)+'</span></div>';
  }

  function liveIcon(state,near=false,loading=false){
    return L.divIcon({className:'',html:markerHtml(state,near,loading),iconSize:[1,1],iconAnchor:[0,0]});
  }

  async function showIntersection(ix,centerMap=false){
    selected=ix;
    if(centerMap){try{map.setView([ix.lat,ix.lng],Math.max(map.getZoom(),17));}catch(e){}}
    showPanel('<b>'+esc(ix.name||'교차로')+'</b><div class="sub">실시간 신호 불러오는 중…</div>');
    try{
      const rec=await fetchTrafficLiveRecord(ix);
      if(!rec){showPanel('<b>'+esc(ix.name||'교차로')+'</b><div class="sub">최신 신호 정보가 없습니다.</div>');return;}
      const center=map.getCenter();
      const st=stateFor(rec,ix,center);
      const bits=[];
      if(st?.straight?.exists)bits.push('직진 '+colorEmoji(st.straight.color));
      if(st?.left?.exists)bits.push('좌회전 '+colorEmoji(st.left.color));
      if(st?.right?.exists)bits.push('우회전 '+colorEmoji(st.right.color));
      showPanel('<b>'+esc(ix.name||'교차로')+'</b><div>'+esc(st?.dir?.label||'')+' 진입 · '+esc(bits.join(' · ')||'신호 상태 확인 불가')+'</div><div class="sub">지도 위 작은 신호등도 같은 실시간 상태로 갱신됩니다.</div>');
    }catch(e){showPanel('<b>'+esc(ix.name||'교차로')+'</b><div class="sub">'+esc(e.message||'신호 정보를 불러오지 못했습니다')+'</div>');}
  }

  async function loadLiveForMarkers(items,center,gen){
    const queue=[...items];
    const workers=[];
    const worker=async()=>{
      while(queue.length){
        const item=queue.shift();
        if(!item||gen!==generation)return;
        const {ix,m,near}=item;
        const key=(ix.source||'')+':'+ix.crsrdId;
        let cached=liveCache.get(key);
        if(!cached||Date.now()-cached.at>9000){
          try{
            const rec=await fetchTrafficLiveRecord(ix);
            cached={at:Date.now(),rec};liveCache.set(key,cached);
          }catch(e){cached={at:Date.now(),rec:null};liveCache.set(key,cached);}
        }
        if(gen!==generation)return;
        const st=stateFor(cached.rec,ix,center);
        try{m.setIcon(liveIcon(st,near,false));}catch(e){}
        ix._liveState=st;
      }
    };
    for(let i=0;i<4;i++)workers.push(worker());
    await Promise.all(workers);
  }

  async function refresh(){
    const gen=++generation;
    clearTimeout(refreshTimer);
    try{
      if(typeof trafficLightOn!=='undefined'&&!trafficLightOn){if(layer){map.removeLayer(layer);layer=null;}hidePanel();return;}
      if(typeof map==='undefined'||typeof L==='undefined')return;
      if(map.getZoom()<14){if(layer){map.removeLayer(layer);layer=null;}if(!selected)showPanel('<b>실시간 신호</b><div class="sub">지도를 조금 더 확대하면 주변 신호 상태가 지도 위에 바로 표시됩니다.</div>');return;}

      const center=map.getCenter();
      const source=sourceFor(center.lat,center.lng);
      const all=await loadTrafficIntersections(source);
      if(gen!==generation)return;
      const b=map.getBounds().pad(0.12);
      let visible=all.filter(ix=>b.contains([ix.lat,ix.lng]));
      visible.sort((a,b)=>hav(center.lat,center.lng,a.lat,a.lng)-hav(center.lat,center.lng,b.lat,b.lng));
      // Live requests are intentionally limited to the nearest visible signals so mobile stays responsive.
      visible=visible.slice(0,32).map(ix=>({...ix,source:ix.source||source}));

      if(layer){try{map.removeLayer(layer);}catch(e){}}
      layer=L.layerGroup().addTo(map);
      const nearest=nearestToCenter(visible,center);
      const jobs=[];
      for(const ix of visible){
        const near=nearest&&nearest.ix.crsrdId===ix.crsrdId;
        const m=L.marker([ix.lat,ix.lng],{icon:liveIcon(null,near,true),zIndexOffset:850}).addTo(layer);
        m.on('click',()=>showIntersection(ix,false));
        jobs.push({ix,m,near});
      }

      if(!selected){
        if(nearest)showPanel('<b>실시간 신호 '+visible.length+'개 표시 중</b><div class="sub">지도 위 빨강·노랑·초록과 좌/우회전 화살표가 실제 제공 데이터에 맞춰 약 10초마다 갱신됩니다. 가장 가까운 곳: '+esc(nearest.ix.name||'교차로')+'</div>');
        else showPanel('<b>실시간 신호</b><div class="sub">현재 화면 안에 제공되는 신호 데이터가 없습니다.</div>');
      }

      await loadLiveForMarkers(jobs,center,gen);
    }catch(e){if(!selected)showPanel('<b>실시간 신호</b><div class="sub">'+esc(e.message||'주변 신호 정보를 불러오지 못했습니다')+'</div>');}
  }

  function schedule(){clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,180);}
  try{map.on('moveend zoomend',schedule);}catch(e){}
  setInterval(()=>{try{refresh();}catch(e){}},10000);
  setTimeout(refresh,700);
  try{map.on('click',()=>{selected=null;schedule();});}catch(e){}
})();
