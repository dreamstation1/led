/* Original order form adapted from dreamstation1/led, led-shop/index.html. */
const CONFIG={sheetUrl:'',kakaoLink:'',notifyEmail:'',price:{fixed:null,usb:200000,wifi:250000,stand:4000,ship:null}};
const $=s=>document.querySelector(s);
const won=n=>typeof n==='number'?n.toLocaleString('ko-KR')+'원':'가격 미정';
const modeNames={fixed:'정류장 지정 제작',usb:'USB 연결 · 직접 변경',wifi:'와이파이 연결 · 무선 조작'};
const P=CONFIG.price;
function state(){return {mode:$('[name=mode]:checked').value,entry:$('[name=entry]:checked').value,stop:$('#stop').value.trim(),direction:$('#direction').value.trim(),name:$('#name').value.trim(),kakao:$('#kakao').value.trim(),phone:$('#phone').value.trim(),pay:$('#pay').value,recv:$('#recv').value,addr:$('#addr').value.trim(),memo:$('#memo').value.trim(),stand:$('#stand').checked?$('[name=standColor]:checked').value:''}}
function quote(s){const L=[[modeNames[s.mode],P[s.mode]]];if(s.stand)L.push(['받침대 · '+s.stand+' (2개 한 세트)',P.stand]);if(s.recv==='ship')L.push(['택배비',P.ship]);return {L,total:typeof P[s.mode]==='number'?L.reduce((a,[,v])=>a+(typeof v==='number'?v:0),0):null,shippingPending:s.recv==='ship'&&P.ship===null,wifi:false}}
function render(){const s=state(),q=quote(s);$('#fixedPrice').textContent='판매 완료';$('#standColors').hidden=!s.stand;$('#usbPrice').textContent=won(P.usb);$('#wifiPrice').textContent=won(P.wifi);$('#stopLabel').textContent=s.entry==='id'?'정류장 ID *':'정류장 이름 *';$('#stop').placeholder=s.entry==='id'?'예: 15-154':'예: 이대목동병원';$('#stop').inputMode=s.entry==='id'?'tel':'text';$('#stopHelp').textContent=s.entry==='id'?'정류장 표지판의 정류장 ID를 입력해주세요. 앞자리 0도 포함해주세요.':'이름이 같은 정류장은 방향도 함께 알려주세요.';$('#modeNote').textContent=s.mode==='fixed'?'입력하신 정류장에 맞춰 제작합니다.':'처음 사용할 정류장을 적어주세요. 이후 '+(s.mode==='usb'?'USB 연결':'와이파이 무선 조작')+'으로 정류장을 변경할 수 있습니다.';$('#addrField').hidden=s.recv!=='ship';$('#shipNote').textContent=s.recv==='ship'?'택배비 '+won(P.ship):'';$('#lines').replaceChildren();for(const [label,value] of [['정류장',s.stop||'미입력'],...q.L.map(([k,v])=>[k,k==='택배비'&&v===null?'별도 안내':won(v)])]){const row=document.createElement('div');row.className='line';for(const text of [label,value]){const span=document.createElement('span');span.textContent=text;row.append(span)}$('#lines').append(row)}$('#total').textContent=won(q.total)+(q.shippingPending?' + 배송비':'');$('#priceNote').hidden=!q.shippingPending;$('#payNote').textContent=s.pay==='weekly'?'매주 월요일 나눠서 입금 · 다 모이면 제작 시작':'주문 확인 후 입금 안내 · 입금 확인되면 제작 시작'}
function orderText(s,q,id){return [`[BIS 버스정류장 전광판 주문] ${id}`,`제작 방식: ${modeNames[s.mode]}`,`정류장 ${s.entry==='id'?'ID':'이름'}: ${s.stop}`,`방향 또는 위치: ${s.direction||'-'}`,'안내 정보: 서울시 실시간 버스 도착 정보',s.mode==='usb'?'USB 연결: 아이폰 및 애플 기기 미지원':null,`받침대: ${s.stand?s.stand+" · 2개 한 세트 ("+won(P.stand)+")":"없음"}`,`합계: ${won(q.total)}${q.shippingPending?" + 택배비 별도":""}`,`입금: ${s.pay==='weekly'?'매주 월요일 분할':'한 번에'}`,`받는 방법: ${s.recv==='ship'?'택배 (택배비 '+won(P.ship)+') / '+s.addr:'직거래'}`,`이름: ${s.name}`,`카톡: ${s.kakao}`,`연락처: ${s.phone||'-'}`,`요청사항: ${s.memo||'-'}`].filter(Boolean).join('\n')}
function validate(s){if(s.mode==='fixed')return '정류장 지정 제작은 선착순 3명 판매가 완료되어 현재 품절입니다.';if(!s.stop)return '정류장 이름 또는 정류장 ID를 적어 주세요.';if(s.entry==='id'&&!/^\d{5,9}$/.test(s.stop.replace(/[-\s]/g,'')))return '정류장 ID를 확인해주세요. 예: 15-154';if(!s.name)return '이름 또는 닉네임을 적어 주세요.';if(!s.kakao)return '연락받을 카톡 닉네임을 적어 주세요.';if(s.recv==='ship'&&!s.addr)return '택배 받을 주소를 적어 주세요.';return ''}
$("#f").addEventListener("input", render);
$("#f").addEventListener("change", render);

