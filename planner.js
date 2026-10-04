// Bus trip planner based on the stop order embedded in index.html.
const PLANNER_SORTS={optimal:'최적',time:'최소시간',distance:'최단거리',walk:'최소도보',detour:'우회 경로'};
const plannerRouteCache=new Map();
const plannerRoutesById=new Map(ROUTES.map(r=>[r.id,r]));
let plannerPaths=[],plannerSort='optimal',plannerLayer=null,plannerSelected=-1,plannerSearched=false;
let plannerFromIndex=null,plannerViaIndex=null,plannerToIndex=null;
let plannerDrawRevision=0,plannerMapStatus='',plannerSearching=false,plannerSearchRevision=0;
const plannerArrivalCache=new Map();

function plannerClimateRoute(route){
  return ['마을','지선','간선','심야'].includes(routeCategory(route.name));
}
function plannerRouteAllowed(route){
  return !document.getElementById('plannerClimateOnly')?.checked || plannerClimateRoute(route);
}

function plannerLegNodes(leg){return leg.data.route.nodes.slice(leg.start,leg.end+1).map(String);}
function plannerCorridor(legs){return legs.flatMap((leg,i)=>plannerLegNodes(leg).slice(i?1:0)).join('>');}
function plannerPathKey(path){return path.legs.map(leg=>plannerLegNodes(leg).join('>')).join('|');}

function plannerMakePath(legs,walk,fromIndex,toIndex){
  const joined=[];
  for(const leg of legs){
    const last=joined[joined.length-1];
    // A via stop on the same trip does not require getting off and boarding again.
    if(last && last.data.route.id===leg.data.route.id && last.end===leg.start)last.end=leg.end;
    else joined.push({...leg});
  }
  const busDistance=joined.reduce((sum,l)=>sum+l.data.prefix[l.end]-l.data.prefix[l.start],0)*1.25;
  const stopCount=joined.reduce((sum,l)=>sum+l.end-l.start,0),transfers=joined.length-1;
  const distance=busDistance+walk;
  const minutes=Math.max(1,Math.round(busDistance/1000/22*60+stopCount*.28+walk/1000/4.5*60+joined.length*5+transfers*4));
  return {legs:joined,walk,distance,minutes,transfers,stopCount,fromIndex,toIndex};
}

function plannerPrunePaths(paths){
  const choices=new Map(),corridors=new Map();
  for(const path of paths){
    const corridor=plannerCorridor(path.legs);
    // Moving a transfer one stop along the same overlap is the same itinerary.
    const key=path.legs.map(l=>l.data.route.id).join('|')+'#'+corridor;
    const previous=choices.get(key);
    if(!previous || path.walk<previous.walk || (path.walk===previous.walk && path.legs[0].end-path.legs[0].start>previous.legs[0].end-previous.legs[0].start))choices.set(key,path);
    if(!corridors.has(corridor))corridors.set(corridor,[]);
    corridors.get(corridor).push(path);
  }
  return [...choices.values()].filter(path=>!corridors.get(plannerCorridor(path.legs)).some(other=>
    other.transfers<path.transfers && other.walk<=path.walk && other.minutes<=path.minutes));
}

function plannerRouteData(route){
  if(plannerRouteCache.has(route.id))return plannerRouteCache.get(route.id);
  const positions=new Map(),prefix=[0];
  route.nodes.forEach((node,i)=>{
    if(!positions.has(node))positions.set(node,[]);
    positions.get(node).push(i);
    if(i){
      const a=STOPS[STOP_BY_NODE.get(String(route.nodes[i-1]))];
      const b=STOPS[STOP_BY_NODE.get(String(node))];
      prefix[i]=prefix[i-1]+(a&&b?hav(a.lat,a.lng,b.lat,b.lng):500);
    }
  });
  const data={route,positions,prefix};
  plannerRouteCache.set(route.id,data);
  return data;
}

function plannerNearby(index){
  const origin=STOPS[index],near=[{index,walk:0}];
  for(let i=0;i<STOPS.length;i++){
    if(i===index || !STOPS[i].routes?.length)continue;
    const s=STOPS[i];
    if(Math.abs(s.lat-origin.lat)>.003 || Math.abs(s.lng-origin.lng)>.004)continue;
    const d=hav(origin.lat,origin.lng,s.lat,s.lng);
    if(d<=280)near.push({index:i,walk:d});
  }
  near.sort((a,b)=>a.walk-b.walk);
  return near.slice(0,8);
}

