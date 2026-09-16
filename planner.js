// Bus trip planner based on the stop order embedded in index.html.
const PLANNER_SORTS={optimal:'최적',time:'최소시간',distance:'최단거리',walk:'최소도보',detour:'우회 경로'};
const plannerRouteCache=new Map();
const plannerRoutesById=new Map(ROUTES.map(r=>[r.id,r]));
let plannerPaths=[],plannerSort='optimal',plannerLayer=null,plannerSelected=-1,plannerSearched=false;
let plannerFromIndex=null,plannerViaIndex=null,plannerToIndex=null;

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

function plannerFindPaths(fromIndex,toIndex){
  if(fromIndex===toIndex)return [];
  const starts=plannerNearby(fromIndex),ends=plannerNearby(toIndex),candidates=[];
  const straight=hav(STOPS[fromIndex].lat,STOPS[fromIndex].lng,STOPS[toIndex].lat,STOPS[toIndex].lng);
  const maxBusDist=Math.max(3500,straight*3.5+2500);
  const seen=new Set();
  const add=(a,b,walk,transfer)=>{
    if(candidates.length>=8000)return;
    const legs=transfer?[a,b]:[a];
    const busDist=legs.reduce((sum,l)=>sum+l.data.prefix[l.end]-l.data.prefix[l.start],0);
    const stopCount=legs.reduce((sum,l)=>sum+l.end-l.start,0);
    if(busDist>maxBusDist || stopCount>170 || stopCount<1)return;
    const key=legs.map(l=>`${l.data.route.id}:${l.start}-${l.end}`).join('|');
    if(seen.has(key))return;
    seen.add(key);
    const transfers=legs.length-1;
    const distance=busDist*1.25+walk;
    const minutes=Math.round(distance/1000/22*60+stopCount*.28+walk/1000/4.5*60+legs.length*5+transfers*4);
    candidates.push({legs,walk,distance,minutes,transfers,stopCount});
  };
  for(const start of starts){
    const s=STOPS[start.index];
    for(const sr of s.routes){
      const aRoute=plannerRoutesById.get(sr.id);
      if(!aRoute)continue;
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
      if(!routeA)continue;
      const a=plannerRouteData(routeA);
      for(const p of a.positions.get(s.node)||[]){
        const limit=Math.min(a.route.nodes.length-1,p+100);
        for(let x=p+1;x<=limit;x++){
          const node=a.route.nodes[x],mid=STOPS[STOP_BY_NODE.get(String(node))];
          if(!mid || !mid.routes?.length)continue;
          for(const mr of mid.routes){
            if(mr.id===a.route.id)continue;
            const routeB=plannerRoutesById.get(mr.id);
            if(!routeB)continue;
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
  return candidates;
}

function plannerRank(paths,sort){
  const score=p=>sort==='time'?p.minutes:
    sort==='distance'?p.distance:
    sort==='walk'?p.walk*10+p.minutes*20+p.transfers*1000:
    sort==='detour'?-p.distance+p.transfers*1500:
    p.minutes*100+p.walk*.16+p.transfers*500;
  return paths.slice().sort((a,b)=>score(a)-score(b));
}

function plannerFindViaPaths(from,via,to){
  const first=plannerFindPaths(from,via),second=plannerFindPaths(via,to);
  const pick=paths=>{
    const best=plannerRank(paths,'optimal').slice(0,20);
    const long=plannerRank(paths,'detour').slice(0,12);
    return [...new Set([...best,...long])];
  };
  const result=[];
  for(const a of pick(first))for(const b of pick(second)){
    const legs=[...a.legs,...b.legs],transfers=legs.length-1;
    result.push({legs,walk:a.walk+b.walk,distance:a.distance+b.distance,
      minutes:a.minutes+b.minutes+4,transfers,stopCount:a.stopCount+b.stopCount});
  }
  return result;
}

function plannerStopName(node){return STOPS[STOP_BY_NODE.get(String(node))]?.name||'정류소';}
function plannerRender(){
  const sortBox=document.getElementById('plannerSort');
  sortBox.innerHTML=Object.entries(PLANNER_SORTS).map(([key,label])=>`<button type="button" data-sort="${key}" class="${key===plannerSort?'on':''}">${label}</button>`).join('');
  sortBox.querySelectorAll('button').forEach(btn=>btn.onclick=()=>{plannerSort=btn.dataset.sort;plannerSelected=-1;plannerRender();});
  const box=document.getElementById('plannerResults');
  if(!plannerSearched){box.innerHTML='';return;}
  const ranked=plannerRank(plannerPaths,plannerSort).slice(0,30);
  if(!ranked.length){box.innerHTML='<div class="search-empty">찾은 경로가 없습니다. 가까운 다른 정류소를 선택해 보세요.</div>';return;}
  box.innerHTML='';
  ranked.forEach((p,i)=>{
    const el=document.createElement('button');
    el.type='button';el.className='planner-result'+(i===plannerSelected?' selected':'');
    const names=p.legs.map(l=>l.data.route.name).join(' → ');
    const steps=p.legs.map((l,j)=>`${esc(l.data.route.name)}: ${esc(plannerStopName(l.data.route.nodes[l.start]))} → ${esc(plannerStopName(l.data.route.nodes[l.end]))}`).join('<br>');
    el.innerHTML=`<strong>${i+1}. ${esc(names)}</strong><small>약 ${p.minutes}분 · 약 ${fmtDist(p.distance)} · 도보 ${fmtDist(p.walk)} · 환승 ${p.transfers}회 · ${p.stopCount}정류소</small><small>${steps}</small>`;
    el.onclick=()=>{plannerSelected=i;plannerDraw(p);plannerRender();};
    box.appendChild(el);
  });
}

function plannerDraw(path){
  if(plannerLayer)map.removeLayer(plannerLayer);
  plannerLayer=L.featureGroup().addTo(map);
  path.legs.forEach((leg,j)=>{
    const pts=leg.data.route.nodes.slice(leg.start,leg.end+1).map(n=>STOPS[STOP_BY_NODE.get(String(n))]).filter(Boolean).map(s=>[s.lat,s.lng]);
    if(pts.length>1)L.polyline(pts,{color:j?'#4f7de0':'#ff5a36',weight:7,opacity:.9}).addTo(plannerLayer);
    const first=STOPS[STOP_BY_NODE.get(String(leg.data.route.nodes[leg.start]))];
    const last=STOPS[STOP_BY_NODE.get(String(leg.data.route.nodes[leg.end]))];
    if(first)L.marker([first.lat,first.lng]).bindPopup(`${j?'환승':'승차'}: ${esc(first.name)} · ${esc(leg.data.route.name)}`).addTo(plannerLayer);
    if(last)L.marker([last.lat,last.lng]).bindPopup(`${j===path.legs.length-1?'하차':'환승'}: ${esc(last.name)}`).addTo(plannerLayer);
  });
  const bounds=plannerLayer.getBounds?.();
  if(bounds?.isValid())map.fitBounds(bounds,{padding:[45,45]});
}

function plannerSetStop(kind,index){
  const s=STOPS[index];
  if(kind==='from')plannerFromIndex=index;
  else if(kind==='via')plannerViaIndex=index;
  else plannerToIndex=index;
  const id=kind==='from'?'plannerFrom':kind==='via'?'plannerVia':'plannerTo';
  document.getElementById(id).value=`${s.name} (${s.ars})`;
  document.getElementById(id+'Suggestions').style.display='none';
}
function plannerInitField(kind){
  const id=kind==='from'?'plannerFrom':kind==='via'?'plannerVia':'plannerTo';
  const input=document.getElementById(id);
  const box=document.getElementById(id+'Suggestions');
  input.addEventListener('input',()=>{
    if(kind==='from')plannerFromIndex=null;
    else if(kind==='via')plannerViaIndex=null;
    else plannerToIndex=null;
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
  document.getElementById('plannerBtn').onclick=()=>document.getElementById('plannerPanel').classList.add('open');
  document.getElementById('plannerClose').onclick=()=>document.getElementById('plannerPanel').classList.remove('open');
  document.getElementById('plannerSearch').onclick=()=>{
    const note=document.getElementById('plannerNote');
    if(plannerFromIndex==null || plannerToIndex==null){note.textContent='출발·도착 정류소를 검색 결과에서 선택해 주세요.';return;}
    if(document.getElementById('plannerVia').value.trim() && plannerViaIndex==null){
      note.textContent='경유 정류소를 검색 결과에서 선택하거나 입력을 비워 주세요.';return;
    }
    plannerPaths=plannerViaIndex==null?
      plannerFindPaths(plannerFromIndex,plannerToIndex):
      plannerFindViaPaths(plannerFromIndex,plannerViaIndex,plannerToIndex);
    plannerSearched=true;
    plannerSelected=-1;
    note.textContent=`경로 ${plannerPaths.length}개 탐색 · 시간/거리는 정류소 간 거리와 평균 속도로 추정 · ${plannerViaIndex==null?'최대 1회':'경유 시 최대 3회'} 환승`;
    plannerRender();
  };
  plannerRender();
}