$("#f").addEventListener("submit", async e=>{
  e.preventDefault();
  const s = state(), q = quote(s), msg = validate(s);
  $("#err").hidden = !msg; $("#err").textContent = msg;
  if(msg) return;
  const id = "BIS-" + new Date(Date.now() + 9*3600*1000).toISOString().slice(2,10).replace(/-/g,"") + "-" + Math.random().toString(36).slice(2,6).toUpperCase();
  const text = orderText(s,q,id);
  const btn = $("#submit"); btn.disabled = true; btn.textContent = "만드는 중…";
  saveLocal({id, kakao:s.kakao, text, at:Date.now(), status:"주문서 작성 · 전송 전"});
  const toSheet = async ()=>{
    if(!CONFIG.sheetUrl) return false;
    try{
      const ctrl = new AbortController(); setTimeout(()=>ctrl.abort(), 15000);
      const r = await fetch(CONFIG.sheetUrl, { method:"POST", signal:ctrl.signal,
        body: JSON.stringify({ id, name:s.name, kakao:s.kakao, phone:s.phone, total:won(q.total), text }) });
      const j = await r.json().catch(()=>({}));
      return j.ok === true;
    }catch(_){ return false; }
  };
  const toForm = async ()=>{
    let sent = false;
    if(!(CONFIG.notifyEmail && /github\.io$/.test(location.hostname))) return false;
    try{
      const ctrl = new AbortController(); const t = setTimeout(()=>ctrl.abort(), 12000);
      const r = await fetch("https://formsubmit.co/ajax/" + encodeURIComponent(CONFIG.notifyEmail), {
        method:"POST", signal:ctrl.signal,
        headers:{"Content-Type":"application/json","Accept":"application/json"},
        body: JSON.stringify({ _subject:`[전광판 주문] ${s.name} · ${won(q.total)}`, _template:"box", _captcha:"false",
          주문번호:id, 이름:s.name, 카톡:s.kakao, 합계:won(q.total)+(q.wifi?" + 와이파이 견적":""), 주문서:text })
      });
      clearTimeout(t);
      const j = await r.json().catch(()=>({}));
      sent = r.ok && String(j.success)!=="false";
    }catch(_){ sent = false; }
    return sent;
  };
  const [a, b] = await Promise.all([toSheet(), toForm()]);
  const sent = a || b;
  saveLocal({id,kakao:s.kakao,text,at:Date.now(),status:sent?"주문 접수":"주문서 작성 · 카톡 전송 필요"});
  btn.disabled = false; btn.textContent = "주문서 만들기";
  $("#oid").textContent = id;
  $("#ordertext").textContent = text;
  $("#doneTitle").textContent = sent ? "주문이 접수됐어요" : "주문서가 만들어졌어요";
  $("#doneMsg").textContent = sent
    ? "판매자에게 주문 알림이 갔어요. 혹시 모르니 아래 주문서도 복사해서 카톡으로 보내 주세요."
    : "마지막 단계예요. 아래 '주문서 복사'를 누르고 판매자 카톡에 붙여넣어 보내 주시면 주문 완료입니다.";
  if(CONFIG.kakaoLink){ $("#kakaoLink").href = CONFIG.kakaoLink; $("#kakaoLink").hidden = false; }
  $("#qId").value = id; $("#qKakao").value = s.kakao;
  $("#done").hidden = false;
  $("#done").scrollIntoView({behavior:"smooth", block:"start"});
});