function plannerFindPaths(fromIndex,toIndex,options={}){
  if(fromIndex===toIndex)return [];
  const starts=options.exactStart?[{index:fromIndex,walk:0}]:plannerNearby(fromIndex);
  const ends=options.exactEnd?[{index:toIndex,walk:0}]:plannerNearby(toIndex),candidates=[];
  const straight=hav(STOPS[fromIndex].lat,STOPS[fromIndex].lng,STOPS[toIndex].lat,STOPS[toIndex].lng);
  const maxBusDist=Math.max(3500,straight*3.5+2500);
  const seen=new Set();
  const add=(a,b,walk,transfer)=>{
    if(candidates.length>=8000)return;
    const legs=transfer?[a,b]:[a];
    const nodes=legs.flatMap((leg,i)=>plannerLegNodes(leg).slice(i?1:0));
    // A route may contain a loop, but riding past the requested destination or
    // returning to an already visited stop only creates an unnecessary detour.
    if(new Set(nodes).size!==nodes.length)return;
    if(nodes.slice(0,-1).includes(String(STOPS[toIndex].node)))return;
    const busDist=legs.reduce((sum,l)=>sum+l.data.prefix[l.end]-l.data.prefix[l.start],0);
    const stopCount=legs.reduce((sum,l)=>sum+l.end-l.start,0);
    if(busDist>maxBusDist || stopCount>170 || stopCount<1)return;
    const key=legs.map(l=>`${l.data.route.id}:${l.start}-${l.end}`).join('|');
    if(seen.has(key))return;
    seen.add(key);
    candidates.push(plannerMakePath(legs,walk,fromIndex,toIndex));
  };
  for(const start of starts){
    const s=STOPS[start.index];
    for(const sr of s.routes){
      const aRoute=plannerRoutesById.get(sr.id);
      if(!aRoute||!plannerRouteAllowed(aRoute))continue;
      const a=plannerRouteData(aRoute);
      const startsAt=a.positions.get(s.node)||[];
      for(const end of ends){
        const e=STOPS[end.index],walk=start.walk+end.walk;
        for(const p of startsAt){
          for(const q of a.positions.get(e.node)||[]){
            if(q>p)add({data:a,start:p,end:q},null,walk,false);
          }
        }
      }
    }
  }
  // One transfer at the same stop. Repeated stop IDs on loop routes retain
  // their actual order, so a result cannot travel backwards on either bus.
  for(const start of starts){
    const s=STOPS[start.index];
    for(const sr of s.routes){
      const routeA=plannerRoutesById.get(sr.id);
      if(!routeA||!plannerRouteAllowed(routeA))continue;
      const a=plannerRouteData(routeA);
      for(const p of a.positions.get(s.node)||[]){
        const limit=Math.min(a.route.nodes.length-1,p+100);
        for(let x=p+1;x<=limit;x++){
          const node=a.route.nodes[x],mid=STOPS[STOP_BY_NODE.get(String(node))];
          if(!mid || !mid.routes?.length)continue;
          for(const mr of mid.routes){
            if(mr.id===a.route.id)continue;
            const routeB=plannerRoutesById.get(mr.id);
            if(!routeB||!plannerRouteAllowed(routeB))continue;
            const b=plannerRouteData(routeB);
            for(const y of b.positions.get(node)||[]){
              for(const end of ends){
                for(const z of b.positions.get(STOPS[end.index].node)||[]){
                  if(z>y)add({data:a,start:p,end:x},{data:b,start:y,end:z},start.walk+end.walk,true);
                }
              }
            }
          }
        }
      }
    }
  }
  return plannerPrunePaths(candidates);
}

function plannerRank(paths,sort){
  const optimal=p=>p.minutes+p.walk/250+p.transfers*5;
  const first=p=>sort==='time'?p.minutes:sort==='distance'?p.distance:
    sort==='walk'?p.walk:sort==='detour'?-p.distance:optimal(p);
  return paths.slice().sort((a,b)=>first(a)-first(b)||optimal(a)-optimal(b)||a.transfers-b.transfers||a.distance-b.distance||plannerPathKey(a).localeCompare(plannerPathKey(b)));
}

