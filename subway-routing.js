/* Pure transit graph: directed bus routes, railway branches and walking transfers. */
(function(root){
'use strict';
class Heap{
 constructor(){this.a=[];}
 push(v){const a=this.a;let i=a.length;a.push(v);while(i){const p=(i-1)>>1;if(a[p].cost<=v.cost)break;a[i]=a[p];i=p;}a[i]=v;}
 pop(){const a=this.a,v=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let j=i*2+1;if(j+1<a.length&&a[j+1].cost<a[j].cost)j++;if(a[j].cost>=last.cost)break;a[i]=a[j];i=j;}a[i]=last;}return v;}
}
function distance(a,b){const rad=Math.PI/180,x=(b.lat-a.lat)*rad,y=(b.lng-a.lng)*rad;return 6371000*2*Math.asin(Math.sqrt(Math.sin(x/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(y/2)**2));}
function build(network,busStops,busRoutes){
 const nodes=new Map(),adj=new Map(),routes=new Map();
 function add(a,b,route,mode,meters,minutes){if(!adj.has(a))adj.set(a,[]);adj.get(a).push({from:a,to:b,route,mode,meters,minutes});}
 network.stations.forEach(s=>nodes.set('rail:'+s.id,{...s,mode:'subway',node:'rail:'+s.id}));
 for(const [a,b,oneway,service] of network.edges){const x='rail:'+a,y='rail:'+b,sa=nodes.get(x),sb=nodes.get(y);if(!sa||!sb)continue;const id='rail-service:'+service;routes.set(id,{id,name:service,mode:'subway',line:sa.line});const meters=distance(sa,sb),minutes=Math.max(1.3,meters/1000/35*60+.5);add(x,y,id,'subway',meters,minutes);if(!oneway)add(y,x,id,'subway',meters,minutes);}
 for(const s of busStops){if(s.mode==='subway')continue;nodes.set(String(s.node),s);}
 for(const r of busRoutes){routes.set(String(r.id),r);for(let i=1;i<r.nodes.length;i++){const a=String(r.nodes[i-1]),b=String(r.nodes[i]),sa=nodes.get(a),sb=nodes.get(b);if(!sa||!sb)continue;const meters=distance(sa,sb)*1.25;if(meters>8000)continue;add(a,b,String(r.id),'bus',meters,meters/1000/22*60+.28);}}
 const grid=new Map(),cell=s=>[Math.floor(s.lat*200),Math.floor(s.lng*200)];
 for(const [id,s] of nodes){if(s.mode!=='subway'&&!s.routes?.length)continue;const k=cell(s).join(',');if(!grid.has(k))grid.set(k,[]);grid.get(k).push(id);}
 for(const [id,s] of nodes){if(s.mode!=='subway')continue;const [x,y]=cell(s);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const other of grid.get([x+dx,y+dy].join(','))||[]){if(id===other)continue;const t=nodes.get(other),meters=distance(s,t);const canonical=n=>n==='서울'||n==='서울역'?'서울역':n==='총신대입구(이수)'?'이수':n;const sameStation=t.mode==='subway'&&canonical(s.name)===canonical(t.name);if(meters>(sameStation?900:300))continue;if(t.mode==='subway'&&!sameStation)continue;add(id,other,null,'walk',meters,meters/75+(sameStation?4:1));if(t.mode!=='subway')add(other,id,null,'walk',meters,meters/75+1);}}
 return {nodes,adj,routes};
}
function nearby(graph,point){return [...graph.nodes].filter(([,s])=>s.mode==='subway'||s.routes?.length).map(([node,s])=>({node,meters:distance(point,s),rail:s.mode==='subway'})).filter(s=>s.meters<=(s.rail?1000:650)).sort((a,b)=>a.meters-b.meters).filter((s,i,a)=>a.slice(0,i).filter(p=>p.rail===s.rail).length<(s.rail?8:14));}
function search(graph,from,to,{allowed=()=>true,maxBoardings=4,maxVisits=140000,penalties=new Map(),startNode=null,endNode=null}={}){
 const starts=startNode?[{node:startNode,meters:0}]:nearby(graph,from),ends=new Map((endNode?[{node:endNode,meters:0}]:nearby(graph,to)).map(x=>[x.node,x.meters]));if(!starts.length||!ends.size)return null;
 const heap=new Heap(),best=new Map();let visits=0,winner=null,winnerCost=Infinity;
 const key=v=>`${v.node}|${v.route||''}|${v.boardings}|${+v.rail}`;
 function put(v){const k=key(v);if(v.cost>=(best.get(k)??Infinity))return;best.set(k,v.cost);heap.push(v);}
 for(const s of starts)put({node:s.node,route:null,boardings:0,rail:false,cost:s.meters/75,walk:s.meters,previous:null,edge:null});
 while(heap.a.length&&visits++<maxVisits){const v=heap.pop();if(v.cost!==best.get(key(v)))continue;
  if(v.cost>=winnerCost)break;
  if(v.rail&&ends.has(v.node)){const cost=v.cost+ends.get(v.node)/75;if(cost<winnerCost){winner=v;winnerCost=cost;}}
  for(const e of graph.adj.get(v.node)||[]){const route=e.route&&graph.routes.get(e.route);if(route&&!allowed(route,e,graph))continue;const board=e.route&&e.route!==v.route,boardings=v.boardings+(board?1:0);if(boardings>maxBoardings)continue;if(e.mode==='walk'&&v.walk+e.meters>1800)continue;
   put({node:e.to,route:e.route||v.route,boardings,rail:v.rail||e.mode==='subway',cost:v.cost+e.minutes+(board?(v.boardings?8:5):0)+(board?(penalties.get(e.route)||0):0),walk:v.walk+(e.mode==='walk'?e.meters:0),previous:v,edge:e});
  }
 }
 if(winner){const endWalk=ends.get(winner.node),edges=[];let cur=winner;while(cur.previous){edges.push(cur.edge);cur=cur.previous;}edges.reverse();return {edges,walk:winner.walk+endWalk,minutes:winnerCost,boardings:winner.boardings,start:cur.node,end:winner.node};}
 return null;
}
const api={build,search,distance,nearby};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SubwayRouting=api;
})(typeof globalThis!=='undefined'?globalThis:this);
