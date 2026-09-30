(function(){
  if(window.__uticMapPatchV59)return;
  window.__uticMapPatchV59=true;

  const DEFAULT_KEY='f3boGzQFKO7tHkA0qQxa5DE9oUhn07GF6LiZ1MIi8';
  const INCIDENT_URL='https://www.utic.go.kr/guide/imsOpenData.do';
  const CCTV_URL='https://www.utic.go.kr/guide/cctvOpenData.do';
  const INCIDENT_TTL=2*60*1000,CCTV_TTL=24*60*60*1000;
  let incidentLayer=null,cctvLayer=null,moveTimer=null,incidentCache=null,cctvCache=null;
  let key=lsGet('uticKey')||DEFAULT_KEY;
  let incidentOn=lsGet('uticIncidentOn')!=='0';
  lsSet('uticKey',key);
  if(lsGet('uticIncidentOn')==null)lsSet('uticIncidentOn','1');

  const style=document.createElement('style');
  style.textContent=`.utic-incident-icon,.utic-cctv-icon{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;box-shadow:0 2px 8px #0009;border:2px solid #fff}.utic-incident-icon{background:#e34234}.utic-cctv-icon{background:#245a9b}.utic-source{margin-top:7px;color:#8d9aaa;font-size:11px}`;
  document.head.appendChild(style);

  const keyInput=document.getElementById('uticKeyInput');
  const incidentToggle=document.getElementById('uticIncidentToggle');
  if(keyInput){keyInput.value=key;keyInput.onchange=()=>{key=keyInput.value.trim();lsSet('uticKey',key);incidentCache=cctvCache=null;refresh(true);};}
  if(incidentToggle){incidentToggle.checked=incidentOn;incidentToggle.onchange=()=>{incidentOn=incidentToggle.checked;lsSet('uticIncidentOn',incidentOn?'1':'0');refresh(false);};}

  function statusMessage(message){const el=document.getElementById('status');if(el)el.textContent=message;}
  function clean(value){return String(value==null?'':value).replace(/;+$/,'').trim();}
  function number(row,names){for(const name of names){const value=Number(clean(row?.[name]));if(Number.isFinite(value))return value;}return NaN;}
  function arrayData(data){
    const rows=Array.isArray(data)?data:Array.isArray(data?.record)?data.record:Array.isArray(data?.result)?data.result:[];
    const head=rows[0]||data||{};
    const code=String(head.resultCode??head.RESULT_CODE??'0');
    if(!['0','00','SUCCESS'].includes(code))throw new Error('UTIC: '+clean(head.resultMsg||head.RESULT_MSG||'조회 실패'));
    return rows.filter(row=>row&&row!==head||!('resultCode' in head));
  }
  function xmlRows(text){
    const doc=new DOMParser().parseFromString(text,'application/xml');
    if(doc.querySelector('parsererror'))throw new Error('UTIC 응답 형식을 읽을 수 없습니다');
    return [...doc.querySelectorAll('record')].map(node=>Object.fromEntries([...node.children].map(x=>[x.tagName,x.textContent])));
  }
  async function fetchRows(url){
    if(!key)throw new Error('설정에서 UTIC 인증키를 입력해 주세요');
    const endpoint=new URL(url);endpoint.searchParams.set('key',key);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(endpoint.toString(),{cache:'no-store',signal:controller.signal});
      if(!response.ok)throw new Error(`UTIC HTTP 오류 (${response.status})`);
      const text=await response.text();
      let data;try{data=JSON.parse(text);}catch(e){return xmlRows(text);}
      return arrayData(data);
    }catch(e){
      if(e.name==='AbortError')throw new Error('UTIC 응답 시간이 초과됐습니다');
      if(e instanceof TypeError)throw new Error('UTIC 연결 실패 · 등록 IP 또는 CORS를 확인해 주세요');
      throw e;
    }finally{clearTimeout(timer);}
  }
  async function cachedRows(kind,force=false){
    const now=Date.now(),ttl=kind==='incident'?INCIDENT_TTL:CCTV_TTL;
    let cache=kind==='incident'?incidentCache:cctvCache;
    if(!force&&cache&&now-cache.at<ttl)return cache.rows;
    const rows=await fetchRows(kind==='incident'?INCIDENT_URL:CCTV_URL);
    cache={at:now,rows};if(kind==='incident')incidentCache=cache;else cctvCache=cache;
    return rows;
  }
  function inBounds(lat,lng,bounds){return Number.isFinite(lat)&&Number.isFinite(lng)&&bounds.pad(.15).contains([lat,lng]);}
  function clearLayer(name){const layer=name==='incident'?incidentLayer:cctvLayer;if(layer)try{map.removeLayer(layer);}catch(e){}if(name==='incident')incidentLayer=null;else cctvLayer=null;}
  function incidentPopup(row){
    const title=clean(row.incidentTitle||row.INCIDENT_TITLE||'돌발정보');
    const road=clean(row.roadName||row.ROAD_NAME),time=clean(row.startDate||row.START_DATE),control=clean(row.controlType||row.CONTROL_TYPE);
    return `<div class="popup-name">⚠️ ${esc(title)}</div>${road?`<div class="popup-meta">${esc(road)}</div>`:''}${control?`<div class="popup-meta">${esc(control)}</div>`:''}${time?`<div class="popup-meta">${esc(time)}</div>`:''}<div class="utic-source">경찰청 도시교통정보센터(UTIC) 제공</div>`;
  }
  function cctvPopup(row){
    const name=clean(row.cctvName||row.cctvname||row.CCTV_NAME||row.name||'UTIC CCTV');
    const ip=clean(row.cctvIp||row.cctvip||row.CCTV_IP||row.id);
    const direct=clean(row.cctvUrl||row.cctvurl||row.CCTV_URL||row.url);
    const stream=/^https?:\/\//i.test(direct)?direct:(ip?`https://www.utic.go.kr/map/getGyeonggiCctvUrl.do?cctvIp=${encodeURIComponent(ip)}`:'');
    return `<div class="popup-name">📹 ${esc(name)}</div>${stream?`<a class="cctv-popup-link" href="${esc(stream)}" target="_blank" rel="noopener">UTIC CCTV 열기</a>`:'<div class="popup-meta">현재 영상 주소가 없습니다.</div>'}<div class="utic-source">경찰청 도시교통정보센터(UTIC) 제공</div>`;
  }
  async function drawIncidents(bounds,force){
    if(!incidentOn){clearLayer('incident');return 0;}
    const rows=await cachedRows('incident',force);clearLayer('incident');incidentLayer=L.layerGroup().addTo(map);let count=0;
    for(const row of rows){
      const lat=number(row,['locationDataY','LOCATION_DATA_Y','coordY','y']),lng=number(row,['locationDataX','LOCATION_DATA_X','coordX','x']);
      if(!inBounds(lat,lng,bounds))continue;
      const marker=L.marker([lat,lng],{icon:L.divIcon({className:'',html:'<div class="utic-incident-icon">⚠</div>',iconSize:[30,30],iconAnchor:[15,15]}),zIndexOffset:850}).addTo(incidentLayer);
      marker.bindPopup(incidentPopup(row),{maxWidth:360,className:'bus-popup'});count++;
    }return count;
  }
  async function drawCctv(bounds,force){
    const enabled=document.getElementById('cctvToggle')?.checked;
    if(!enabled){clearLayer('cctv');return 0;}
    const rows=await cachedRows('cctv',force);clearLayer('cctv');cctvLayer=L.layerGroup().addTo(map);let count=0;
    for(const row of rows){
      const lat=number(row,['coordY','coordy','yCoord','cctvY','locationDataY','lat','latitude']),lng=number(row,['coordX','coordx','xCoord','cctvX','locationDataX','lng','longitude']);
      if(!inBounds(lat,lng,bounds))continue;
      const marker=L.marker([lat,lng],{icon:L.divIcon({className:'',html:'<div class="utic-cctv-icon">📹</div>',iconSize:[30,30],iconAnchor:[15,15]}),zIndexOffset:700}).addTo(cctvLayer);
      marker.bindPopup(cctvPopup(row),{maxWidth:370,className:'bus-popup'});count++;
    }return count;
  }
  async function refresh(force=false){
    if(typeof map==='undefined'||typeof L==='undefined')return;
    const bounds=map.getBounds(),tasks=[];
    if(incidentOn)tasks.push(drawIncidents(bounds,force));else clearLayer('incident');
    if(document.getElementById('cctvToggle')?.checked)tasks.push(drawCctv(bounds,force));else clearLayer('cctv');
    if(!tasks.length)return;
    const results=await Promise.allSettled(tasks),error=results.find(x=>x.status==='rejected');
    if(error){statusMessage(error.reason?.message||'UTIC 정보를 불러오지 못했습니다');return;}
    const total=results.reduce((n,x)=>n+(x.status==='fulfilled'?x.value:0),0);
    if(total)statusMessage(`현재 지도 영역 UTIC 정보 ${total}개 · 경찰청 제공`);
  }
  try{map.on('moveend',()=>{clearTimeout(moveTimer);moveTimer=setTimeout(()=>refresh(false),500);});}catch(e){}
  document.getElementById('cctvToggle')?.addEventListener('change',()=>refresh(false));
  window.refreshUticMap=()=>refresh(true);
  setTimeout(()=>refresh(false),1000);
})();