// Several buses often serve exactly the same boarding/transfer/alighting
// corridor. Present that as one choice and list every bus usable on each leg.
function plannerGroupPaths(paths){
  const groups=new Map();
  for(const p of paths){
    // The complete ordered corridor must match, not only its endpoints.
    const key=plannerPathKey(p);
    let g=groups.get(key);
    if(!g){
      g={...p,legs:p.legs.map(l=>({...l,routeNames:[l.data.route.name],routeOptions:[l]}))};
      groups.set(key,g);
      continue;
    }
    p.legs.forEach((l,i)=>{
      if(g.legs[i] && !g.legs[i].routeOptions.some(option=>option.data.route.id===l.data.route.id)){
        g.legs[i].routeNames.push(l.data.route.name);
        g.legs[i].routeOptions.push(l);
      }
    });
  }
  for(const group of groups.values())for(const leg of group.legs)leg.routeNames.sort((a,b)=>a.localeCompare(b,'ko',{numeric:true}));
  return [...groups.values()];
}

function plannerFindViaPaths(from,via,to){
  if(via===from || via===to)return plannerFindPaths(from,to);
  // Both rides visit the actual selected via stop, so no hidden walk connects them.
  const first=plannerFindPaths(from,via,{exactEnd:true}),second=plannerFindPaths(via,to,{exactStart:true});
  const pick=paths=>{
    const best=plannerRank(paths,'optimal').slice(0,20);
    const long=plannerRank(paths,'detour').slice(0,12);
    // Preserve direct services on each side so a continuous ride through the
    // via stop is never lost merely because nearby alternatives rank first.
    return [...new Set([...best,...long,...paths.filter(p=>p.transfers===0)])];
  };
  const result=[];
  for(const a of pick(first))for(const b of pick(second)){
    result.push(plannerMakePath([...a.legs,...b.legs],a.walk+b.walk,from,to));
  }
  return plannerPrunePaths(result);
}

