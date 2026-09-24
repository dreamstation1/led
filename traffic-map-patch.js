(function(){
  if(window.__trafficMapPatchV31)return;
  window.__trafficMapPatchV31=true;

  let layer=null;
  let refreshTimer=null;
  let generation=0;
  let selected=null;

  const style=document.createElement('style');
  style.textContent=`
    .browse-signal-icon{width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#15191f;border:1.5px solid #8ed8ff;box-shadow:0 1px 5px #0009;font-size:13px}
    .browse-signal-icon.near{border-color:#ffd84a;box-shadow:0 0 0 3px #ffd84a44,0 1px 6px #0009}
    #browseTrafficPanel{position:absolute;z-index:950;right:10px;top:72px;max-width:min(330px,calc(100vw - 20px));padding:8px 10px;border-radius:10px;background:#111820e8;color:#eef6ff;font-size:12px;line-height:1.4;box-shadow:0 3px 12px #0007;backdrop-filter:blur(6px);display:none}
    #browseTrafficPanel b{font-size:13px}#browseTrafficPanel .sub{opacity:.75;font-size:11px;margin-top:2px}
  `;
  document.head.appendChild(style);

  const panel=document.createElement('div');
  panel.id='browseTrafficPanel';
  const mapEl=document.getElementById('map')||document.body;
  if(getComputedStyle(mapEl).position==='static')mapEl.style.position='relative';
  mapEl.appendChild(panel);

  function icon(near=false){
    return L.divIcon({className:'',html:'<div class="browse-signal-icon'+(near?' near':'')+'">🚦</div>',iconSize:[20,20],iconAnchor:[10,10]});
  }
  function sourceFor(lat,lng){return lat>=37.40&&lat<=37.72&&lng>=126.75&&lng<=127.20?'seoul':'nationwide';}
  function showPanel(html){panel.innerHTML=html;panel.style.display='block';}
  function hidePanel(){if(!selected)panel.style.display='none';}

  function nearestToCenter(list,center){
    let best=null,bd=Infinity;
    for(const ix of list){const d=hav(center.lat,center.lng,ix.lat,ix.lng);if(d<bd){bd=d;best=ix;}}
    return best?{ix:best,d:bd}:null;
  }

  async function showIntersection(ix,centerMap=false){
    selected=ix;
    if(centerMap){try{map.setView([ix.lat,ix.lng],Math.max(map.getZoom(),17));}catch(e){}}
    showPanel('<b>🚦 '+esc(ix.name||'교차로')+'</b><div class="sub">실시간 신호 불러오는 중…</div>');
    try{
      const rec=await fetchTrafficLiveRecord(ix);
      if(!rec){showPanel('<b>🚦 '+esc(ix.name||'교차로')+'</b><div class="sub">최신 신호 정보가 없습니다.</div>');return;}
      const keys=Object.keys(rec);
      const active=[];
      for(const dir of TRAFFIC_DIRS){
        for(const type of [{k:'St',n:'직진'},{k:'Lt',n:'좌회전'},{k:'Bs',n:'버스'}]){
          const stem=dir.key+type.k+'sg';
          const statusKey=stem+(ix.source==='seoul'?'StatNm':'SttsNm');
          const raw=rec[statusKey];if(raw==null||raw==='')continue;
          const color=trafficStatusColor(raw);if(!color)continue;
          active.push(dir.label+' '+type.n+' '+(color==='green'?'🟢':color==='yellow'?'🟡':'🔴'));
        }
      }
      showPanel('<b>🚦 '+esc(ix.name||'교차로')+'</b><div>'+esc(active.slice(0,8).join(' · ')||'신호 상태 확인 불가')+'</div><div class="sub">노선 미선택 상태에서는 교차로의 여러 방향 신호를 표시합니다. 실제 진행 방향을 선택하면 해당 방향 신호를 우선 표시합니다.</div>');
    }catch(e){showPanel('<b>🚦 '+esc(ix.name||'교차로')+'</b><div class="sub">'+esc(e.message||'신호 정보를 불러오지 못했습니다')+'</div>');}
  }

  async function refresh(){
    const gen=++generation;
    clearTimeout(refreshTimer);
    try{
      if(typeof trafficLightOn!=='undefined'&&!trafficLightOn){if(layer){map.removeLayer(layer);layer=null;}hidePanel();return;}
      if(typeof map==='undefined'||typeof L==='undefined')return;
      if(map.getZoom()<14){if(layer){map.removeLayer(layer);layer=null;}if(!selected)showPanel('<b>🚦 신호등</b><div class="sub">지도를 조금 더 확대하면 주변 신호등이 표시됩니다.</div>');return;}

      const center=map.getCenter();
      const source=sourceFor(center.lat,center.lng);
      const all=await loadTrafficIntersections(source);
      if(gen!==generation)return;
      const b=map.getBounds().pad(0.18);
      let visible=all.filter(ix=>b.contains([ix.lat,ix.lng]));
      visible.sort((a,b)=>hav(center.lat,center.lng,a.lat,a.lng)-hav(center.lat,center.lng,b.lat,b.lng));
      visible=visible.slice(0,120).map(ix=>({...ix,source:ix.source||source}));

      if(layer){try{map.removeLayer(layer);}catch(e){}}
      layer=L.layerGroup().addTo(map);
      const nearest=nearestToCenter(visible,center);
      for(const ix of visible){
        const near=nearest&&nearest.ix.crsrdId===ix.crsrdId;
        const m=L.marker([ix.lat,ix.lng],{icon:icon(near),zIndexOffset:450}).addTo(layer);
        m.bindPopup('<b>🚦 '+esc(ix.name||'교차로')+'</b><br>눌러서 실시간 신호 확인');
        m.on('click',()=>showIntersection(ix,false));
      }

      if(!selected){
        if(nearest)showPanel('<b>🚦 화면 주변 신호등 '+visible.length+'개</b><div class="sub">가장 가까운 곳: '+esc(nearest.ix.name||'교차로')+' · '+fmtDist(nearest.d)+' · 지도에서 🚦를 누르면 실시간 신호 확인</div>');
        else showPanel('<b>🚦 신호등</b><div class="sub">현재 화면 안에 제공되는 신호등 위치가 없습니다.</div>');
      }
    }catch(e){if(!selected)showPanel('<b>🚦 신호등</b><div class="sub">'+esc(e.message||'주변 신호 정보를 불러오지 못했습니다')+'</div>');}
  }

  function schedule(){clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,180);}
  try{map.on('moveend zoomend',schedule);}catch(e){}

  // Keep map browsing signals fresh even when no route has been searched/selected.
  setInterval(()=>{try{refresh();}catch(e){}},15000);
  setTimeout(refresh,900);

  // If the user taps the map after selecting a signal, return to browse summary on next refresh.
  try{map.on('click',()=>{selected=null;schedule();});}catch(e){}
})();
