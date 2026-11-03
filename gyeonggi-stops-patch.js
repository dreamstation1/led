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
    // 경기버스 보기를 켜면 경기 정류소를 모두 표시(예전에는 일부 노선만)
    return showGyeonggi;
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
    block.innerHTML='<div class="setting-row"><div><div class="setting-title">경기버스정류장 보기</div><div class="setting-desc">경기도 정류소를 지도에 표시합니다. 지도 위 ‘경기버스 보기/접기’ 버튼과 같은 설정입니다. 서울버스 공동 정류소는 기존 서울 정류소로 계속 표시됩니다.</div></div><label class="switch"><input type="checkbox" id="showGyeonggiStopsToggle"><span></span></label></div>';
    parent.insertAdjacentElement('afterend',block);
    const t=block.querySelector('#showGyeonggiStopsToggle');
    t.checked=showGyeonggi;
    t.addEventListener('change',()=>setShowGyeonggi(!!t.checked));
  }
  function setShowGyeonggi(on){
    showGyeonggi=on;
    try{localStorage.setItem(STORE_KEY,showGyeonggi?'1':'0');}catch(e){}
    const t=document.getElementById('showGyeonggiStopsToggle');if(t)t.checked=on;
    syncButton();redraw();
    try{const s=document.getElementById('status');if(s)s.textContent=on?'경기버스 정류장 표시 중 · 접기를 누르면 숨깁니다':'경기버스 정류장을 접었어요';}catch(e){}
  }
  function syncButton(){const b=document.getElementById('gyeonggiStopsBtn');if(!b)return;b.textContent=showGyeonggi?'경기 접기':'경기 보기';b.setAttribute('aria-pressed',String(showGyeonggi));b.classList.toggle('on',showGyeonggi);}
  function addButton(){
    if(document.getElementById('gyeonggiStopsBtn'))return;
    const b=document.createElement('button');b.id='gyeonggiStopsBtn';b.type='button';b.title='경기버스 정류장 보기/접기';
    b.onclick=()=>setShowGyeonggi(!showGyeonggi);
    const actions=document.querySelector('.mobile-map-actions'),fav=document.getElementById('favBtn'),planner=document.getElementById('plannerBtn');
    if(actions&&fav&&fav.parentNode===actions)actions.insertBefore(b,fav);else if(planner)planner.after(b);else return;
    if(!document.getElementById('gyeonggiStopsBtnStyle')){const st=document.createElement('style');st.id='gyeonggiStopsBtnStyle';st.textContent='#gyeonggiStopsBtn.on{background:#1f6f43!important;border-color:#3fbf7f!important;color:#fff!important}@media(max-width:900px){#top .mobile-map-actions{grid-template-columns:repeat(9,minmax(0,1fr))!important}#top #gyeonggiStopsBtn{font-size:10px;letter-spacing:-.5px}}';document.head.appendChild(st);}
    syncButton();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{addSetting();redraw();},{once:true});
  else{addSetting();setTimeout(redraw,0);}
})();
