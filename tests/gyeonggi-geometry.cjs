const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../route-geometry.js'),'utf8');
function setup(count=4,missing=-1){
  const stops=Array.from({length:count},(_,i)=>({lat:37+i*.001,lng:127}));
  const route={id:'G1F',region:'gyeonggi',nodes:stops.map((_,i)=>String(i))};
  let calls=0,fail=false;
  const c={ROUTES:[route],STOPS:stops,STOP_BY_NODE:new Map(route.nodes.filter(n=>Number(n)!==missing).map(n=>[n,Number(n)])),AbortController,setTimeout,clearTimeout,
    hav:(a,b,c,d)=>Math.hypot(a-c,b-d)*111320,
    fetch:async url=>{
      calls++;if(fail)throw new Error('offline');
      const coords=url.split('/driving/')[1].split('?')[0].split(';').map(p=>p.split(',').map(Number));
      return {ok:true,json:async()=>({code:'Ok',routes:[{legs:coords.slice(1).map((p,i)=>({steps:[{geometry:{coordinates:[coords[i],[(p[0]+coords[i][0])/2+.0001,(p[1]+coords[i][1])/2],p]}}]}))}]})};
    }};
  vm.createContext(c);vm.runInContext(source,c);
  return {c,calls:()=>calls,fail:v=>fail=v};
}
test('road geometry includes bends; concurrent reads share one request',async()=>{
  const s=setup();const [a,b]=await Promise.all([s.c.fetchBusRouteGeometry('G1F'),s.c.fetchBusRouteGeometry('G1F')]);
  assert.equal(a,b);assert.equal(a.length,7);assert.equal(s.calls(),1);
});
test('segments retain original node indexes when a coordinate is missing',async()=>{
  const s=setup(5,1);const p=await s.c.fetchBusRouteGeometry('G1F',2,4);
  assert.equal(p[0][0],37.002);assert.equal(p.at(-1)[0],37.004);
  await assert.rejects(s.c.fetchBusRouteGeometry('G1F',1,4));
  await assert.rejects(s.c.fetchBusRouteGeometry('G1F',-1,4));
});
test('long routes overlap batches without dropping stops',async()=>{
  const s=setup(125);const p=await s.c.fetchBusRouteGeometry('G1F');
  assert.equal(s.calls(),3);assert.equal(p.length,249);assert.equal(p.at(-1)[0],37.124);
});
test('failed routing never returns stop-to-stop straight lines and can retry',async()=>{
  const s=setup();s.fail(true);await assert.rejects(s.c.fetchBusRouteGeometry('G1F'));
  s.fail(false);assert.equal((await s.c.fetchBusRouteGeometry('G1F')).length,7);
});
test('Seoul official shapes are preserved',async()=>{
  const s=setup();s.c.BUS_ROUTE_SHAPES={S:[[37,127],[37.1,127.1]]};
  assert.equal(await s.c.fetchBusRouteGeometry('S'),s.c.BUS_ROUTE_SHAPES.S);assert.equal(s.calls(),0);
});
test('700 depot is in Bucheon rather than north of the Han River',()=>{
  const d=vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../gyeonggi-data.js'),'utf8')+';GYEONGGI_STOPS');
  const stop=d.find(s=>s[0]==='210000634');
  assert.ok(stop[2]>37.48&&stop[2]<37.50);assert.ok(stop[3]>126.73&&stop[3]<126.76);
});
