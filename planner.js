// Bus trip planner based on the stop order embedded in index.html.
const PLANNER_SORTS={optimal:'최적',time:'최소시간',transfers:'최소환승',distance:'최단거리',walk:'최소도보',detour:'우회 경로'};
const plannerRouteCache=new Map();
const plannerRoutesById=new Map(ROUTES.map(r=>[r.id,r]));
let plannerPaths=[],plannerSort='optimal',plannerLayer=null,plannerSelected=-1,plannerSearched=false;
let plannerFromIndex=null,plannerViaIndex=null,plannerToIndex=null;
let plannerDrawRevision=0,plannerMapStatus='',plannerSearching=false,plannerSearchRevision=0;
const plannerArrivalCache=new Map();
const plannerPlaces={from:null,to:null};
let plannerPickKind=null,plannerPlaceTimer=null,plannerActiveTrip=null,plannerTripWatch=null,plannerTripTimer=null;
let plannerLiveRefreshTimer=null,plannerRenderedPaths=[];

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
  // 환승은 대기·정차·승하차 여유를 포함한 실제 소요시간으로 계산한다.
  // 환승을 많이 넣어 성공확률만 높이는 경로가 최적 경로를 밀어내지 않도록
  // 환승 1회당 기본 8분을 반영한다.
  const minutes=Math.max(1,Math.round(busDistance/1000/22*60+stopCount*.28+walk/1000/4.5*60+joined.length*5+transfers*8));
  const fromPoint=plannerPlaces.from||STOPS[fromIndex],toPoint=plannerPlaces.to||STOPS[toIndex];
  const directDistance=fromPoint&&toPoint?hav(fromPoint.lat,fromPoint.lng,toPoint.lat,toPoint.lng):distance;
  return {legs:joined,walk,distance,directDistance,minutes,transfers,stopCount,fromIndex,toIndex,
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
  const kept=[...choices.values()].filter(path=>!corridors.get(plannerCorridor(path.legs)).some(other=>
    other.transfers<path.transfers && other.walk<=path.walk && other.minutes<=path.minutes));
  // Walking to another stop of the very bus that already stops nearer the
  // start is pointless: board it at the closer stop and ride instead.
  const rest=path=>path.legs.map((l,i)=>`${l.data.route.id}:${i?l.start:'*'}-${l.end}`).join('|');
  const byRest=new Map();
  for(const path of kept){const key=rest(path);if(!byRest.has(key))byRest.set(key,[]);byRest.get(key).push(path);}
  return kept.filter(path=>!byRest.get(rest(path)).some(other=>
    other!==path && other.walk<path.walk && other.minutes<=path.minutes+3));
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
    if(d<=750)near.push({index:i,walk:d});
  }
  if(!near.length)near.push({index,walk:hav(origin.lat,origin.lng,STOPS[index].lat,STOPS[index].lng)});
  near.sort((a,b)=>a.walk-b.walk);
  // Keep enough nearby poles to include the opposite side of a dense road.
  return near.slice(0,28);
}