function plannerStopName(node){return STOPS[STOP_BY_NODE.get(String(node))]?.name||'정류소';}
function plannerStopLabel(node){
  const stop=STOPS[STOP_BY_NODE.get(String(node))];
  return stop?`${stop.name}${stop.ars && stop.ars!=='0'?' ('+stop.ars+')':''}`:'정류소';
}
function plannerArrivalTime(item,n=1){
  const seconds=Number(item?.['traTime'+n]);if(Number.isFinite(seconds)&&seconds>=0)return seconds;
  const message=String(item?.['arrmsg'+n]||'');
  const minute=message.match(/(\d+)분/),second=message.match(/(\d+)초/);
  if(minute||second)return Number(minute?.[1]||0)*60+Number(second?.[1]||0);
  return null;
}
async function plannerArrivalsAt(node){
  const stop=STOPS[STOP_BY_NODE.get(String(node))];if(!stop?.ars)return [];
  const key=String(stop.ars),old=plannerArrivalCache.get(key);
  if(old&&Date.now()-old.at<20000)return old.data;
  const data=await fetchStopArrivals(stop.ars);plannerArrivalCache.set(key,{at:Date.now(),data});return data;
}
function plannerRouteArrivalTimes(items,names){
  const wanted=new Set(names.map(String)),times=[];
  for(const item of items){if(!wanted.has(String(item.rtNm)))continue;for(let n=1;n<=5;n++){const value=plannerArrivalTime(item,n);if(value!=null)times.push(value);}}
  return times.sort((a,b)=>a-b);
}
async function plannerTransferChance(path){
  if(!path.transfers)return null;
  const first=path.legs[0],second=path.legs[1],origin=first.data.route.nodes[first.start],transfer=first.data.route.nodes[first.end];
  const [originItems,transferItems]=await Promise.all([plannerArrivalsAt(origin),plannerArrivalsAt(transfer)]);
  const firstTimes=plannerRouteArrivalTimes(originItems,first.routeNames||[first.data.route.name]);
  const secondTimes=plannerRouteArrivalTimes(transferItems,second.routeNames||[second.data.route.name]);
  if(!firstTimes.length||!secondTimes.length)return {text:'실시간 환승 정보 없음',level:'warn'};
  const rideSeconds=(first.end-first.start)*105+90,reach=firstTimes[0]+rideSeconds;
  const connection=secondTimes.find(t=>t>=reach-45);
  if(connection==null)return {text:'현재 조회된 다음 차량으로는 환승이 어려움',level:'bad'};
  const buffer=connection-reach,prob=Math.max(5,Math.min(98,Math.round(100/(1+Math.exp(-(buffer-90)/150)))));
  return {text:`실시간 환승 성공 추정 ${prob}% · 환승 여유 약 ${Math.max(0,Math.round(buffer/60))}분`,level:prob>=75?'':prob>=40?'warn':'bad'};
}
async function plannerEnhanceTransferCards(paths){
  await Promise.all(paths.slice(0,10).map(async(path,i)=>{
    if(!path.transfers)return;
    const box=document.querySelector(`.planner-result[data-plan-index="${i}"] .planner-live`);if(!box)return;
    try{const result=await plannerTransferChance(path);if(!result)return;box.textContent=result.text;box.className='planner-live '+result.level;}catch(e){box.textContent='실시간 환승 정보를 불러오지 못했습니다.';box.className='planner-live warn';}
  }));
}
function plannerUpdateNote(){
  if(typeof document==='undefined')return;
  const note=document.getElementById('plannerNote');
  note.setAttribute('role','status');
  if(plannerSearching){note.textContent='버스 경로를 찾고 있습니다…';return;}
  const count=plannerGroupPaths(plannerPaths).length;
  note.textContent=(plannerSearched?`${count}개 이동 경로 · 공통 구간 버스는 한 카드에 표시 · 시간·거리·도보는 추정치`:'버스 노선 순서로 직행·환승 경로를 찾습니다.')+(plannerMapStatus?' · '+plannerMapStatus:'');
}
function plannerRender(){
  const sortBox=document.getElementById('plannerSort');
  sortBox.innerHTML=Object.entries(PLANNER_SORTS).map(([key,label])=>`<button type="button" data-sort="${key}" class="${key===plannerSort?'on':''}">${label}</button>`).join('');
  sortBox.querySelectorAll('button').forEach(btn=>btn.onclick=()=>{plannerSort=btn.dataset.sort;plannerClearMap();plannerRender();});
  const box=document.getElementById('plannerResults');
  plannerUpdateNote();
  if(!plannerSearched){box.innerHTML='';return;}
  const ranked=plannerRank(plannerGroupPaths(plannerPaths),plannerSort).slice(0,30);
  if(!ranked.length){box.innerHTML='<div class="search-empty">찾은 경로가 없습니다. 가까운 다른 정류소를 선택해 보세요.</div>';return;}
  box.innerHTML='';
  ranked.forEach((p,i)=>{
    const el=document.createElement('button');
    el.type='button';el.className='planner-result'+(i===plannerSelected?' selected':'');
    el.dataset.planIndex=String(i);
    const names=p.legs.map(l=>(l.routeNames||[l.data.route.name]).join(' · ')).join(' → ');
    const steps=p.legs.map((l,j)=>`${j?'환승':'승차'} ${esc(plannerStopLabel(l.data.route.nodes[l.start]))} → ${esc(plannerStopLabel(l.data.route.nodes[l.end]))}<br>${esc((l.routeNames||[l.data.route.name]).join(' · '))} · 다음 정류소 ${esc(plannerStopName(l.data.route.nodes[l.start+1]))} 방향 · ${l.end-l.start}정류소`).join('<br>');
    const origin=STOPS[p.fromIndex],destination=STOPS[p.toIndex];
    const firstNode=String(p.legs[0].data.route.nodes[p.legs[0].start]);
    const last=p.legs[p.legs.length-1],lastNode=String(last.data.route.nodes[last.end]);
    const walkSteps=[origin && String(origin.node)!==firstNode?`출발지에서 ${plannerStopName(firstNode)}까지 도보`:null,
      destination && String(destination.node)!==lastNode?`하차 후 ${destination.name}까지 도보`:null].filter(Boolean).map(esc).join('<br>');
    const climate=p.legs.every(l=>(l.routeOptions||[l]).some(o=>plannerClimateRoute(o.data.route)));
    el.innerHTML=`<strong>${i+1}. ${esc(names)}</strong><small>약 ${p.minutes}분 · 약 ${fmtDist(p.distance)} · 도보 약 ${fmtDist(p.walk)} · ${p.transfers?'환승 '+p.transfers+'회':'환승 없음'} · ${p.stopCount}정류소</small><small>${climate?'🌱 기후동행카드 가능 · ':''}${steps}</small>${walkSteps?'<small>🚶 도로·횡단보도 보행 경로 확인: '+walkSteps+'</small>':''}${p.transfers?'<div class="planner-live warn">실시간 환승 확률 계산 중…</div>':''}`;
    el.setAttribute('aria-pressed',String(i===plannerSelected));
    el.onclick=()=>{plannerClearMap();plannerSelected=i;plannerDraw(p);plannerRender();};
    box.appendChild(el);
  });
  plannerEnhanceTransferCards(ranked);
}

