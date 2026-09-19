// Geometry published by Seoul TOPIS, not a route guessed by a car navigator.
const busGeometryCache=new Map();

function busShapeFor(routeId){
  const points=typeof BUS_ROUTE_SHAPES==='undefined'?null:BUS_ROUTE_SHAPES[String(routeId)];
  if(!points || points.length<2)throw new Error('이 노선의 서울시 도로 경로 자료가 없습니다.');
  return points;
}

function busGeometryData(routeId){
  routeId=String(routeId);
  if(busGeometryCache.has(routeId))return busGeometryCache.get(routeId);
  const route=ROUTES.find(r=>String(r.id)===routeId),points=busShapeFor(routeId);
  if(!route)throw new Error('노선을 찾을 수 없습니다.');
  const stops=[];
  route.nodes.forEach((node,order)=>{
    const stop=STOPS[STOP_BY_NODE.get(String(node))];
    if(stop)stops.push({stop,order});
  });
  if(!stops.length)throw new Error('정류소 순서 자료가 없습니다.');
  // Match the complete stop sequence monotonically to the official path.
  // Global alignment distinguishes outbound/return visits to the same stop;
  // an independent nearest-point lookup would often choose the wrong visit.
  const m=points.length,back=[],cos=Math.cos(stops[0].stop.lat*Math.PI/180);
  let previous=new Float64Array(m);
  for(let i=0;i<stops.length;i++){
    const next=new Float64Array(m),parents=new Int32Array(m),s=stops[i].stop;
    let best=Infinity,bestIndex=0;
    for(let j=0;j<m;j++){
      if(previous[j]<best){best=previous[j];bestIndex=j;}
      const dx=(points[j][1]-s.lng)*111320*cos,dy=(points[j][0]-s.lat)*111320;
      next[j]=best+dx*dx+dy*dy;
      parents[j]=bestIndex;
    }
    back.push(parents);previous=next;
  }
  let end=0;
  for(let j=1;j<m;j++)if(previous[j]<previous[end])end=j;
  const anchors=new Array(route.nodes.length).fill(null),errors=new Array(route.nodes.length).fill(Infinity);
  for(let i=stops.length-1;i>=0;i--){
    const {stop,order}=stops[i];
    anchors[order]=end;
    errors[order]=hav(stop.lat,stop.lng,points[end][0],points[end][1]);
    end=back[i][end];
  }
  const arc=[0];
  for(let i=1;i<m;i++)arc.push(arc[i-1]+hav(...points[i-1],...points[i]));
  const value={route,points,anchors,errors,arc};
  busGeometryCache.set(routeId,value);
  return value;
}

function busGeometrySegment(routeId,start,end){
  const g=busGeometryData(routeId);
  if(!Number.isInteger(start)||!Number.isInteger(end)||end<=start||start<0||end>=g.route.nodes.length)
    throw new Error('정류소 구간이 올바르지 않습니다.');
  const a=g.anchors[start],b=g.anchors[end];
  // A via stop may lie inside a continuous ride after its legs are merged.
  // Validate every required stop, not just the boarding/alighting endpoints.
  for(let i=start;i<=end;i++){
    if(g.anchors[i]==null || !Number.isFinite(g.errors[i]) || g.errors[i]>250)
      throw new Error('정류소와 서울시 도로 경로가 일치하지 않아 구간을 표시할 수 없습니다.');
  }
  if(b<=a)
    throw new Error('정류소와 서울시 도로 경로가 일치하지 않아 구간을 표시할 수 없습니다.');
  return {g,a,b};
}

async function fetchBusRouteGeometry(routeId,start,end){
  const routeMeta=ROUTES.find(r=>String(r.id)===String(routeId));
  if(routeMeta?.region==='gyeonggi'){
    const pts=routeMeta.nodes.map(node=>STOPS[STOP_BY_NODE.get(String(node))]).filter(Boolean).map(s=>[s.lat,s.lng]);
    if(pts.length<2)throw new Error('경기도 노선의 정류소 좌표가 없습니다.');
    if(start==null&&end==null)return pts;
    if(!Number.isInteger(start)||!Number.isInteger(end)||end<=start)return Promise.reject(new Error('정류소 구간이 올바르지 않습니다.'));
    return pts.slice(start,end+1);
  }
  if(start==null && end==null)return busShapeFor(routeId);
  const {g,a,b}=busGeometrySegment(routeId,start,end);
  return g.points.slice(a,b+1);
}

function busRouteDistance(routeId,start,end){
  try{
    const {g,a,b}=busGeometrySegment(routeId,start,end);
    return g.arc[b]-g.arc[a];
  }catch{return null;}
}