function plannerFindPaths(fromIndex,toIndex,options={}){
  if(fromIndex===toIndex)return [];
  const starts=options.exactStart?[{index:fromIndex,walk:0}]:plannerNearby(fromIndex,plannerPlaces.from);
  const ends=options.exactEnd?[{index:toIndex,walk:0}]:plannerNearby(toIndex,plannerPlaces.to),candidates=[];
  const straight=hav(STOPS[fromIndex].lat,STOPS[fromIndex].lng,STOPS[toIndex].lat,STOPS[toIndex].lng);
  const maxBusDist=Math.max(3500,straight*2.5+2200);
  const seen=new Set();
  const add=(a,b,startWalk,endWalk,transfer)=>{
    if(candidates.length>=8000)return;
    const legs=transfer?[{...a},{...b}]:[{...a}];
    // For every route, keep riding when a later stop gets closer to the
    // destination. Never suggest getting off early and walking alongside the
    // same bus. Exact destination stops naturally win with zero walking.
    const last=legs[legs.length-1];
    let betterEnd={position:last.end,walk:endWalk};
    for(const nearbyEnd of ends){
      if(nearbyEnd.walk>=betterEnd.walk)continue;
      const later=(last.data.positions.get(STOPS[nearbyEnd.index].node)||[]).find(position=>position>last.end);
      if(later!=null)betterEnd={position:later,walk:nearbyEnd.walk};
    }
    if(betterEnd.position!==last.end){last.end=betterEnd.position;endWalk=betterEnd.walk;}
    const walk=startWalk+endWalk;
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
            if(q>p)add({data:a,start:p,end:q},null,start.walk,end.walk,false);
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
                  if(z>y)add({data:a,start:p,end:x},{data:b,start:y,end:z},start.walk,end.walk,true);
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
  // 환승 대기는 3분 이내가 가장 좋고 5분을 넘기면 총 이동시간에 불리하게 본다.
  const optimal=p=>p.minutes+p.walk/250+p.transfers*10+Math.max(0,p.distance-(p.directDistance||p.distance)*1.35)/450;
  const first=p=>sort==='time'?p.minutes:sort==='transfers'?p.transfers:sort==='distance'?p.distance:
    sort==='walk'?p.walk:sort==='detour'?-p.distance:optimal(p);
  return paths.slice().sort((a,b)=>first(a)-first(b)||optimal(a)-optimal(b)||a.transfers-b.transfers||a.distance-b.distance||plannerPathKey(a).localeCompare(plannerPathKey(b)));
}

function plannerDisplayPaths(){
  const grouped=plannerGroupPaths(plannerPaths),ranked=plannerRank(grouped,plannerSort);
  if(!ranked.length)return [];
  const bestMinutes=Math.min(...ranked.map(path=>path.minutes));
  const bestWalk=Math.min(...ranked.map(path=>path.walk));
  // Remove routes that are plainly worse before limiting the visible list.
  // This prevents hundreds of nearby-pole combinations from reaching the UI.
  const sensible=ranked.filter(path=>path.minutes<=bestMinutes+30&&path.walk<=Math.max(900,bestWalk+600));
  return (sensible.length?sensible:ranked).slice(0,20);
}

// Several buses often serve exactly the same boarding/transfer/alighting
// corridor. Present that as one choice and list every bus usable on each leg.
function plannerGroupPaths(paths){
  const groups=new Map();
  for(const p of paths){
    // Routes using the same boarding, transfer and alighting stops are one
    // practical choice even when their intermediate stop lists differ.
    const key=p.legs.map(leg=>`${leg.data.route.nodes[leg.start]}>${leg.data.route.nodes[leg.end]}`).join('|');
    let g=groups.get(key);
    if(!g){
      g={...p,legs:p.legs.map(l=>({...l,routeNames:[l.data.route.name],routeOptions:[l]}))};
      groups.set(key,g);
      continue;
    }
    const oldOptions=g.legs.map(leg=>leg.routeOptions.slice());
    if(p.minutes+p.walk/250<g.minutes+g.walk/250){
      g={...p,legs:p.legs.map(l=>({...l,routeNames:[l.data.route.name],routeOptions:[l]}))};
      groups.set(key,g);
    }
    const allOptions=oldOptions.map((options,i)=>options.concat(p.legs[i]?[p.legs[i]]:[]));
    allOptions.forEach((options,i)=>options.forEach(option=>{
      if(g.legs[i]&&!g.legs[i].routeOptions.some(existing=>existing.data.route.id===option.data.route.id)){
        g.legs[i].routeNames.push(option.data.route.name);g.legs[i].routeOptions.push(option);
      }
    }));
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
function plannerRouteClass(name){
  const category=typeof routeCategory==='function'?routeCategory(name):'';
  return category==='지선'?'branch':(category==='간선'||category==='심야')?'trunk':'other';
}
function plannerSelectedOption(leg){
  const selected=String(leg.selectedRouteId||'');
  return (leg.routeOptions||[leg]).find(option=>String(option.data.route.id)===selected)||null;
}
function plannerLegNames(leg){
  const selected=plannerSelectedOption(leg);
  return selected?[selected.data.route.name]:(leg.routeNames||[leg.data.route.name]);
}
function plannerLegVariants(leg){
  const groups=new Map();
  for(const option of (leg.routeOptions||[leg])){
    const nodes=option.data.route.nodes.slice(option.start,option.end+1);
    const key=nodes.map(String).join('>');
    if(!groups.has(key))groups.set(key,{nodes,options:[]});
    groups.get(key).options.push(option);
  }
  return [...groups.values()];
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
  if(old&&Date.now()-old.at<15000)return old.data;
  const data=await fetchStopArrivals(stop.ars);plannerArrivalCache.set(key,{at:Date.now(),data});return data;
}
function plannerRouteArrivalTimes(items,names){
  const wanted=new Set(names.map(String)),times=[];
  for(const item of items){if(!wanted.has(String(item.rtNm)))continue;const nums=Object.keys(item).map(k=>{const m=k.match(/^arrmsg(\d+)$/);return m?Number(m[1]):0;}).filter(n=>n>0);if(!nums.length)nums.push(1);for(const n of [...new Set(nums)]){const value=plannerArrivalTime(item,n);if(value!=null)times.push(value);}}
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
function plannerArrivalCandidates(items,names){
  const wanted=new Set(names.map(String)),out=[];
  for(const item of items){
    if(!wanted.has(String(item.rtNm)))continue;
    const vehicles=typeof orderedArrivalVehicles==='function'?orderedArrivalVehicles(item.rtNm,item):[];
    if(vehicles.length){
      for(const vehicle of vehicles){const sec=plannerArrivalTime(item,vehicle.n);if(sec!=null)out.push({item,vehicle,sec,route:String(item.rtNm),n:vehicle.n});}
    }else{
      // "운행종료" (service ended) is not a bus anyone can take, even if its time field reads 0
      const sec=/운행종료/.test(String(item.arrmsg1||''))?null:plannerArrivalTime(item,1);if(sec!=null)out.push({item,vehicle:null,sec,route:String(item.rtNm),n:1});
    }
  }
  return out.sort((a,b)=>a.sec-b.sec);
}
function plannerBestArrival(items,names,minSeconds=0){
  return plannerArrivalCandidates(items,names).find(x=>x.sec>=Math.max(0,minSeconds))||null;
}
function plannerVehicleBadges(routeName,item,n=1){
  if(!item)return '';
  const vehicle=typeof arrivalVehicleInfo==='function'?arrivalVehicleInfo(routeName,item,n):null;
  if(!vehicle)return '';
  const crowd=!isVillageRouteName(routeName)&&vehicle.crowd?`<span class="route-live-badge ${congestionBadgeClass(vehicle.crowd)}">${esc(congestionLabel(vehicle.crowd))}</span>`:'';
  const type=vehicle.type?`<span class="route-live-badge ${vehicle.type==='저상'?'type-low':''}">${vehicle.type==='저상'?'♿ ':''}${esc(vehicle.type)}</span>`:'';
  const reserve=vehicle.reserve?'<span class="planner-reserve">예비차</span>':'';
  return `${crowd}${type}${reserve}`;
}
// Which bus option of a leg carries this route name (stop counts differ per route).
function plannerLegOption(base,routeName){
  return (base.routeOptions||[base]).find(o=>String(o.data.route.name)===String(routeName))||plannerSelectedOption(base)||base;
}
function plannerPlateOf(cand){return cand?.item?String(cand.item['plainNo'+(cand.n||1)]||'').trim():'';}
// Seconds until the chosen bus of a leg reaches that leg's alighting stop.
// Looked up by number plate in the alighting stop's arrival list, so a catchable
// transfer is not hidden by a pessimistic per-stop estimate.
async function plannerReachAfter(base,cand){
  if(!cand)return null;
  const option=plannerLegOption(base,cand.route),plate=plannerPlateOf(cand);
  if(plate){
    try{
      const items=await plannerArrivalsAt(option.data.route.nodes[option.end]);
      const hit=plannerArrivalCandidates(items,[cand.route]).find(c=>plannerPlateOf(c)===plate);
      if(hit)return {sec:hit.sec+60,exact:true};
    }catch(e){}
  }
  return {sec:cand.sec+(option.end-option.start)*80+60,exact:false};
}
// Live plan: for each leg, the candidate buses at its boarding stop and the
// chosen one. Transfer legs auto-pick the first bus that can still be caught;
// path.liveOffset[i] lets the user step to the previous/next bus.
async function plannerLivePlan(path,offsets){
  offsets=offsets||path.liveOffset||{};
  const legs=[];let reach=null;
  for(let i=0;i<path.legs.length;i++){
    const base=path.legs[i],leg=plannerSelectedOption(base)||base,node=leg.data.route.nodes[leg.start],names=plannerLegNames(base);
    const items=await plannerArrivalsAt(node),cands=plannerArrivalCandidates(items,names);
    const minSec=reach?Math.max(0,reach.sec-30):0;
    let auto=cands.findIndex(c=>c.sec>=minSec);if(auto<0)auto=cands.length;
    const offset=offsets[i]||0,idx=cands.length?Math.max(0,Math.min(cands.length-1,auto+offset)):-1;
    const best=idx>=0&&auto<cands.length||idx>=0&&offset<0?cands[idx]:null;
    legs.push({base,leg,node,names,items,cands,best,idx,auto,offset,reach});
    reach=best?await plannerReachAfter(base,best):null;
  }
  let chance=null;
  if(legs.length>1){
    const t=legs[1];
    if(!legs[0].best||!t.reach)chance={text:'실시간 환승 정보 없음',level:'warn'};
    else if(!t.best)chance={text:'현재 조회된 차량으로는 환승이 어려움 · 다음 차 정보를 기다리는 중',level:'bad'};
    else{
      const buffer=t.best.sec-t.reach.sec;
      const base=100/(1+Math.exp(-(buffer-60)/120));
      // 3분 이내 대기가 가장 좋고, 5분을 넘는 긴 대기는 성공률이 높아도 감점한다.
      const waitPenalty=buffer<=180?1:buffer<=300?.9:Math.max(.35,1-(buffer-300)/900);
      const prob=Math.max(3,Math.min(98,Math.round(base*waitPenalty)));
      chance={prob,text:`환승 성공 추정 ${prob}% · 환승 여유 약 ${Math.max(0,Math.round(buffer/60))}분${t.reach.exact?'':' (도착시각 추정)'}`,level:prob>=75?'':prob>=40?'warn':'bad'};
    }
  }
  return {legs,chance,at:new Date()};
}
function plannerCandText(cand){
  if(!cand)return '';
  const n=cand.n||1,msg=String(cand.item?.['arrmsg'+n]||'')||Math.ceil(cand.sec/60)+'분 후',plate=plannerVehicleNumber(plannerPlateOf(cand));
  return `<b>${esc(cand.route)}번</b> ${esc(msg)}${plate?` · ${esc(plate)}`:''} <span class="route-live-meta">${plannerVehicleBadges(cand.route,cand.item,n)}</span>`;
}
async function plannerLiveSummary(path){
  const plan=await plannerLivePlan(path);
  const rows=plan.legs.map((L,i)=>{
    const alightNode=L.leg.data.route.nodes[L.leg.end],stops=L.best?plannerLegOption(L.base,L.best.route):L.leg;
    const chosen=L.best?plannerCandText(L.best):`<span>현재 정류장 API에 탈 수 있는 ${esc(L.names.join('·'))}번 차량이 아직 잡히지 않음</span>`;
    const others=L.names.filter(n=>n!==L.best?.route).map(n=>{const c=L.cands.find(x=>x.route===n&&x.sec>=(L.reach?L.reach.sec-30:0));return c?plannerCandText(c):'';}).filter(Boolean);
    const nav=L.cands.length>1?`<span class="planner-veh-nav"><button type="button" data-leg="${i}" data-step="-1" ${L.idx<=0?'disabled':''}>◀ 전차</button><button type="button" data-leg="${i}" data-step="1" ${L.idx>=L.cands.length-1?'disabled':''}>다음차 ▶</button>${L.offset?`<button type="button" data-leg="${i}" data-step="0">자동</button>`:''}</span>`:'';
    const tag=L.offset?'선택한 차량':i?'탈 수 있는 첫 차':'가장 먼저 오는 차';
    return `<div><b>${i?'환승':'승차'}</b> ${esc(plannerStopName(L.node))}<br><small>${tag}</small> ${chosen}${nav}${others.length?`<br><small>다른 노선</small> ${others.join(' · ')}`:''}<br><b>하차</b> ${esc(plannerStopName(alightNode))} · ${stops.end-stops.start}정류소 후</div>`;
  });
  return {html:rows.join('<div style="height:5px"></div>'),chance:plan.chance,at:plan.at};
}
async function plannerEnhanceDetail(path){
  const panel=document.getElementById('plannerDetail');
  if(!panel?.classList.contains('open'))return;
  const live=panel.querySelector('.planner-live-detail'),chance=panel.querySelector('.planner-live'),stamp=panel.querySelector('.planner-live-stamp');
  try{
    const r=await plannerLiveSummary(path);
    if(!panel.classList.contains('open'))return;
    live.innerHTML=r.html;
    live.querySelectorAll('.planner-veh-nav button').forEach(b=>b.onclick=()=>{
      const i=Number(b.dataset.leg),step=Number(b.dataset.step);
      path.liveOffset=path.liveOffset||{};path.liveOffset[i]=step?(path.liveOffset[i]||0)+step:0;
      plannerEnhanceDetail(path);
    });
    if(chance&&path.transfers){chance.textContent=r.chance?.text||'실시간 환승 정보 없음';chance.className='planner-live '+(r.chance?.level||'warn');}
    if(stamp)stamp.textContent=`${plannerClock(r.at)}:${String(r.at.getSeconds()).padStart(2,'0')} 갱신 · 20초마다 자동`;
  }catch(e){live.textContent='실시간 도착정보를 불러오지 못했습니다.';}
}
async function plannerTransferChance(path){
  if(!path.transfers)return null;
  const plan=await plannerLivePlan(path);
  return plan.chance&&{...plan.chance,text:`${plan.chance.text} · ${plannerClock(plan.at)} 갱신`};
}
// ---- only buses that actually run at the departure time -----------------
// Seoul's stop-arrival data carries each route's first/last bus (firstTm/lastTm,
// HHMM) and "운행종료" once service has ended. Departing now: a route showing
// 운행종료 at the boarding stop is dropped. Departing later/earlier: the
// first/last times decide. No fixed hours, so special-day night buses
// (e.g. an N bus still running at 6:00) follow the real data.
function plannerHHMM(v){const m=String(v||'').match(/^(\d{2})(\d{2})/);return m?Number(m[1])*60+Number(m[2]):null;}
function plannerWithinService(first,last,date){
  const f=plannerHHMM(first),l=plannerHHMM(last);if(f==null||l==null)return true;
  const t=date.getHours()*60+date.getMinutes(),end=(l+60)%1440,start=(f-10+1440)%1440;  // last bus still travelling ~1 h
  return start<=end?(t>=start&&t<=end):(t>=start||t<=end);
}
async function plannerOperatingFilter(paths){
  const depart=plannerDepartureDate(),isNow=Math.abs(depart.getTime()-Date.now())<15*60000;
  const times=new Map(),stopMsg=new Map(),checked=new Set();
  const ok=(name,node)=>{
    if(isNow){const m=stopMsg.get(node+'|'+name);if(m!=null)return !/운행종료/.test(m);}
    const t=times.get(name);return t?plannerWithinService(t.first,t.last,depart):true;
  };
  const keep=p=>p.legs.every(l=>ok(String(l.data.route.name),String(l.data.route.nodes[l.start])));
  for(let round=0;round<3;round++){
    plannerPaths=paths;
    const nodes=[...new Set(plannerDisplayPaths().flatMap(p=>p.legs.flatMap(l=>(l.routeOptions||[l]).map(o=>String(o.data.route.nodes[o.start])))))].filter(n=>!checked.has(n)).slice(0,14);
    if(!nodes.length)break;
    await Promise.all(nodes.map(async n=>{
      checked.add(n);
      try{for(const it of await plannerArrivalsAt(n)){const name=String(it.rtNm);stopMsg.set(n+'|'+name,String(it.arrmsg1||''));if(it.firstTm||it.lastTm)times.set(name,{first:it.firstTm,last:it.lastTm});}}catch(e){}
    }));
    const before=paths.length;paths=paths.filter(keep);
    if(paths.length===before&&round>0)break;
  }
  return paths.filter(keep);
}
async function plannerEnhanceTransferCards(paths){
  await Promise.all(paths.slice(0,10).map(async(path,i)=>{
    if(!path.transfers)return;
    const box=document.querySelector(`.planner-result[data-plan-index="${i}"] .planner-live`);if(!box)return;
    try{const result=await plannerTransferChance(path);if(!result)return;box.textContent=result.text;box.className='planner-live '+result.level;}catch(e){box.textContent='실시간 환승 정보를 불러오지 못했습니다.';box.className='planner-live warn';}
  }));
}
function plannerScheduleLiveRefresh(paths){
  plannerRenderedPaths=paths;
  if(plannerLiveRefreshTimer)clearInterval(plannerLiveRefreshTimer);
  // Arrivals and the transfer chance change minute by minute; refresh the open
  // route detail every 20 s (the 🔄 button refreshes immediately).
  plannerLiveRefreshTimer=setInterval(()=>{
    if(!document.getElementById('plannerDetail')?.classList.contains('open'))return;
    if(document.hidden)return;
    plannerArrivalCache.clear();
    const path=plannerRenderedPaths[plannerSelected];
    if(path)plannerEnhanceDetail(path);
  },20000);
}
function plannerCloseDetail(){document.getElementById('plannerDetail')?.classList.remove('open');}
function plannerOpenDetail(path,index){
  const panel=document.getElementById('plannerDetail');if(!panel)return;
  const names=path.legs.map(l=>plannerLegNames(l).join(' · ')).join(' → ');
  const depart=plannerDepartureDate(),arrive=new Date(depart.getTime()+path.minutes*60000);
  const origin=path.fromPlace||STOPS[path.fromIndex],destination=path.toPlace||STOPS[path.toIndex];
  const first=plannerSelectedOption(path.legs[0])||path.legs[0],lastBase=path.legs[path.legs.length-1],last=plannerSelectedOption(lastBase)||lastBase;
  const board=STOPS[STOP_BY_NODE.get(String(first.data.route.nodes[first.start]))],alight=STOPS[STOP_BY_NODE.get(String(last.data.route.nodes[last.end]))];
  const climate=path.legs.every(l=>(l.routeOptions||[l]).some(o=>plannerClimateRoute(o.data.route))),timeline=[];
  if(origin&&board&&hav(origin.lat,origin.lng,board.lat,board.lng)>15)timeline.push(`<div class="planner-detail-step walk"><b>${esc(origin.name||'출발지')}</b><span>🚶 ${esc(board.name)}까지 도보 약 ${fmtDist(hav(origin.lat,origin.lng,board.lat,board.lng))}</span></div>`);
  path.legs.forEach((leg,i)=>{
    const active=plannerSelectedOption(leg)||leg,start=plannerStopLabel(active.data.route.nodes[active.start]),end=plannerStopLabel(active.data.route.nodes[active.end]),direction=plannerStopName(active.data.route.nodes[active.start+1]);
    const routeClass=plannerRouteClass(active.data.route.name);
    const choices=(leg.routeOptions||[leg]).map(option=>`<button type="button" class="planner-route-choice ${plannerRouteClass(option.data.route.name)}${String(option.data.route.id)===String(leg.selectedRouteId||'')?' selected':''}" data-leg-index="${i}" data-route-id="${esc(option.data.route.id)}" aria-pressed="${String(option.data.route.id)===String(leg.selectedRouteId||'')}">${esc(option.data.route.name)}번</button>`).join('');
    const variants=plannerLegVariants(leg).map(variant=>{const routeNames=variant.options.map(option=>option.data.route.name).join(' · '),stops=variant.nodes.map((node,n)=>`<li${n===0?' class="board"':n===variant.nodes.length-1?' class="alight"':''}>${esc(plannerStopLabel(node))}</li>`).join('');return `<div class="planner-stop-variant"><strong>${esc(routeNames)}번 · ${variant.nodes.length-1}정류소</strong><button type="button" class="planner-stops-toggle" aria-expanded="false">전체 정류장 펼치기</button><ol class="planner-leg-stops" hidden>${stops}</ol></div>`;}).join('');
    timeline.push(`<div class="planner-detail-step bus ${routeClass}"><b>${i?'환승':'승차'} ${esc(start)}</b><div class="planner-route-pick"><span>탈 노선 선택 · 선택하지 않으면 위치로 자동 확인</span><div class="planner-route-choices">${choices}</div></div><span>다음 정류소 ${esc(direction)} 방향 · ${active.end-active.start}정류소</span><em>하차 ${esc(end)}</em><div class="planner-stop-variants">${variants}</div></div>`);
  });
  if(destination&&alight&&hav(destination.lat,destination.lng,alight.lat,alight.lng)>15)timeline.push(`<div class="planner-detail-step walk"><b>${esc(destination.name||'목적지')}</b><span>🚶 하차 후 도보 약 ${fmtDist(hav(destination.lat,destination.lng,alight.lat,alight.lng))}</span></div>`);
  panel.innerHTML=`<div class="planner-detail-head"><div><strong>${esc(names)}</strong><small>${plannerClock(depart)}~${plannerClock(arrive)} · 약 ${path.minutes}분 · 약 ${fmtDist(path.distance)}</small><small>도보 약 ${fmtDist(path.walk)} · ${path.transfers?'환승 '+path.transfers+'회':'환승 없음'} · ${path.stopCount}정류소${climate?' · 🌱 기후동행카드 가능':''}</small></div><button type="button" aria-label="상세 닫기">×</button></div><div class="planner-detail-timeline ${plannerRouteClass(first.data.route.name)}">${timeline.join('')}</div><h3>실시간 탑승 정보</h3><div class="planner-live-head"><span class="planner-live-stamp">불러오는 중…</span><button type="button" class="planner-live-refresh">🔄 새로고침</button></div><div class="planner-live-detail">실시간 도착정보 확인 중…</div>${path.transfers?'<div class="planner-live warn">실시간 환승 확률 계산 중…</div>':''}<button type="button" class="planner-start-guide">이 경로로 실시간 길찾기 시작</button>`;
  panel.classList.add('open');panel.querySelector('.planner-detail-head button').onclick=plannerCloseDetail;panel.querySelector('.planner-start-guide').onclick=()=>plannerStartTrip(path);
  panel.querySelector('.planner-live-refresh').onclick=()=>{plannerArrivalCache.clear();panel.querySelector('.planner-live-stamp').textContent='새로고침 중…';plannerEnhanceDetail(path);};
  panel.querySelectorAll('.planner-route-choice').forEach(button=>button.onclick=()=>{const leg=path.legs[Number(button.dataset.legIndex)];leg.selectedRouteId=String(leg.selectedRouteId||'')===button.dataset.routeId?'':button.dataset.routeId;plannerDraw(path);plannerOpenDetail(path,index);});
  panel.querySelectorAll('.planner-stops-toggle').forEach(button=>button.onclick=()=>{const list=button.nextElementSibling,open=list.hidden;list.hidden=!open;button.setAttribute('aria-expanded',String(open));button.textContent=open?'전체 정류장 접기':'전체 정류장 펼치기';});
  plannerEnhanceDetail(path);
}
function plannerUpdateNote(){
  if(typeof document==='undefined')return;
  const note=document.getElementById('plannerNote');
  note.setAttribute('role','status');
  if(plannerSearching){note.textContent='버스 경로를 찾고 있습니다…';return;}
  const count=plannerDisplayPaths().length;
  note.textContent=(plannerSearched?`추천 경로 ${count}개 · 불필요한 환승·장거리 도보 제외 · 시간·거리·도보는 추정치`:'버스 노선 순서로 직행·환승 경로를 찾습니다.')+(plannerMapStatus?' · '+plannerMapStatus:'');
}
function plannerRender(){
  const sortBox=document.getElementById('plannerSort');
  sortBox.innerHTML=Object.entries(PLANNER_SORTS).map(([key,label])=>`<button type="button" data-sort="${key}" class="${key===plannerSort?'on':''}">${label}</button>`).join('');
  sortBox.querySelectorAll('button').forEach(btn=>btn.onclick=()=>{plannerSort=btn.dataset.sort;plannerCloseDetail();plannerClearMap();plannerRender();});
  const box=document.getElementById('plannerResults');
  plannerUpdateNote();
  if(!plannerSearched){box.innerHTML='';return;}
  const ranked=plannerDisplayPaths();
  if(!ranked.length){box.innerHTML='<div class="search-empty">찾은 경로가 없습니다. 가까운 다른 정류소를 선택해 보세요.</div>';return;}
  box.innerHTML='';
  ranked.forEach((p,i)=>{
    const el=document.createElement('div');
    el.tabIndex=0;el.role='button';el.className='planner-result'+(i===plannerSelected?' selected':'');
    el.dataset.planIndex=String(i);
    const names=p.legs.map(l=>(l.routeNames||[l.data.route.name]).join(' · ')).join(' → ');
    const climate=p.legs.every(l=>(l.routeOptions||[l]).some(o=>plannerClimateRoute(o.data.route)));
    const depart=plannerDepartureDate(),arrive=new Date(depart.getTime()+p.minutes*60000);
    el.innerHTML=`<strong>${i+1}. ${esc(names)}</strong><small>${plannerClock(depart)}~${plannerClock(arrive)} · 약 ${p.minutes}분 · 약 ${fmtDist(p.distance)}</small><small>도보 약 ${fmtDist(p.walk)} · ${p.transfers?'환승 '+p.transfers+'회':'환승 없음'} · ${p.stopCount}정류소${climate?' · 🌱 기후동행카드':''}</small><span class="planner-card-more">상세 경로 보기 ›</span>`;
    el.setAttribute('aria-pressed',String(i===plannerSelected));
    el.onclick=()=>{plannerClearMap();plannerSelected=i;el.classList.add('selected');el.setAttribute('aria-pressed','true');plannerDraw(p);plannerOpenDetail(p,i);};
    el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();el.click();}};
    box.appendChild(el);
  });
  plannerScheduleLiveRefresh(ranked);
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
  path.legs.forEach((legBase,j)=>{
    const leg=plannerSelectedOption(legBase)||legBase;
    roads.push(Promise.resolve().then(()=>fetchBusRouteGeometry(leg.data.route.id,leg.start,leg.end)).then(roadPts=>{
      if(!roadPts || roadPts.length<2)throw new Error('노선 경로 없음');
      if(plannerLayer===drawToken && plannerDrawRevision===revision)L.polyline(roadPts,{color:['#ff5a36','#4f7de0','#8f65d5','#20a487'][j%4],weight:7,opacity:.9}).addTo(drawToken);
    }));
    const first=STOPS[STOP_BY_NODE.get(String(leg.data.route.nodes[leg.start]))];
    const last=STOPS[STOP_BY_NODE.get(String(leg.data.route.nodes[leg.end]))];
    if(first)L.marker([first.lat,first.lng]).bindPopup(`${j?'환승':'승차'}: ${esc(first.name)} · ${esc(plannerLegNames(legBase).join(' · '))}`).addTo(plannerLayer);
    if(last && j===path.legs.length-1)L.marker([last.lat,last.lng]).bindPopup(`하차: ${esc(last.name)}`).addTo(plannerLayer);
  });
  const firstLeg=plannerSelectedOption(path.legs[0])||path.legs[0],lastBase=path.legs[path.legs.length-1],lastLeg=plannerSelectedOption(lastBase)||lastBase;
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
function plannerUseCurrentLocation(kind,button){
  const note=document.getElementById('plannerNote');
  if(!navigator.geolocation){note.textContent='이 기기에서는 현재 위치를 사용할 수 없습니다.';return;}
  const old=button.textContent;button.disabled=true;button.textContent='확인 중…';
  navigator.geolocation.getCurrentPosition(position=>{
    plannerSetPlace(kind,{name:'내 위치',lat:position.coords.latitude,lng:position.coords.longitude});
    button.disabled=false;button.textContent=old;
    note.textContent=`현재 위치를 ${kind==='from'?'출발지':'도착지'}로 설정했습니다. (정확도 약 ${Math.round(position.coords.accuracy||0)}m)`;
    if(typeof updateGuideMarker==='function')updateGuideMarker(position.coords.latitude,position.coords.longitude);
  },()=>{
    button.disabled=false;button.textContent=old;
    note.textContent='현재 위치를 확인하지 못했습니다. 브라우저 위치 권한을 허용해 주세요.';
  },{enableHighAccuracy:true,maximumAge:5000,timeout:12000});
}
function plannerSwapEndpoints(){
  const fromInput=document.getElementById('plannerFrom'),toInput=document.getElementById('plannerTo');
  [fromInput.value,toInput.value]=[toInput.value,fromInput.value];
  [plannerFromIndex,plannerToIndex]=[plannerToIndex,plannerFromIndex];
  [plannerPlaces.from,plannerPlaces.to]=[plannerPlaces.to,plannerPlaces.from];
  document.getElementById('plannerFromSuggestions').style.display='none';
  document.getElementById('plannerToSuggestions').style.display='none';
  plannerInvalidateSearch();
  document.getElementById('plannerNote').textContent='출발지와 도착지를 바꿨습니다.';
}
async function plannerSearchPlaces(query){
  if(query.trim().length<2)return [];
  const queries=[query,`${query} 서울특별시`];
  if(/역$/.test(query))queries.push(`${query.replace(/역$/,'')}역 서울`);
  const found=[];
  // Photon은 한국어 역·건물명 검색 결과를 안정적으로 돌려준다. 기존
  // Nominatim은 일부 모바일 회선에서 403이 발생하므로 보조 검색으로 둔다.
  try{
    const photon='https://photon.komoot.io/api/?limit=8&q='+encodeURIComponent(`${query} 서울`);
    const response=await fetch(photon,{headers:{Accept:'application/json'}});
    if(response.ok){
      const data=await response.json();
      for(const feature of (data.features||[])){
        const p=feature.properties||{},coords=feature.geometry?.coordinates||[];
        const place={name:[p.name,p.street,p.district,p.city].filter(Boolean).filter((x,i,a)=>a.indexOf(x)===i).join(', ')||query,lat:Number(coords[1]),lng:Number(coords[0])};
        if(Number.isFinite(place.lat)&&Number.isFinite(place.lng)&&!found.some(y=>hav(y.lat,y.lng,place.lat,place.lng)<15))found.push(place);
      }
    }
  }catch(e){}
  if(found.length>=6)return found.slice(0,8);
  for(const q of [...new Set(queries)]){
    const url='https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=kr&accept-language=ko&limit=8&viewbox=126.72,37.70,127.20,37.40&bounded=0&q='+encodeURIComponent(q);
    const response=await fetch(url,{headers:{Accept:'application/json'}});if(!response.ok)continue;
    const data=await response.json();
    for(const x of data){const place={name:String(x.display_name||query),lat:Number(x.lat),lng:Number(x.lon)};if(Number.isFinite(place.lat)&&Number.isFinite(place.lng)&&!found.some(y=>hav(y.lat,y.lng,place.lat,place.lng)<15))found.push(place);}
    if(found.length>=6)break;
  }
  return found.slice(0,8);
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
function plannerVehicleNumber(value){
  const text=String(value||'').trim(),match=text.match(/(\d{4})\s*$/);
  return match?`${match[1]}호`:text;
}
function plannerTripNotify(trip,key,text,pattern){
  if(!trip||trip.alerts.has(key))return;
  trip.alerts.add(key);
  try{if(navigator.vibrate)navigator.vibrate(pattern||[180,80,180]);}catch(e){}
  try{
    const utterance=new SpeechSynthesisUtterance(text);
    utterance.lang='ko-KR';utterance.rate=1;utterance.volume=1;
    window.speechSynthesis.speak(utterance);
  }catch(e){}
}
function plannerTripProgress(trip,leg,lat,lng,vehicle){
  let closest=leg.start,best=Infinity;
  const reportedNode=String(vehicle?.lastStnId||'');
  if(reportedNode){
    const matches=[];
    for(let i=leg.start;i<=leg.end;i++)if(String(leg.data.route.nodes[i])===reportedNode)matches.push(i);
    if(matches.length){
      const prior=Number.isFinite(trip.progressByLeg[trip.legIndex])?trip.progressByLeg[trip.legIndex]:leg.start;
      closest=matches.reduce((a,b)=>Math.abs(b-prior)<Math.abs(a-prior)?b:a);
      best=0;
    }
  }
  for(let i=leg.start;best!==0&&i<=leg.end;i++){
    const stop=STOPS[STOP_BY_NODE.get(String(leg.data.route.nodes[i]))];
    if(!stop)continue;
    const distance=hav(lat,lng,stop.lat,stop.lng);
    if(distance<best){best=distance;closest=i;}
  }
  const previous=trip.progressByLeg[trip.legIndex];
  if(Number.isFinite(previous))closest=Math.max(previous,closest);
  closest=Math.max(leg.start,Math.min(leg.end,closest));
  trip.progressByLeg[trip.legIndex]=closest;
  const current=STOPS[STOP_BY_NODE.get(String(leg.data.route.nodes[closest]))];
  const nextIndex=Math.min(leg.end,closest+1);
  const next=STOPS[STOP_BY_NODE.get(String(leg.data.route.nodes[nextIndex]))];
  return {index:closest,current,next,remaining:Math.max(0,leg.end-closest),distance:best};
}
function plannerTripTarget(trip){
  const base=trip.path.legs[trip.legIndex],leg=plannerSelectedOption(base)||base,node=trip.phase==='riding'?leg.data.route.nodes[leg.end]:leg.data.route.nodes[leg.start];
  return STOPS[STOP_BY_NODE.get(String(node))];
}
// ---- live trip guidance -------------------------------------------------
// Boarding is recognized three ways, because real-time bus positions lag by
// tens of seconds: (1) a bus of the leg stays near the rider while both move,
// (2) the rider leaves the boarding stop along the route at bus speed, or
// (3) the rider presses "탔어요" / enters the vehicle number.
function plannerTripVehicleSnap(v){return {vehId:String(v?.vehId||''),plate:String(v?.plainNo||'').trim(),lat:Number(v?.gpsY),lng:Number(v?.gpsX),lastStnId:v?.lastStnId,nextStId:v?.nextStId,sectOrd:v?.sectOrd};}
function plannerTripBoard(trip,routeName,routeId,vehicle,how){
  trip.phase='riding';trip.lastVehicleFetch=Date.now();trip.boardingCandidate=null;trip.lastChance=0;
  trip.currentBus={route:routeName,routeId,...plannerTripVehicleSnap(vehicle)};
  delete trip.progressByLeg[trip.legIndex];  // indices belong to the boarded route's stop list
  const number=plannerVehicleNumber(trip.currentBus.plate);
  plannerTripNotify(trip,`board-${trip.legIndex}`,`${routeName}번${number?' '+number+' 차량에':' 버스에'} 탑승했습니다.`,[180,80,180]);
  trip.boardedHow=how;
}
async function plannerTripVehicles(trip,legBase){
  // positions for every bus option of the leg (most legs have 1-3 routes)
  const out=[];
  for(const o of (legBase.routeOptions||[legBase]).slice(0,3)){
    try{(await fetchBusPositions(o.data.route.id)).forEach(v=>{if(Number.isFinite(Number(v.gpsY))&&Number.isFinite(Number(v.gpsX)))out.push({v,route:o.data.route.name,routeId:o.data.route.id});});}catch(e){}
  }
  return out;
}
function plannerTripSpeed(trip,seconds){
  const now=Date.now(),old=trip.track.find(p=>now-p.t<=seconds*1000);
  if(!old||now-old.t<5000)return 0;
  return hav(old.lat,old.lng,trip.lat,trip.lng)/((now-old.t)/1000);
}
async function plannerTripManualBoard(plateDigits){
  const trip=plannerActiveTrip;if(!trip)return;
  const legBase=trip.path.legs[trip.legIndex],list=await plannerTripVehicles(trip,legBase);
  let hit=null;
  if(plateDigits){
    hit=list.find(x=>String(x.v.plainNo||'').replace(/\s/g,'').endsWith(plateDigits));
    if(!hit){plannerTripRender(trip,`${plateDigits} 차량을 이 구간 노선의 실시간 위치에서 찾지 못했습니다. 번호를 확인해 주세요.`);return;}
  }else if(Number.isFinite(trip.lat)){
    hit=list.map(x=>({...x,d:hav(trip.lat,trip.lng,Number(x.v.gpsY),Number(x.v.gpsX))})).sort((a,b)=>a.d-b.d)[0]||null;
  }
  const chosen=trip.liveChoice,option=plannerLegOption(legBase,chosen?.route||plannerLegNames(legBase)[0]);
  plannerTripBoard(trip,hit?.route||option.data.route.name,hit?.routeId||option.data.route.id,hit?.v||null,plateDigits?'number':'button');
  plannerUpdateTrip();
}
function plannerTripUnboard(){
  const trip=plannerActiveTrip;if(!trip)return;
  trip.phase='waiting';trip.currentBus=null;trip.alerts.delete(`board-${trip.legIndex}`);trip.lastLive=0;plannerUpdateTrip();
}
function plannerTripRender(trip,extra){
  const box=document.getElementById('plannerNav');if(!box||!trip)return;
  box.hidden=false;
  const v=trip.view||{},buttons=[];
  if(trip.phase==='waiting'||trip.phase==='walk')buttons.push('<button type="button" data-act="board">🚌 탔어요</button><input type="text" inputmode="numeric" maxlength="4" placeholder="차량번호 4자리" class="planner-nav-plate"><button type="button" data-act="plate">번호로 설정</button>');
  if(trip.phase==='riding')buttons.push('<button type="button" data-act="unboard">아직 안 탔어요</button>');
  const veh=v.choiceNav?`<span class="planner-veh-nav">${v.choiceNav}</span>`:'';
  box.innerHTML=`<strong>${trip.phase==='done'?'도착':'실시간 길찾기'} · ${esc(v.text||'')}</strong><small>${v.live||'현재 위치와 버스 위치로 탑승·하차를 자동 확인합니다.'}${veh}</small>${extra?`<small class="planner-nav-warn">${esc(extra)}</small>`:''}<small class="planner-nav-stamp">${esc(v.stamp||'')}</small><div class="planner-nav-actions">${buttons.join('')}<button type="button" data-act="refresh" title="지금 새로고침">🔄</button><button type="button" class="planner-nav-stop" data-act="stop">종료</button></div>`;
  box.querySelectorAll('[data-act]').forEach(b=>b.onclick=()=>{
    const act=b.dataset.act;
    if(act==='stop')plannerStopTrip();
    else if(act==='refresh'){plannerArrivalCache.clear();trip.lastLive=0;trip.lastVehicleFetch=0;trip.lastChance=0;plannerUpdateTrip();}
    else if(act==='board')plannerTripManualBoard('');
    else if(act==='plate'){const d=(box.querySelector('.planner-nav-plate').value||'').replace(/\D/g,'');if(d.length>=3)plannerTripManualBoard(d);else plannerTripRender(trip,'차량번호 끝 4자리를 넣어 주세요.');}
    else if(act==='unboard')plannerTripUnboard();
  });
  box.querySelectorAll('.planner-veh-nav button').forEach(b=>b.onclick=()=>{
    const i=Number(b.dataset.leg),step=Number(b.dataset.step);
    trip.offsets[i]=step?(trip.offsets[i]||0)+step:0;trip.lastLive=0;trip.lastChance=0;plannerUpdateTrip();
  });
}
function plannerTripChoiceNav(trip,legIndex,cands,idx){
  if(cands.length<2)return '';
  const off=trip.offsets[legIndex]||0;
  return `<button type="button" data-leg="${legIndex}" data-step="-1" ${idx<=0?'disabled':''}>◀ 전차</button><button type="button" data-leg="${legIndex}" data-step="1" ${idx>=cands.length-1?'disabled':''}>다음차 ▶</button>${off?`<button type="button" data-leg="${legIndex}" data-step="0">자동</button>`:''}`;
}
function plannerPick(cands,minSec,offset){
  let auto=cands.findIndex(c=>c.sec>=minSec);if(auto<0)auto=cands.length;
  const idx=cands.length?Math.max(0,Math.min(cands.length-1,auto+(offset||0))):-1;
  return {idx,auto,cand:idx>=0&&(auto<cands.length||offset<0)?cands[idx]:null};
}
async function plannerUpdateTrip(position){
  const trip=plannerActiveTrip;if(!trip)return;
  if(position){
    trip.lat=position.coords.latitude;trip.lng=position.coords.longitude;
    trip.track.push({t:Date.now(),lat:trip.lat,lng:trip.lng});trip.track=trip.track.filter(p=>Date.now()-p.t<120000);
    if(typeof updateGuideMarker==='function')updateGuideMarker(trip.lat,trip.lng);
  }
  if(!Number.isFinite(trip.lat)||!Number.isFinite(trip.lng)||trip.busy)return;
  trip.busy=true;
  try{
    // once on a bus, follow that route's own stop list (571 and 674 share a leg but not its stops)
    const legFor=b=>trip.currentBus?plannerLegOption(b,trip.currentBus.route):(plannerSelectedOption(b)||b);
    let legBase=trip.path.legs[trip.legIndex],leg=legFor(legBase);
    let board=STOPS[STOP_BY_NODE.get(String(leg.data.route.nodes[leg.start]))],alight=STOPS[STOP_BY_NODE.get(String(leg.data.route.nodes[leg.end]))];
    const names=plannerLegNames(legBase),toBoard=hav(trip.lat,trip.lng,board.lat,board.lng);
    const view=trip.view;
    if(trip.phase==='walk'&&toBoard<=80){trip.phase='waiting';trip.lastLive=0;}
    // --- before boarding: which bus to take, and is the rider already on it?
    if((trip.phase==='waiting'||trip.phase==='walk')&&Date.now()-(trip.lastLive||0)>8000){
      trip.lastLive=Date.now();
      try{
        const items=await plannerArrivalsAt(leg.data.route.nodes[leg.start]),cands=plannerArrivalCandidates(items,names);
        const reachLeft=trip.reachAt?(trip.reachAt-Date.now())/1000:0,walkSec=trip.phase==='walk'?toBoard/1.2:0;
        const pick=plannerPick(cands,Math.max(0,reachLeft-30,walkSec-20),trip.offsets[trip.legIndex]);
        trip.liveChoice=pick.cand;
        view.live=pick.cand?`탈 차량: ${plannerCandText(pick.cand)}${(trip.offsets[trip.legIndex]||0)?' <small>(직접 선택)</small>':''}`:'탈 수 있는 차량 정보를 기다리는 중';
        view.choiceNav=plannerTripChoiceNav(trip,trip.legIndex,cands,pick.idx);
      }catch(e){view.live='도착정보를 잠시 불러오지 못했습니다.';}
      if(trip.phase==='waiting'){
        const list=await plannerTripVehicles(trip,legBase);
        const near=list.map(x=>({...x,d:hav(trip.lat,trip.lng,Number(x.v.gpsY),Number(x.v.gpsX))})).sort((a,b)=>a.d-b.d);
        // (1) a bus within 150 m (positions lag) moving together with the rider, within 60 s
        const close=near[0]&&near[0].d<150?near[0]:null;
        if(close){
          const key=String(close.v.vehId||close.v.plainNo||''),prev=trip.boardingCandidate;
          const same=prev&&prev.key===key&&Date.now()-prev.at<60000;
          if(!same)trip.boardingCandidate={key,at:Date.now(),userLat:trip.lat,userLng:trip.lng,busLat:Number(close.v.gpsY),busLng:Number(close.v.gpsX)};
          else if(hav(prev.userLat,prev.userLng,trip.lat,trip.lng)>=30&&hav(prev.busLat,prev.busLng,Number(close.v.gpsY),Number(close.v.gpsX))>=30)plannerTripBoard(trip,close.route,close.routeId,close.v,'auto');
          else view.live+=' · 차량과 함께 이동하는지 확인 중';
        }
        // (2) left the boarding stop along the route faster than walking
        if(trip.phase==='waiting'&&toBoard>100&&plannerTripSpeed(trip,40)>3.5){
          // near a later stop of any bus that serves this leg
          let along=null;
          for(const o of (legBase.routeOptions||[legBase])){
            for(let i=o.start+1;i<=o.end&&!along;i++){const st=STOPS[STOP_BY_NODE.get(String(o.data.route.nodes[i]))];if(st&&hav(trip.lat,trip.lng,st.lat,st.lng)<250)along=o;}
            if(along)break;
          }
          const startedNear=trip.track.some(p=>hav(p.lat,p.lng,board.lat,board.lng)<=120);
          if(along!=null&&startedNear){
            const v=near[0]&&near[0].d<400?near[0]:null,option=v?plannerLegOption(legBase,v.route):along;
            plannerTripBoard(trip,option.data.route.name,option.data.route.id,v?.v||null,'moving');
          }
        }
      }
    }
    // --- riding: follow the bus, warn before alighting, keep the transfer bus current
    let progress=null;
    if(trip.phase==='riding'){
      leg=legFor(legBase);alight=STOPS[STOP_BY_NODE.get(String(leg.data.route.nodes[leg.end]))];
      if(Date.now()-(trip.lastVehicleFetch||0)>8000&&trip.currentBus?.routeId){
        trip.lastVehicleFetch=Date.now();
        try{
          const vehicles=await fetchBusPositions(trip.currentBus.routeId);
          let vehicle=vehicles.find(v=>(trip.currentBus.vehId&&String(v.vehId)===trip.currentBus.vehId)||(trip.currentBus.plate&&String(v.plainNo).trim()===trip.currentBus.plate));
          if(!vehicle&&!trip.currentBus.plate){const n=vehicles.map(v=>({v,d:hav(trip.lat,trip.lng,Number(v.gpsY),Number(v.gpsX))})).sort((a,b)=>a.d-b.d)[0];if(n&&n.d<200)vehicle=n.v;}
          if(vehicle)Object.assign(trip.currentBus,plannerTripVehicleSnap(vehicle));
        }catch(e){}
      }
      const pl=Number.isFinite(trip.currentBus?.lat)?trip.currentBus.lat:trip.lat,pg=Number.isFinite(trip.currentBus?.lng)?trip.currentBus.lng:trip.lng;
      progress=plannerTripProgress(trip,leg,pl,pg,trip.currentBus);
      if(progress.remaining===1)plannerTripNotify(trip,`alight-${trip.legIndex}`,`다음 정류장은 ${alight.name}입니다. 이번 정류장에서 내리세요.`,[250,100,250,100,500]);
      const nextBase=trip.path.legs[trip.legIndex+1];
      view.live='';view.choiceNav='';
      if(nextBase&&Date.now()-(trip.lastChance||0)>15000){
        trip.lastChance=Date.now();
        try{
          let reach=null;
          if(trip.currentBus?.plate){
            const items=await plannerArrivalsAt(leg.data.route.nodes[leg.end]);
            const hit=plannerArrivalCandidates(items,[trip.currentBus.route]).find(c=>plannerPlateOf(c)===trip.currentBus.plate);
            if(hit)reach={sec:hit.sec+60,exact:true};
          }
          if(!reach)reach={sec:progress.remaining*80+60,exact:false};
          trip.reachAt=Date.now()+reach.sec*1000;
          const nl=plannerSelectedOption(nextBase)||nextBase,items=await plannerArrivalsAt(nl.data.route.nodes[nl.start]),cands=plannerArrivalCandidates(items,plannerLegNames(nextBase));
          const pick=plannerPick(cands,reach.sec-30,trip.offsets[trip.legIndex+1]),plate=plannerPlateOf(pick.cand);
          // The bus we were going to catch can no longer be reached (traffic, signals): switch and tell the rider.
          if(pick.cand&&trip.transferPlate&&plate&&plate!==trip.transferPlate&&!(trip.offsets[trip.legIndex+1]||0)){
            trip.alerts.delete('transfer-change');
            plannerTripNotify(trip,'transfer-change',`환승할 ${pick.cand.route}번은 다음 차로 바뀌었습니다. ${Math.ceil(pick.cand.sec/60)}분 후 도착합니다.`,[120,60,120]);
          }
          if(plate)trip.transferPlate=plate;
          let chanceText='';
          if(pick.cand){const buffer=pick.cand.sec-reach.sec,prob=Math.max(3,Math.min(98,Math.round(100/(1+Math.exp(-(buffer-60)/120)))));chanceText=` · 성공 추정 ${prob}%${reach.exact?'':' (도착시각 추정)'}`;}
          trip.transferView=pick.cand?`환승 ${plannerCandText(pick.cand)}${chanceText}`:'환승할 차량 정보를 기다리는 중';
          trip.transferNav=plannerTripChoiceNav(trip,trip.legIndex+1,cands,pick.idx);
        }catch(e){}
      }
      if(nextBase){view.live=trip.transferView||'';view.choiceNav=trip.transferNav||'';}
    }
    if(trip.phase==='riding'&&progress&&((hav(trip.lat,trip.lng,alight.lat,alight.lng)<=150&&progress.remaining<=1)||progress.remaining===0)){
      if(trip.legIndex<trip.path.legs.length-1){trip.legIndex++;trip.phase='waiting';trip.lastLive=0;trip.currentBus=null;trip.boardingCandidate=null;trip.transferPlate=null;}
      else{trip.phase='finalwalk';trip.currentBus=null;}
    }
    const destination=trip.path.toPlace||STOPS[trip.path.toIndex];
    if(trip.phase==='finalwalk'&&destination&&hav(trip.lat,trip.lng,destination.lat,destination.lng)<=45)trip.phase='done';
    legBase=trip.path.legs[trip.legIndex];leg=legFor(legBase);board=STOPS[STOP_BY_NODE.get(String(leg.data.route.nodes[leg.start]))];alight=STOPS[STOP_BY_NODE.get(String(leg.data.route.nodes[leg.end]))];
    const routeNames=plannerLegNames(legBase),vehicleNumber=plannerVehicleNumber(trip.currentBus?.plate);
    const ridingDetail=progress?(progress.remaining===1?`이번 정류장에서 내리세요 · 하차 ${alight.name}`:`${progress.current?.name||'현재 정류장'} → ${progress.next?.name||alight.name} · 하차까지 ${progress.remaining}정류소`):`${alight.name}에서 내리세요`;
    view.text=trip.phase==='walk'?`${board.name}까지 ${fmtDist(hav(trip.lat,trip.lng,board.lat,board.lng))} 걸어가서 ${routeNames.join(' · ')}번`:
      trip.phase==='waiting'?`${board.name}에서 ${routeNames.join(' · ')}번을 타세요`:
      trip.phase==='riding'?`${trip.currentBus?.route||routeNames[0]}번${vehicleNumber?' · '+vehicleNumber:''} 탑승 중 · ${ridingDetail}`:
      trip.phase==='finalwalk'?`하차 후 ${destination?.name||'목적지'}까지 걸어가세요`:'목적지에 도착했습니다';
    const now=new Date();view.stamp=`${plannerClock(now)}:${String(now.getSeconds()).padStart(2,'0')} 갱신`;
    plannerTripRender(trip);
    if(trip.phase==='done'&&!trip.doneNotified){trip.doneNotified=true;if(navigator.vibrate)navigator.vibrate([150,80,150]);}
  }finally{trip.busy=false;}
}
function plannerStartTrip(path){
  plannerStopTrip();
  plannerActiveTrip={path,legIndex:0,phase:'walk',lastLive:0,alerts:new Set(),progressByLeg:{},currentBus:null,boardingCandidate:null,lastVehicleFetch:0,offsets:{...(path.liveOffset||{})},track:[],view:{}};
  const box=document.getElementById('plannerNav');box.hidden=false;
  box.innerHTML='<strong>현재 위치 확인 중…</strong><small>위치 권한을 허용해 주세요.</small>';
  if(!navigator.geolocation){box.innerHTML='<strong>이 기기에서는 위치를 사용할 수 없습니다.</strong>';return;}
  plannerTripWatch=navigator.geolocation.watchPosition(plannerUpdateTrip,()=>{const b=document.getElementById('plannerNav');b.hidden=false;b.innerHTML='<strong>현재 위치를 확인하지 못했습니다.</strong><small>브라우저 위치 권한을 확인해 주세요.</small><button type="button" class="planner-nav-stop">길찾기 종료</button>';b.querySelector('button').onclick=plannerStopTrip;},{enableHighAccuracy:true,maximumAge:3000,timeout:12000});
  plannerTripTimer=setInterval(()=>plannerUpdateTrip(),8000);
}

if(typeof document!=='undefined'){
  // The trip banner must stay visible after the planner panel is closed.
  const tripNav=document.getElementById('plannerNav'),mapWrap=document.getElementById('mapWrap');
  if(tripNav&&mapWrap)mapWrap.appendChild(tripNav);
  plannerInitField('from');plannerInitField('via');plannerInitField('to');
  const departure=document.getElementById('plannerDeparture');
  const now=new Date(Date.now()-new Date().getTimezoneOffset()*60000);departure.value=now.toISOString().slice(0,16);
  // night buses depend on the departure time, so search again when it changes
  departure.addEventListener('change',()=>{if(plannerSearched)document.getElementById('plannerSearch').click();});
  document.querySelectorAll('.planner-map-pick').forEach(btn=>btn.onclick=()=>{
    plannerPickKind=btn.dataset.kind;
    document.getElementById('plannerPanel').classList.remove('open');
    document.getElementById('status').textContent=`지도에서 ${plannerPickKind==='from'?'출발':'도착'} 위치를 눌러 주세요.`;
  });
  document.querySelectorAll('.planner-current-location').forEach(btn=>btn.onclick=()=>plannerUseCurrentLocation(btn.dataset.kind,btn));
  document.getElementById('plannerSwap').onclick=plannerSwapEndpoints;
  if(typeof map!=='undefined')map.on('click',e=>{
    if(!plannerPickKind)return;
    const kind=plannerPickKind;plannerPickKind=null;
    plannerSetPlace(kind,{name:`지도 선택 위치 (${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)})`,lat:e.latlng.lat,lng:e.latlng.lng});
    document.getElementById('plannerPanel').classList.add('open');
    document.getElementById('status').textContent='지도 위치가 길찾기에 설정되었습니다.';
  });
  document.getElementById('plannerClimateOnly').addEventListener('change',plannerInvalidateSearch);
  document.getElementById('plannerBtn').onclick=()=>document.getElementById('plannerPanel').classList.add('open');
  document.getElementById('plannerClose').onclick=()=>{document.getElementById('plannerPanel').classList.remove('open');plannerCloseDetail();};
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
      const found=plannerViaIndex==null?
        plannerFindPaths(plannerFromIndex,plannerToIndex):
        plannerFindViaPaths(plannerFromIndex,plannerViaIndex,plannerToIndex);
      plannerMapStatus='운행 중인 버스 확인 중…';plannerUpdateNote();
      const running=await plannerOperatingFilter(found);
      if(revision!==plannerSearchRevision)return;
      plannerPaths=running;
      plannerMapStatus=running.length<found.length?'운행하지 않는 버스는 뺐습니다':'';
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
