/* Seoul Open Data browser transport, bounded polling and persistent timetable cache. */
(function(root){
'use strict';
const ARRIVAL_KEY='524c50575073657536317154477278',POSITION_KEY='784a4d616473657535316d474a5a47';
const SCHEDULE_KEY='QZaklqvKVpzmBpWW4SolKCnjBRjZw15cWSK0UNYnrfzYdHZcYPmvAMIJS1E2SaU+OZeITup95X6EjZ/5GWe0ZA==';
const cache=new Map(),pending=new Map();let scheduleBlockedUntil=0,allScheduleBlockedUntil=0;
const read=k=>{try{return JSON.parse(localStorage.getItem(k)||'null');}catch{return null;}};
const write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch{}};
function seoulDate(date=new Date()){return new Date(date.getTime()+9*3600000).toISOString().slice(0,10);}
async function cached(key,ttl,loader,persist=false){
 const old=cache.get(key)||(persist?read('subway-cache:'+key):null);if(old&&Date.now()-old.at<ttl)return old.value;
 if(pending.has(key))return pending.get(key);
 const promise=(async()=>{const value=await loader();const record={at:Date.now(),value};cache.set(key,record);if(persist)write('subway-cache:'+key,record);return value;})().finally(()=>pending.delete(key));pending.set(key,promise);return promise;
}
async function json(url){const res=await fetch(url,{signal:AbortSignal.timeout(14000),cache:'no-store'});if(!res.ok)throw new Error('정보 제공 서버 응답 오류 ('+res.status+')');const data=await res.json();const error=data.errorMessage||data.RESULT;if(error&&!['INFO-000','INFO-200'].includes(error.code||error.CODE))throw new Error(error.message||error.MESSAGE||'정보 조회 실패');return data;}
// The provider's documented HTTPS sample viewer has CORS enabled and forwards
// only Seoul's public API URLs. Double encoding matches its own example UI.
function seoulUrl(url){return 'https://data.seoul.go.kr/dataList/getOpenApiSample.do?'+new URLSearchParams({url:encodeURI(url)});}
function realtime(service,value,key){return json(seoulUrl(`http://swopenAPI.seoul.go.kr/api/subway/${key}/json/${service}/0/200/${value}`));}
async function arrivals(name){return cached('arrival:'+name,25000,async()=>{const d=await realtime('realtimeStationArrival',name,ARRIVAL_KEY);return {rows:d.realtimeArrivalList||[],at:Date.now()};});}
async function positions(line){return cached('position:'+line,25000,async()=>{const d=await realtime('realtimePosition',line,POSITION_KEY);return {rows:d.realtimePositionList||[],at:Date.now()};});}
async function reserveSchedule(){
 const reserve=()=>{const key='subwayScheduleBudget.v1',day=seoulDate(),old=read(key),b=old?.day===day?old:{day,count:0};if(b.count>=9500)throw new Error('오늘 시간표 조회 한도에 도달했습니다. 실시간 도착정보를 이용해 주세요.');b.count++;write(key,b);return b.count;};
 return navigator.locks?navigator.locks.request('subway-schedule-budget',reserve):reserve();
}
async function timetable(station,direction,weekend,date=new Date()){
 const day=seoulDate(date),key=['schedule',station.code,station.line,direction,weekend,day].join(':');
 return cached(key,24*3600000,async()=>{
  if(Date.now()<allScheduleBlockedUntil)throw new Error('시간표 서버 연결 대기 중입니다. 잠시 후 다시 확인해 주세요.');
  await reserveSchedule();
  const params=new URLSearchParams({serviceKey:SCHEDULE_KEY,pageNo:'1',numOfRows:'1000',dataType:'JSON',tmprTmtblYn:'N',upbdnbSe:direction,wkndSe:weekend,lineNm:station.line,stnCd:station.code,searchDt:day+'T12:00:00'});
  try{
   if(Date.now()<scheduleBlockedUntil)throw new Error('시간표 서버 연결 대기 중');
   const d=await json('https://apis.data.go.kr/B553766/schedule/getTrainSch?'+params),body=d.response?.body||d.body,header=d.response?.header||d.header;
   if(header&&!['00','0'].includes(String(header.resultCode)))throw new Error(header.resultMsg||'시간표 조회 실패');
   const raw=body?.items?.item,rows=Array.isArray(raw)?raw:raw?[raw]:[];
   if(!body)throw new Error('시간표 응답 형식 오류');
   return {rows,total:Number(body.totalCount||rows.length),at:Date.now(),source:'공공데이터포털'};
  }catch(e){
   scheduleBlockedUntil=Date.now()+3600000;
   if(weekend==='상시')throw e;
   const week={평일:'1',주말:'2',공휴일:'3'}[weekend],dir=['상행','내선'].includes(direction)?'1':'2';
   let d;try{d=await json(seoulUrl(`http://openapi.seoul.go.kr:8088/${POSITION_KEY}/json/SearchSTNTimeTableByIDService/1/500/${station.code}/${week}/${dir}/`));}catch(fallbackError){allScheduleBlockedUntil=Date.now()+60000;throw fallbackError;}const body=d.SearchSTNTimeTableByIDService;
   if(!body)throw e;
   if(body.RESULT&&!['INFO-000','INFO-200'].includes(body.RESULT.CODE))throw new Error(body.RESULT.MESSAGE);
   const rows=(body.row||[]).map(r=>({stnCd:r.STATION_CD,stnNm:r.STATION_NM,trainDptreTm:r.LEFTTIME==='00:00:00'?'':r.LEFTTIME,trainArvlTm:r.ARRIVETIME==='00:00:00'?'':r.ARRIVETIME,arvlStnNm:r.SUBWAYENAME,etrnYn:r.EXPRESS_YN==='D'?'Y':'N',upbdnbSe:direction,terminates:r.LEFTTIME==='00:00:00'}));
   return {rows,total:Number(body.list_total_count||rows.length),at:Date.now(),source:'서울 열린데이터광장 (공공데이터포털 연결 실패로 대체)'};
  }
 },true);
}
root.SubwayAPI={arrivals,positions,timetable,seoulDate,cached,reserveSchedule};
})(globalThis);
