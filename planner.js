// Bus trip planner based on the stop order embedded in index.html.
const PLANNER_SORTS={optimal:'최적',time:'최소시간',distance:'최단거리',walk:'최소도보',detour:'우회 경로'};
const plannerRouteCache=new Map();
const plannerRoutesById=new Map(ROUTES.map(r=>[r.id,r]));
let plannerPaths=[],plannerSort='optimal',plannerLayer=null,plannerSelected=-1,plannerSearched=false;
let plannerFromIndex=null,plannerViaIndex=null,plannerToIndex=null;
let plannerDrawRevision=0,plannerMapStatus='',plannerSearching=false,plannerSearchRevision=0;
const plannerArrivalCache=new Map();
const plannerPlaces={from:null,to:null};
let plannerPickKind=null,plannerPlaceTimer=null,plannerActiveTrip=null,plannerTripWatch=null,plannerTripTimer=null;

function plannerClimateRoute(route){
  // 경기 숫자 노선도 이름만 보면 서울 지선/간선처럼 보인다. 기후동행
  // 필터에서는 데이터 출처가 경기인 노선을 먼저 확실하게 제외한다.
  return route?.region!=='gyeonggi' && !String(route?.id||'').startsWith('G') &&
    ['마을','지선','간선','심야'].includes(routeCategory(route.name));
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
  return {legs:joined,walk,distance,minutes,transfers,stopCount,fromIndex,toIndex,
    fromPlace:plannerPlaces.from?{...plannerPlaces.from}:null,toPlace:plannerPlaces.to?{...plannerPlaces.to}:null};
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

function plannerNearby(index,point){
  const origin=point||STOPS[index],near=[];
  for(let i=0;i<STOPS.length;i++){
    if(!STOPS[i].routes?.length)continue;
    const s=STOPS[i];
    if(Math.abs(s.lat-origin.lat)>.006 || Math.abs(s.lng-origin.lng)>.008)continue;
    const d=hav(origin.lat,origin.lng,s.lat,s.lng);
    if(d<=600)near.push({index:i,walk:d});
  }
  if(!near.length)near.push({index,walk:hav(origin.lat,origin.lng,STOPS[index].lat,STOPS[index].lng)});
  near.sort((a,b)=>a.walk-b.walk);
  return near.slice(0,12);
}

function plannerFindPaths(fromIndex,toIndex,options={}){
  if(fromIndex===toIndex)return [];
  const starts=options.exactStart?[{index:fromIndex,walk:0}]:plannerNearby(fromIndex,plannerPlaces.from);
  const ends=options.exactEnd?[{index:toIndex,walk:0}]:plannerNearby(toIndex,plannerPlaces.to),candidates=[];
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
    // 두 번째 버스를 한두 정거장만 타는 환승은 실제로는 환승 대기와
    // 승하차가 더 오래 걸리고, 바로 다음 정류장까지 걷는 편이 낫다.
    if(transfer && b.end-b.start<=2 && b.data.prefix[b.end]-b.data.prefix[b.start]<=1500)return;
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
function plannerDepartureDate(){
  const value=document.getElementById('plannerDeparture')?.value;
  const date=value?new Date(value):new Date();
  return Number.isNaN(date.getTime())?new Date():date;
}
function plannerClock(date){return date.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false});}
function plannerMatchingArrival(items,names){
  const wanted=new Set(names.map(String));
  return items.find(item=>wanted.has(String(item.rtNm)))||null;
}
function plannerVehicleBadges(routeName,item){
  if(!item)return '';
  const vehicle=typeof arrivalVehicleInfo==='function'?arrivalVehicleInfo(routeName,item,1):null;
  if(!vehicle)return '';
  const crowd=vehicle.crowd?`<span class="route-live-badge ${congestionBadgeClass(vehicle.crowd)}">${esc(congestionLabel(vehicle.crowd))}</span>`:'';
  const type=vehicle.type?`<span class="route-live-badge ${vehicle.type==='저상'?'type-low':''}">${vehicle.type==='저상'?'♿ ':''}${esc(vehicle.type)}</span>`:'';
  const reserve=vehicle.reserve?'<span class="planner-reserve">예비차</span>':'<span class="route-live-badge">일반차</span>';
  return `${crowd}${type}${reserve}`;
}
async function plannerLiveSummary(path){
  const rows=[];let elapsed=0;
  for(let i=0;i<path.legs.length;i++){
    const leg=path.legs[i],node=leg.data.route.nodes[leg.start],names=leg.routeNames||[leg.data.route.name];
    const items=await plannerArrivalsAt(node),item=plannerMatchingArrival(items,names);
    const sec=item?plannerArrivalTime(item,1):null,route=item?.rtNm||names[0];
    rows.push(`<div><b>${i?'환승':'승차'} ${esc(route)}번</b> · ${esc(plannerStopName(node))}<br>${item?esc(item.arrmsg1||((sec==null?'도착정보 없음':Math.ceil(sec/60)+'분 후'))):'현재 도착정보 없음'} <span class="route-live-meta">${plannerVehicleBadges(route,item)}</span></div>`);
    elapsed+=(sec||0)+(leg.end-leg.start)*105;
  }
  return rows.join('<div style="height:5px"></div>');
}
async function plannerEnhanceCards(paths){
  await Promise.all(paths.slice(0,12).map(async(path,i)=>{
    const box=document.querySelector(`.planner-result[data-plan-index="${i}"] .planner-live-detail`);if(!box)return;
    try{box.innerHTML=await plannerLiveSummary(path);}catch(e){box.textContent='실시간 도착정보를 불러오지 못했습니다.';}
  }));
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
    const el=document.createElement('div');
    el.tabIndex=0;el.role='button';el.className='planner-result'+(i===plannerSelected?' selected':'');
    el.dataset.planIndex=String(i);
    const names=p.legs.map(l=>(l.routeNames||[l.data.route.name]).join(' · ')).join(' → ');
    const steps=p.legs.map((l,j)=>`${j?'환승':'승차'} ${esc(plannerStopLabel(l.data.route.nodes[l.start]))} → ${esc(plannerStopLabel(l.data.route.nodes[l.end]))}<br>${esc((l.routeNames||[l.data.route.name]).join(' · '))} · 다음 정류소 ${esc(plannerStopName(l.data.route.nodes[l.start+1]))} 방향 · ${l.end-l.start}정류소`).join('<br>');
    const origin=p.fromPlace||STOPS[p.fromIndex],destination=p.toPlace||STOPS[p.toIndex];
    const firstNode=String(p.legs[0].data.route.nodes[p.legs[0].start]);
    const last=p.legs[p.legs.length-1],lastNode=String(last.data.route.nodes[last.end]);
    const firstStop=STOPS[STOP_BY_NODE.get(firstNode)],lastStop=STOPS[STOP_BY_NODE.get(lastNode)];
    const walkSteps=[origin&&firstStop&&hav(origin.lat,origin.lng,firstStop.lat,firstStop.lng)>15?`${origin.name||'출발지'}에서 ${plannerStopName(firstNode)}까지 도보`:null,
      destination&&lastStop&&hav(destination.lat,destination.lng,lastStop.lat,lastStop.lng)>15?`하차 후 ${destination.name||'목적지'}까지 도보`:null].filter(Boolean).map(esc).join('<br>');
    const climate=p.legs.every(l=>(l.routeOptions||[l]).some(o=>plannerClimateRoute(o.data.route)));
    const depart=plannerDepartureDate(),arrive=new Date(depart.getTime()+p.minutes*60000);
    el.innerHTML=`<strong>${i+1}. ${esc(names)}</strong><small>${plannerClock(depart)}~${plannerClock(arrive)} · 약 ${p.minutes}분 · 약 ${fmtDist(p.distance)} · 도보 약 ${fmtDist(p.walk)} · ${p.transfers?'환승 '+p.transfers+'회':'환승 없음'} · ${p.stopCount}정류소</small><small>${climate?'🌱 기후동행카드 가능 · ':''}${steps}</small>${walkSteps?'<small>🚶 도로·횡단보도 보행 경로 확인: '+walkSteps+'</small>':''}<div class="planner-live-detail">실시간 도착정보 확인 중…</div>${p.transfers?'<div class="planner-live warn">실시간 환승 확률 계산 중…</div>':''}<button type="button" class="planner-start-guide" data-start-trip="${i}">이 경로로 실시간 길찾기 시작</button>`;
    el.setAttribute('aria-pressed',String(i===plannerSelected));
    el.onclick=()=>{plannerClearMap();plannerSelected=i;plannerDraw(p);plannerRender();};
    el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();el.click();}};
    el.querySelector('.planner-start-guide').onclick=e=>{e.stopPropagation();plannerStartTrip(p);};
    box.appendChild(el);
  });
  plannerEnhanceTransferCards(ranked);
  plannerEnhanceCards(ranked);
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
  const origin=path.fromPlace||STOPS[path.fromIndex],board=STOPS[STOP_BY_NODE.get(String(firstLeg.data.route.nodes[firstLeg.start]))];
  const alight=STOPS[STOP_BY_NODE.get(String(lastLeg.data.route.nodes[lastLeg.end]))],destination=path.toPlace||STOPS[path.toIndex];
  const walkPairs=[];if(origin&&board&&hav(origin.lat,origin.lng,board.lat,board.lng)>15)walkPairs.push([origin,board]);if(alight&&destination&&hav(alight.lat,alight.lng,destination.lat,destination.lng)>15)walkPairs.push([alight,destination]);
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
  if(kind==='from'||kind==='to')plannerPlaces[kind]=null;
  if(kind==='from')plannerFromIndex=index;
  else if(kind==='via')plannerViaIndex=index;
  else plannerToIndex=index;
  const id=kind==='from'?'plannerFrom':kind==='via'?'plannerVia':'plannerTo';
  document.getElementById(id).value=`${s.name} (${s.ars})`;
  document.getElementById(id+'Suggestions').style.display='none';
  plannerInvalidateSearch();
}
function plannerNearestStop(lat,lng){
  let best=-1,distance=Infinity;
  STOPS.forEach((s,i)=>{if(!s.routes?.length)return;const d=hav(lat,lng,s.lat,s.lng);if(d<distance){distance=d;best=i;}});
  return {index:best,distance};
}
function plannerSetPlace(kind,place){
  const nearest=plannerNearestStop(place.lat,place.lng);if(nearest.index<0)return;
  plannerPlaces[kind]={name:place.name,lat:Number(place.lat),lng:Number(place.lng)};
  if(kind==='from')plannerFromIndex=nearest.index;else plannerToIndex=nearest.index;
  const id=kind==='from'?'plannerFrom':'plannerTo';
  document.getElementById(id).value=place.name;
  document.getElementById(id+'Suggestions').style.display='none';
  plannerInvalidateSearch();
}
async function plannerSearchPlaces(query){
  if(query.trim().length<2)return [];
  const url='https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=kr&accept-language=ko&limit=6&q='+encodeURIComponent(query);
  const response=await fetch(url,{headers:{Accept:'application/json'}});if(!response.ok)return [];
  const data=await response.json();
  return data.map(x=>({name:String(x.display_name||query),lat:Number(x.lat),lng:Number(x.lon)})).filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lng));
}
function plannerInitField(kind){
  const id=kind==='from'?'plannerFrom':kind==='via'?'plannerVia':'plannerTo';
  const input=document.getElementById(id);
  const box=document.getElementById(id+'Suggestions');
  input.addEventListener('input',()=>{
    if(kind==='from'){plannerFromIndex=null;plannerPlaces.from=null;}
    else if(kind==='via')plannerViaIndex=null;
    else {plannerToIndex=null;plannerPlaces.to=null;}
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
    if(kind!=='via'){
      clearTimeout(plannerPlaceTimer);
      const value=input.value.trim();
      plannerPlaceTimer=setTimeout(async()=>{
        const places=await plannerSearchPlaces(value).catch(()=>[]);if(input.value.trim()!==value)return;
        for(const place of places){
          const btn=document.createElement('button');btn.type='button';btn.textContent='📍 '+place.name;
          btn.onclick=()=>plannerSetPlace(kind,place);box.appendChild(btn);
        }
        box.style.display=box.children.length?'block':'none';
      },350);
    }
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

function plannerStopTrip(){
  if(plannerTripWatch!=null&&navigator.geolocation)navigator.geolocation.clearWatch(plannerTripWatch);
  plannerTripWatch=null;clearInterval(plannerTripTimer);plannerTripTimer=null;plannerActiveTrip=null;
  const box=document.getElementById('plannerNav');if(box)box.hidden=true;
}
function plannerTripTarget(trip){
  const leg=trip.path.legs[trip.legIndex],node=trip.phase==='riding'?leg.data.route.nodes[leg.end]:leg.data.route.nodes[leg.start];
  return STOPS[STOP_BY_NODE.get(String(node))];
}
async function plannerUpdateTrip(position){
  const trip=plannerActiveTrip;if(!trip)return;
  if(position){trip.lat=position.coords.latitude;trip.lng=position.coords.longitude;trip.speed=Number(position.coords.speed)||0;if(typeof updateGuideMarker==='function')updateGuideMarker(trip.lat,trip.lng);}
  if(!Number.isFinite(trip.lat)||!Number.isFinite(trip.lng))return;
  const leg=trip.path.legs[trip.legIndex],board=STOPS[STOP_BY_NODE.get(String(leg.data.route.nodes[leg.start]))],alight=STOPS[STOP_BY_NODE.get(String(leg.data.route.nodes[leg.end]))];
  const names=leg.routeNames||[leg.data.route.name],toBoard=hav(trip.lat,trip.lng,board.lat,board.lng),toAlight=hav(trip.lat,trip.lng,alight.lat,alight.lng);
  let live='';
  if(trip.phase==='walk'&&toBoard<=55)trip.phase='waiting';
  if(trip.phase==='waiting'&&Date.now()-(trip.lastLive||0)>8000){
    trip.lastLive=Date.now();
    try{
      const arrivals=await plannerArrivalsAt(leg.data.route.nodes[leg.start]);
      const item=plannerMatchingArrival(arrivals,names),seconds=item?plannerArrivalTime(item,1):null;
      const chosen=(leg.routeOptions||[leg]).find(option=>String(option.data.route.name)===String(item?.rtNm))||leg;
      const vehicles=await fetchBusPositions(chosen.data.route.id).catch(()=>[]);
      const nearbyVehicle=vehicles.find(v=>Number.isFinite(Number(v.gpsY))&&hav(trip.lat,trip.lng,Number(v.gpsY),Number(v.gpsX))<85);
      live=item?`${item.arrmsg1||''} ${plannerVehicleBadges(item.rtNm||names[0],item)}`:'도착정보 조회 중';
      if(toBoard<65&&(nearbyVehicle||(seconds!=null&&seconds<=20&&trip.speed>=2.5)))trip.phase='riding';
    }catch(e){live='도착정보를 잠시 불러오지 못했습니다.';}
  }
  if(trip.phase==='riding'&&toAlight<=90){
    if(trip.legIndex<trip.path.legs.length-1){trip.legIndex++;trip.phase='waiting';trip.lastLive=0;}
    else trip.phase='finalwalk';
  }
  if(trip.phase==='riding'&&trip.path.transfers&&trip.legIndex===0&&Date.now()-(trip.lastChance||0)>15000){
    trip.lastChance=Date.now();
    try{const chance=await plannerTransferChance(trip.path);if(chance)live=chance.text;}catch(e){}
  }
  const destination=trip.path.toPlace||STOPS[trip.path.toIndex];
  if(trip.phase==='finalwalk'&&destination&&hav(trip.lat,trip.lng,destination.lat,destination.lng)<=45)trip.phase='done';
  const current=trip.path.legs[trip.legIndex],routeNames=current.routeNames||[current.data.route.name];
  const text=trip.phase==='walk'?`${board.name}까지 ${fmtDist(toBoard)} 걸어가세요.`:
    trip.phase==='waiting'?`${board.name}에서 ${routeNames.join(' · ')}번을 타세요.`:
    trip.phase==='riding'?`${alight.name}에서 내리세요 · 약 ${fmtDist(toAlight)} 남음`:
    trip.phase==='finalwalk'?`하차 후 ${destination.name||'목적지'}까지 걸어가세요.`:'목적지에 도착했습니다.';
  const box=document.getElementById('plannerNav');box.hidden=false;
  box.innerHTML=`<strong>${trip.phase==='done'?'도착':'실시간 길찾기'} · ${esc(text)}</strong><small>${live||'현재 위치와 버스 위치로 탑승·하차를 자동 확인합니다.'}</small><button type="button" class="planner-nav-stop">길찾기 종료</button>`;
  box.querySelector('button').onclick=plannerStopTrip;
  if(trip.phase==='done'&&!trip.doneNotified){trip.doneNotified=true;if(navigator.vibrate)navigator.vibrate([150,80,150]);}
}
function plannerStartTrip(path){
  plannerStopTrip();plannerActiveTrip={path,legIndex:0,phase:'walk',lastLive:0};
  document.getElementById('plannerNav').hidden=false;
  document.getElementById('plannerNav').innerHTML='<strong>현재 위치 확인 중…</strong><small>위치 권한을 허용해 주세요.</small>';
  if(!navigator.geolocation){document.getElementById('plannerNav').innerHTML='<strong>이 기기에서는 위치를 사용할 수 없습니다.</strong>';return;}
  plannerTripWatch=navigator.geolocation.watchPosition(plannerUpdateTrip,()=>{const b=document.getElementById('plannerNav');b.hidden=false;b.innerHTML='<strong>현재 위치를 확인하지 못했습니다.</strong><small>브라우저 위치 권한을 확인해 주세요.</small><button type="button" class="planner-nav-stop">길찾기 종료</button>';b.querySelector('button').onclick=plannerStopTrip;},{enableHighAccuracy:true,maximumAge:3000,timeout:12000});
  plannerTripTimer=setInterval(()=>plannerUpdateTrip(),10000);
}

if(typeof document!=='undefined'){
  plannerInitField('from');plannerInitField('via');plannerInitField('to');
  const departure=document.getElementById('plannerDeparture');
  const now=new Date(Date.now()-new Date().getTimezoneOffset()*60000);departure.value=now.toISOString().slice(0,16);
  departure.addEventListener('change',()=>{if(plannerSearched)plannerRender();});
  document.querySelectorAll('.planner-map-pick').forEach(btn=>btn.onclick=()=>{
    plannerPickKind=btn.dataset.kind;
    document.getElementById('plannerPanel').classList.remove('open');
    document.getElementById('status').textContent=`지도에서 ${plannerPickKind==='from'?'출발':'도착'} 위치를 눌러 주세요.`;
  });
  if(typeof map!=='undefined')map.on('click',e=>{
    if(!plannerPickKind)return;
    const kind=plannerPickKind;plannerPickKind=null;
    plannerSetPlace(kind,{name:`지도 선택 위치 (${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)})`,lat:e.latlng.lat,lng:e.latlng.lng});
    document.getElementById('plannerPanel').classList.add('open');
    document.getElementById('status').textContent='지도 위치가 길찾기에 설정되었습니다.';
  });
  document.getElementById('plannerClimateOnly').addEventListener('change',plannerInvalidateSearch);
  document.getElementById('plannerBtn').onclick=()=>document.getElementById('plannerPanel').classList.add('open');
  document.getElementById('plannerClose').onclick=()=>document.getElementById('plannerPanel').classList.remove('open');
  document.getElementById('plannerSearch').onclick=async()=>{
    const note=document.getElementById('plannerNote');
    if(plannerFromIndex==null || plannerToIndex==null){note.textContent='출발·도착 정류소 또는 장소를 검색 결과에서 선택해 주세요.';return;}
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
