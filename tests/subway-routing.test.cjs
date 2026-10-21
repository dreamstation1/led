const assert=require('node:assert/strict'),fs=require('fs'),Routing=require('../subway-routing.js');
const data=require('../data/subway-network.json'),graph=Routing.build(data,[],[]);
function station(name,line){const s=data.stations.find(s=>s.name===name&&s.line===line);assert.ok(s,name+' '+line);return s;}
function route(a,b,lineA,lineB){const from=station(a,lineA),to=station(b,lineB||lineA);return Routing.search(graph,from,to,{startNode:'rail:'+from.id,endNode:'rail:'+to.id});}
assert.equal(data.stations.length,799);
const ring=route('시청','충정로','2호선');assert.ok(ring);assert.equal(ring.edges.filter(e=>e.mode==='subway').length,1);
const spur=route('신도림','까치산','2호선');assert.equal(spur.edges.filter(e=>e.mode==='subway').length,4);assert.equal(spur.boardings,1);
const branch=route('오목교','마천','5호선');assert.ok(branch);assert.equal(branch.boardings,1);assert.ok(!branch.edges.some(e=>graph.nodes.get(e.to).name==='길동'));
const cross=route('길동','둔촌동','5호선');assert.ok(cross.boardings>=2,'switching branches requires another train');
const main1=route('서울역','안양','1호선');assert.equal(main1.boardings,1);
const loop=route('역촌','응암','6호선');assert.equal(loop.edges.length,5,'Eungam loop is one way');
const airport=route('디지털미디어시티','김포공항','공항철도');assert.equal(airport.edges.length,2);assert.equal(graph.nodes.get(airport.edges[0].to).name,'마곡나루');
const ga=station('서울','GTX-A'),gb=station('수서','GTX-A');const gtx=Routing.search(graph,ga,gb,{startNode:'rail:'+ga.id,endNode:'rail:'+gb.id,allowed:r=>r.line==='GTX-A'});assert.equal(gtx,null,'unfinished GTX section must not connect');
const connected=route('신도림','강남','2호선');assert.ok(connected);assert.equal(connected.boardings,1);
const busStops=[{node:'b1',name:'출발',lat:37,lng:126.9,routes:[{id:'bus'}]},{node:'b2',name:'역앞',lat:37,lng:126.92,routes:[{id:'bus'}]}];
const sample={stations:[{id:'s1',name:'환승역',line:'테스트선',lat:37,lng:126.9201},{id:'s2',name:'도착역',line:'테스트선',lat:37,lng:126.95}],edges:[['s1','s2',false,'테스트선']]};
const mixed=Routing.build(sample,busStops,[{id:'bus',name:'100',nodes:['b1','b2']}]);const trip=Routing.search(mixed,busStops[0],sample.stations[1],{startNode:'b1',endNode:'rail:s2'});assert.ok(trip);assert.deepEqual(trip.edges.filter(e=>e.mode!=='walk').map(e=>e.mode),['bus','subway']);assert.equal(trip.boardings,2);
assert.equal(Routing.search(mixed,busStops[0],sample.stations[1],{allowed:r=>r.mode!=='subway'}),null);
assert.equal(Routing.search(mixed,busStops[0],sample.stations[1],{allowed:r=>r.id!=='bus',startNode:'b1',endNode:'rail:s2'}),null);
// Destination access walk participates in the shortest-path objective.
const shortest={nodes:new Map([['rail:a',{lat:37,lng:127,mode:'subway'}],['rail:b',{lat:37,lng:127.001,mode:'subway'}],['rail:c',{lat:37,lng:127.01,mode:'subway'}]]),routes:new Map([['x',{id:'x',mode:'subway'}]]),adj:new Map([['rail:a',[{from:'rail:a',to:'rail:b',route:'x',mode:'subway',meters:100,minutes:1},{from:'rail:a',to:'rail:c',route:'x',mode:'subway',meters:1000,minutes:2}]]])};
assert.equal(Routing.search(shortest,{lat:37,lng:127},{lat:37,lng:127.01},{startNode:'rail:a'}).end,'rail:c');
console.log('PASS: 799 official stations; loop, branch, through-service, incomplete GTX, bus/subway transfers, exclusions and endpoint walking');
