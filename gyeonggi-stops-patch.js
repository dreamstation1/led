(function(){
  if(window.__gyeonggiStopsPatchV47)return;
  window.__gyeonggiStopsPatchV47=true;

  const TARGET_ROUTES=new Set(['700','60','60-1','60-2','60-3','70','70-1','70-2','70-3']);
  const STORE_KEY='showGyeonggiBusStops';
  let showGyeonggi=false;
  try{showGyeonggi=localStorage.getItem(STORE_KEY)==='1';}catch(e){}

  function routeNo(v){
    return String(v||'').trim().replace(/^경기\s*/,'').replace(/\s+/g,'');
  }
  function isAllowedGyeonggi(s){
    if(!s||s.region!=='gyeonggi')return true;
    const rs=Array.isArray(s.routes)?s.routes:[];
    return rs.some(r=>TARGET_ROUTES.has(routeNo(r&&((r.name!=null?r.name:r.routeName)))));
  }
  function shouldRenderStop(s){
    if(!s||s.region!=='gyeonggi')return true;
    return showGyeonggi&&isAllowedGyeonggi(s);
  }

  // The stop canvas uses STOPS by fixed numeric index. Temporarily moving hidden
  // Gyeonggi stops outside the world during its synchronous draw keeps every
  // index stable, so routing/planning data stays completely untouched.
  function withHiddenStopsMoved(fn,ctx,args){
    const moved=[];
    try{
      if(typeof STOPS!=='undefined'){
        for(const s of STOPS){
          if(!shouldRenderStop(s)){
            moved.push([s,s.lat,s.lng]);
            s.lat=89.9999;s.lng=179.9999;
          }
        }
      }
      return fn.apply(ctx,args||[]);
    }finally{
      for(const a of moved){a[0].lat=a[1];a[0].lng=a[2];}
    }
  }

  try{
    if(typeof stopCanvas!=='undefined'&&stopCanvas&&typeof stopCanvas._reset==='function'&&!stopCanvas.__gyeonggiFiltered){
      const baseReset=stopCanvas._reset;
      stopCanvas._reset=function(){return withHiddenStopsMoved(baseReset,this,arguments);};
      stopCanvas.__gyeonggiFiltered=true;
    }
  }catch(e){console.warn('Gyeonggi stop canvas filter failed',e);}

  // Prevent invisible Gyeonggi-only stops from winning generic map hit-tests.
  try{
    if(typeof nearestStopAt==='function'){
      const baseNearest=nearestStopAt;
      nearestStopAt=function(){return withHiddenStopsMoved(baseNearest,this,arguments);};
    }
  }catch(e){console.warn('Gyeonggi stop hit filter failed',e);}

  function redraw(){
    try{if(typeof stopCanvas!=='undefined'&&stopCanvas&&typeof stopCanvas._reset==='function')stopCanvas._reset();}catch(e){}
  }

  function addSetting(){
    if(document.getElementById('showGyeonggiStopsToggle'))return;
    const base=document.getElementById('showStopsToggle');
    if(!base)return;
    const parent=base.closest('.setting-block')||base.parentElement?.parentElement;
    if(!parent||!parent.parentNode)return;

    const block=document.createElement('div');
    block.className='setting-block';
    block.innerHTML='<div class="setting-row"><div><div class="setting-title">경기버스정류장 보기</div><div class="setting-desc">700, 60·60-1·60-2·60-3, 70·70-1·70-2·70-3 관련 경기 정류소만 표시합니다. 서울버스 공동 정류소는 기존 서울 정류소로 계속 표시됩니다.</div></div><label class="switch"><input type="checkbox" id="showGyeonggiStopsToggle"><span></span></label></div>';
    parent.insertAdjacentElement('afterend',block);
    const t=block.querySelector('#showGyeonggiStopsToggle');
    t.checked=showGyeonggi;
    t.addEventListener('change',()=>{
      showGyeonggi=!!t.checked;
      try{localStorage.setItem(STORE_KEY,showGyeonggi?'1':'0');}catch(e){}
      redraw();
      try{
        const s=document.getElementById('status');
        if(s)s.textContent=showGyeonggi?'경기버스정류장 보기 ON · 지정 노선 관련 정류소만 표시':'경기버스정류장 보기 OFF';
      }catch(e){}
    });
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{addSetting();redraw();},{once:true});
  else{addSetting();setTimeout(redraw,0);}
})();