function plannerClearMap(){
  plannerDrawRevision++;
  if(plannerLayer && typeof map!=='undefined')map.removeLayer(plannerLayer);
  plannerLayer=null;
  plannerSelected=-1;
  plannerMapStatus='';
  if(typeof document!=='undefined'){
    document.querySelectorAll?.('#plannerResults .selected').forEach(el=>{el.classList.remove('selected');el.setAttribute('aria-pressed','false');});
    plannerUpdateNote();
  }
}

async function plannerDraw(path){
  const revision=++plannerDrawRevision;
  if(typeof routeLayer!=='undefined' && routeLayer){map.removeLayer(routeLayer);routeLayer=null;}
  if(typeof routeHitLayer!=='undefined' && routeHitLayer){map.removeLayer(routeHitLayer);routeHitLayer=null;}
  if(typeof routeLabelLayer!=='undefined')routeLabelLayer.clearLayers();
  if(typeof busPosOn!=='undefined')busPosOn=false;
  if(typeof stopBusPosPolling==='function')stopBusPosPolling();
  if(typeof stopGuide==='function')stopGuide();
  if(typeof currentRoute!=='undefined')currentRoute=null;
  document.getElementById('routeSidebar')?.classList.remove('open');
  if(typeof updateRouteReopenTab==='function')updateRouteReopenTab();
  plannerLayer=L.featureGroup().addTo(map);
  const drawToken=plannerLayer;
  plannerMapStatus='실제 버스 노선 표시 중…';
  plannerUpdateNote();
  const roads=[];
  path.legs.forEach((leg,j)=>{
    roads.push(Promise.resolve().then(()=>fetchBusRouteGeometry(leg.data.route.id,leg.start,leg.end)).then(roadPts=>{
      if(!roadPts || roadPts.length<2)throw new Error('노선 경로 없음');
      if(plannerLayer===drawToken && plannerDrawRevision===revision)L.polyline(roadPts,{color:['#ff5a36','#4f7de0','#8f65d5','#20a487'][j%4],weight:7,opacity:.9}).addTo(drawToken);
    }));
    const first=STOPS[STOP_BY_NODE.get(String(leg.data.route.nodes[leg.start]))];
    const last=STOPS[STOP_BY_NODE.get(String(leg.data.route.nodes[leg.end]))];
    if(first)L.marker([first.lat,first.lng]).bindPopup(`${j?'환승':'승차'}: ${esc(first.name)} · ${esc((leg.routeNames||[leg.data.route.name]).join(' · '))}`).addTo(plannerLayer);
    if(last && j===path.legs.length-1)L.marker([last.lat,last.lng]).bindPopup(`하차: ${esc(last.name)}`).addTo(plannerLayer);
  });
  const firstLeg=path.legs[0],lastLeg=path.legs[path.legs.length-1];
  const origin=STOPS[path.fromIndex],board=STOPS[STOP_BY_NODE.get(String(firstLeg.data.route.nodes[firstLeg.start]))];
  const alight=STOPS[STOP_BY_NODE.get(String(lastLeg.data.route.nodes[lastLeg.end]))],destination=STOPS[path.toIndex];
  const walkPairs=[];if(origin&&board&&String(origin.node)!==String(board.node))walkPairs.push([origin,board]);if(alight&&destination&&String(alight.node)!==String(destination.node))walkPairs.push([alight,destination]);
  roads.push(...walkPairs.map(pair=>plannerWalkingGeometry(pair[0],pair[1]).then(points=>{if(plannerLayer===drawToken&&plannerDrawRevision===revision)L.polyline(points,{color:'#36b9ff',weight:5,opacity:.9,dashArray:'7 7'}).addTo(drawToken);})));
  const bounds=plannerLayer.getBounds?.();
  if(bounds?.isValid())map.fitBounds(bounds,{padding:[45,45]});
  const result=await Promise.allSettled(roads);
  if(plannerLayer!==drawToken || plannerDrawRevision!==revision)return;
  const failures=result.filter(r=>r.status==='rejected').length;
  plannerMapStatus=failures?`${failures}개 구간의 상세 경로를 불러오지 못했습니다. 승하차 정류소를 확인해 주세요.`:'버스 노선과 도로·횡단보도 기반 보행 경로 표시 완료';
  plannerUpdateNote();
}

