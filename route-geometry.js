// Geometry published by Seoul TOPIS, not a route guessed by a car navigator.
const busGeometryCache=new Map();
const gyeonggiGeometryJobs=new Map();

async function gyeonggiRoadGeometry(route){
  if(busGeometryCache.has(route.id))return busGeometryCache.get(route.id);
  if(gyeonggiGeometryJobs.has(route.id))return gyeonggiGeometryJobs.get(route.id);
  const job=(async()=>{
    const stops=route.nodes.map((node,order)=>({stop:STOPS[STOP_BY_NODE.get(String(node))],order}))
      .filter(({stop})=>stop&&Number.isFinite(stop.lat)&&Number.isFinite(stop.lng));
    if(stops.length<2)throw new Error('경기도 노선의 정류소 좌표가 없습니다.');
    const points=[],anchors=new Array(route.nodes.length).fill(null);
    // Overlap one stop between batches. Every stop stays in its original order.
    for(let first=0;first<stops.length-1;first+=59){
      const batch=stops.slice(first,first+60);
      const coords=batch.map(({stop:s})=>`${s.lng},${s.lat}`).join(';');
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
      let data;
      try{
        const response=await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?steps=true&overview=false&geometries=geojson&continue_straight=false&radiuses=${batch.map(()=>100).join(';')}`,{signal:controller.signal});
        if(!response.ok)throw new Error('도로 경로 서버 응답 오류');
        data=await response.json();
      }finally{clearTimeout(timer);}
      const legs=data.routes?.[0]?.legs;
      if(data.code!=='Ok'||legs?.length!==batch.length-1)throw new Error('정류소 사이 도로 경로를 찾을 수 없습니다.');
      for(let i=0;i<legs.length;i++){
        const line=legs[i].steps.flatMap(step=>step.geometry?.coordinates||[]);
        if(line.length<2||line.some(p=>!Number.isFinite(p[0])||!Number.isFinite(p[1])))throw new Error('도로 경로 좌표가 올바르지 않습니다.');
        const head=[line[0][1],line[0][0]],tail=points[points.length-1];
        // OSRM can round adjacent leg endpoints differently by under a metre.
        // Reject disconnected batches rather than inventing a long connector.
        if(tail&&hav(...tail,...head)>2)throw new Error('도로 경로 연결이 일치하지 않습니다.');
        if(!tail)points.push(head);
        anchors[batch[i].order]=points.length-1;
        for(const [lng,lat] of line){
          const last=points[points.length-1];
          if(last[0]!==lat||last[1]!==lng)points.push([lat,lng]);
        }
        anchors[batch[i+1].order]=points.length-1;
      }
    }
    const arc=[0];
    for(let i=1;i<points.length;i++)arc.push(arc[i-1]+hav(...points[i-1],...points[i]));
    const value={route,points,anchors,arc};
    busGeometryCache.set(route.id,value);
    return value;
  })();
  gyeonggiGeometryJobs.set(route.id,job);
  try{return await job;}finally{gyeonggiGeometryJobs.delete(route.id);}
}

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
    const full=start==null&&end==null;
    if(!full&&(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>=routeMeta.nodes.length))throw new Error('정류소 구간이 올바르지 않습니다.');
    const g=await gyeonggiRoadGeometry(routeMeta);
    if(full)return g.points;
    if(g.anchors[start]==null||g.anchors[end]==null)throw new Error('정류소 좌표가 없습니다.');
    return g.points.slice(g.anchors[start],g.anchors[end]+1);
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