$("#copy").addEventListener("click", async ()=>{
  const txt = $("#ordertext").textContent;
  try{ await navigator.clipboard.writeText(txt); $("#copy").textContent = "복사됨"; }
  catch(_){ const r = document.createRange(); r.selectNodeContents($("#ordertext")); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); $("#copy").textContent = "선택됨 · 길게 눌러 복사"; }
  setTimeout(()=>$("#copy").textContent="주문서 복사", 2500);
});
$("#again").addEventListener("click", ()=>{ $("#done").hidden = true; window.scrollTo({top:0}); });

function saveLocal(rec){
  try{ const all = JSON.parse(localStorage.getItem("bisOrders")||"{}"); all[rec.id] = rec; localStorage.setItem("bisOrders", JSON.stringify(all)); }catch(_){}
}
function loadLocal(id){
  try{ return (JSON.parse(localStorage.getItem("bisOrders")||"{}"))[id] || null; }catch(_){ return null; }
}
const normK = v => String(v||"").replace(/\s+/g,"").toLowerCase();
const fmtKST = t => new Date(t + 9*3600*1000).toISOString().slice(0,16).replace("T"," ");

async function lookup(){
  const id = $("#qId").value.trim().toUpperCase(), k = $("#qKakao").value.trim();
  const showErr = m => { $("#qErr").textContent = m; $("#qErr").hidden = !m; };
  $("#qResult").hidden = true; showErr("");
  if(!id || !k) return showErr("주문번호와 카톡 닉네임을 둘 다 넣어 주세요.");
  const btn = $("#qBtn"); btn.disabled = true; btn.textContent = "조회 중…";
  let hit = null;
  if(CONFIG.sheetUrl){
    try{
      const ctrl = new AbortController(); const t = setTimeout(()=>ctrl.abort(), 12000);
      const r = await fetch(CONFIG.sheetUrl + "?id=" + encodeURIComponent(id) + "&kakao=" + encodeURIComponent(k), {signal:ctrl.signal});
      clearTimeout(t);
      const j = await r.json();
      if(j.found) hit = {status:j.status, when:j.at, text:j.text};
    }catch(_){}
  }
  if(!hit){
    const L = loadLocal(id);
    if(L && normK(L.kakao) === normK(k)) hit = {status:L.status + " (이 기기에 저장된 주문서)", when:fmtKST(L.at), text:L.text};
  }
  btn.disabled = false; btn.textContent = "조회";
  if(!hit) return showErr("주문을 찾지 못했어요. 주문번호와 카톡 닉네임을 다시 확인하거나 판매자에게 카톡으로 물어봐 주세요.");
  $("#qStatus").textContent = hit.status;
  $("#qWhen").textContent = hit.when ? "· 접수 " + hit.when : "";
  $("#qText").textContent = hit.text;
  $("#qResult").hidden = false;
}
$("#qBtn").addEventListener("click", lookup);
["#qId","#qKakao"].forEach(sel => $(sel).addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); lookup(); } }));
{ const o = new URLSearchParams(location.search).get("order"); if(o){ $("#qId").value = o; } }

render();
