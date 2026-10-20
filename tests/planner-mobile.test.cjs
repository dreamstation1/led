// Run with Playwright and its WebKit browser installed. Uses the production DOM, CSS and planner; map/network data are stubbed.
const {webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('fs'),http=require('http'),assert=require('node:assert/strict');
const path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=html.match(/<style>([\s\S]*?)<\/style>/)[1];
const body=html.slice(html.indexOf('<body>')+6,html.indexOf('<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js">'));
const fixture='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body>'+body+'<script>const ROUTES=[],STOPS=[],STOP_BY_NODE=new Map();function stopMatches(){return []}window.fetch=async()=>({ok:true,json:async()=>[]});const map={on(){},closePopup(){},invalidateSize(){}};let status=document.getElementById("status");document.querySelector("#map").style.background="#253745";document.querySelector("#settingsBtn").onclick=()=>document.querySelector("#settingsPanel").classList.toggle("open");</script><script src="/planner.js"></script><script src="/ios-touch-patch.js"></script></body></html>';
const server=http.createServer((req,res)=>{
 if(req.url.includes('planner.js')){res.setHeader('content-type','text/javascript');res.end(fs.readFileSync(root+'/planner.js'));}
 else if(req.url.includes('ios-touch-patch.js')){res.setHeader('content-type','text/javascript');res.end(fs.readFileSync(root+'/ios-touch-patch.js'));}
 else {res.setHeader('content-type','text/html');res.end(fixture);}
});
const rect=async(p,s)=>p.locator(s).boundingBox();
const hittable=async(p,s)=>p.locator(s).evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return el===hit||el.contains(hit);});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 const browser=await webkit.launch({headless:true});
 const context=await browser.newContext({viewport:{width:393,height:670},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url+'/');await page.evaluate(()=>localStorage.clear());await page.reload();
 assert.equal(errors.length,0,errors.join('\n'));
 for(const [width,height] of [[393,670],[320,568],[844,320]]){
  await page.setViewportSize({width,height});await page.locator('#plannerBtn').tap();await page.waitForFunction(()=>document.body.classList.contains('planner-overlay-open'));
  const panel=await rect(page,'#plannerPanel'),head=await rect(page,'.planner-head');
  assert.ok(panel.y>=0&&panel.y+panel.height<=height+1);assert.ok(panel.height<=height*.71);
  assert.equal(await page.locator('#plannerPanel').evaluate(e=>e.parentElement.tagName),'BODY');
  assert.ok(await hittable(page,'#plannerClose'));
  await page.locator('#plannerResults').evaluate(e=>e.innerHTML='<div style="height:1400px">긴 검색 결과</div><button id="last-result">마지막 경로</button>');
  await page.locator('#plannerPanel>.planner-scroll').evaluate(e=>e.scrollTop=e.scrollHeight);
  const after=await rect(page,'.planner-head');assert.equal(head.y,after.y);assert.ok(await hittable(page,'#plannerClose'));
  assert.ok(await hittable(page,'#last-result'),'last result accessible after scrolling');
  await page.locator('#plannerClose').tap();await page.waitForFunction(()=>!document.body.classList.contains('planner-overlay-open'));
  await page.locator('#map').evaluate(e=>{e.onclick=()=>window.mapClicked=true;});await page.locator('#map').tap();assert.equal(await page.evaluate(()=>window.mapClicked),true);
  assert.ok((await rect(page,'#map')).height>=Math.min(100,height*.25));
 }
 await page.setViewportSize({width:393,height:670});await page.locator('#plannerBtn').tap();await page.locator('#plannerTo').fill('도착지');
 await page.setViewportSize({width:393,height:330});await page.waitForTimeout(80);assert.ok(await hittable(page,'#plannerClose'));await page.locator('#plannerClose').tap();
 await page.setViewportSize({width:393,height:670});
 await page.evaluate(()=>{const p=document.querySelector('#plannerDetail');p.innerHTML='<div class="planner-detail-head"><div><strong>상세 경로</strong></div><button>×</button></div><div style="height:1600px">경로 상세</div>';p.querySelector('button').onclick=plannerCloseDetail;p.classList.add('open');});
 await page.waitForSelector('#plannerDetail>.planner-scroll');await page.locator('#plannerDetail>.planner-scroll').evaluate(e=>e.scrollTop=1000);assert.ok(await hittable(page,'#plannerDetail .planner-detail-head button'));await page.locator('#plannerDetail .planner-detail-head button').tap();
 await page.evaluate(()=>{document.querySelector('#plannerFrom').value='저장된 출발지';document.querySelector('#plannerTo').value='저장된 도착지';document.querySelector('#plannerPanel').classList.add('open');plannerSaveState();});await page.reload();await page.waitForTimeout(150);
 assert.equal(await page.locator('#plannerPanel').isVisible(),false);assert.equal(await page.locator('#plannerDetail').isVisible(),false);assert.equal(await page.locator('#plannerFrom').inputValue(),'저장된 출발지');
 await page.locator('#settingsBtn').tap();assert.equal(await page.locator('#settingsPanel').isVisible(),true);await page.locator('#settingsBtn').tap();
 await page.setViewportSize({width:1200,height:800});await page.waitForTimeout(50);await page.locator('#plannerBtn').click();assert.equal(await page.locator('#plannerPanel').evaluate(e=>e.parentElement.id),'mapWrap');
 await page.setViewportSize({width:393,height:670});await page.waitForFunction(()=>document.querySelector('#plannerPanel').parentElement===document.body);await page.locator('#plannerClose').tap();
 await page.locator('#plannerBtn').tap();
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('PASS WebKit: 393/320px phones and landscape; fixed close hit target; scroll to last result; map taps; keyboard-height resize; detail dismissal; restore data without reopening; settings taps; desktop/mobile reparenting');
 const swContext={self:{registration:{scope:url+'/'},addEventListener(){}},URL,Headers,Response};vm.createContext(swContext);vm.runInContext(fs.readFileSync(path.join(root,'sw.js'),'utf8')+';this.patch=patchedHtmlResponse;',swContext);
 const cached=await swContext.patch(new Response('<html><body><script src="planner.js?v=old"></script></body></html>'));assert.ok((await cached.text()).includes('./planner.js?v=20261020-mobile2'));
 await browser.close();server.close();
})().catch(e=>{console.error(e);server.close();process.exit(1)});