async function plannerWalkingGeometry(a,b){
  const coords=`${a.lng},${a.lat};${b.lng},${b.lat}`;
  const url=`https://routing.openstreetmap.de/routed-foot/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`;
  const response=await fetch(url);if(!response.ok)throw new Error('보행 경로 없음');
  const data=await response.json(),line=data?.routes?.[0]?.geometry?.coordinates;
  if(!Array.isArray(line)||line.length<2)throw new Error('보행 경로 없음');
  return line.map(([lng,lat])=>[lat,lng]);
}

function plannerInvalidateSearch(){
  plannerSearchRevision++;
  plannerSearching=false;
  plannerSearched=false;
  plannerPaths=[];
  plannerClearMap();
  document.getElementById('plannerSearch').disabled=false;
  plannerRender();
}

function plannerSetStop(kind,index){
  const s=STOPS[index];
  if(kind==='from')plannerFromIndex=index;
  else if(kind==='via')plannerViaIndex=index;
  else plannerToIndex=index;
  const id=kind==='from'?'plannerFrom':kind==='via'?'plannerVia':'plannerTo';
  document.getElementById(id).value=`${s.name} (${s.ars})`;
  document.getElementById(id+'Suggestions').style.display='none';
  plannerInvalidateSearch();
}
function plannerInitField(kind){
  const id=kind==='from'?'plannerFrom':kind==='via'?'plannerVia':'plannerTo';
  const input=document.getElementById(id);
  const box=document.getElementById(id+'Suggestions');
  input.addEventListener('input',()=>{
    if(kind==='from')plannerFromIndex=null;
    else if(kind==='via')plannerViaIndex=null;
    else plannerToIndex=null;
    plannerInvalidateSearch();
    box.innerHTML='';
    const matches=stopMatches(input.value,10);
    matches.forEach(i=>{
      const btn=document.createElement('button');btn.type='button';
      btn.textContent=`${STOPS[i].name} · ${STOPS[i].ars}`;
      btn.onclick=()=>plannerSetStop(kind,i);
      box.appendChild(btn);
    });
    box.style.display=matches.length?'block':'none';
  });
  input.addEventListener('keydown',e=>{
    if(e.key==='Enter'){
      const i=stopMatches(input.value,1)[0];
      if(i!=null)plannerSetStop(kind,i);
      box.style.display='none';
    }
    if(e.key==='Escape')box.style.display='none';
  });
}

if(typeof document!=='undefined'){
  plannerInitField('from');plannerInitField('via');plannerInitField('to');
  document.getElementById('plannerClimateOnly').addEventListener('change',plannerInvalidateSearch);
  document.getElementById('plannerBtn').onclick=()=>document.getElementById('plannerPanel').classList.add('open');
  document.getElementById('plannerClose').onclick=()=>document.getElementById('plannerPanel').classList.remove('open');
  document.getElementById('plannerSearch').onclick=async()=>{
    const note=document.getElementById('plannerNote');
    if(plannerFromIndex==null || plannerToIndex==null){note.textContent='출발·도착 정류소를 검색 결과에서 선택해 주세요.';return;}
    if(plannerFromIndex===plannerToIndex){note.textContent='출발과 도착이 같습니다. 다른 도착 정류소를 선택해 주세요.';return;}
    if(document.getElementById('plannerVia').value.trim() && plannerViaIndex==null){
      note.textContent='경유 정류소를 검색 결과에서 선택하거나 입력을 비워 주세요.';return;
    }
    const revision=++plannerSearchRevision,button=document.getElementById('plannerSearch');
    plannerClearMap();
    plannerSearching=true;
    button.disabled=true;
    plannerUpdateNote();
    await new Promise(resolve=>setTimeout(resolve,0));
    if(revision!==plannerSearchRevision)return;
    try{
      plannerPaths=plannerViaIndex==null?
        plannerFindPaths(plannerFromIndex,plannerToIndex):
        plannerFindViaPaths(plannerFromIndex,plannerViaIndex,plannerToIndex);
      plannerSearched=true;
    }catch(error){
      plannerPaths=[];
      plannerSearched=true;
      plannerMapStatus='경로 탐색 중 오류가 발생했습니다. 다시 검색해 주세요.';
      console.error('버스 길찾기 실패',error);
    }finally{
      plannerSearching=false;
      button.disabled=false;
      plannerRender();
    }
  };
  plannerRender();
}
