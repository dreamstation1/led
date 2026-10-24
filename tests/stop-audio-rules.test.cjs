const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
const root=path.join(__dirname,'..'),src=fs.readFileSync(path.join(root,'gapless-patch.js'),'utf8');
const policy=src.slice(src.indexOf('  const STOP_AUDIO_RULES='),src.indexOf('  // The embedded page manifest'));
const paths=src.slice(src.indexOf('  function pathsFor('),src.indexOf('  async function loadBlobUrl('));
const segment=src.slice(src.indexOf('  async function resolveSegment('),src.indexOf('  function sayTts('));
const announcement=src.slice(src.indexOf('  async function resolveAnnouncement('),src.indexOf('  // Tells other tabs'));
let requested=[],synthesized=[];
const context={Promise,Set,setTimeout,clearTimeout,recordingManifestReady:Promise.resolve(),audioPaths:(category,key)=>['audio/'+key+'.wav'],firstPlayable:async paths=>{requested.push(...paths);return paths.length?{url:paths[0]}:null;},audioSegment:async(url,extra)=>({kind:'audio',url,...extra}),ttsInfo:async(category,key)=>({text:key+'입니다.',lang:'ko-KR'}),aiSynth:async text=>{synthesized.push(text);return null;}};
vm.createContext(context);vm.runInContext(policy+paths+segment+announcement+';this.resolve=resolveAnnouncement;this.paths=pathsFor;',context);
(async()=>{
 const next={name:'다음 정류장'};
 for(const name of ['선유도역.롯데웰푸드','선유도역 · 롯데웰푸드','롯데마트맥스영등포점'])for(const after of [next,null]){
  requested=[];synthesized=[];const list=await context.resolve({name},after,true);
  assert.ok(list.some(s=>s.category==='stops'&&s.key===name),'Korean announcement remains');
  assert.ok(!list.some(s=>s.category==='phrases_en'||/ \(1\)$/.test(s.key)),'skip the whole English ending including This stop is');
  assert.ok(!requested.some(p=>p.includes('thisstopis')||p.includes(' (1)')),'do not load English audio');
  assert.equal(synthesized.length,0,'do not regenerate forbidden English through AI');
 }
 for(const pair of [[{name:'삼환아파트'},next],[{name:'다른 정류장'},{name:'삼환아파트'}],[{name:'삼환아파트'},null]]){
  requested=[];synthesized=[];const list=await context.resolve(...pair,true),stop=list.find(s=>s.category==='stops'&&s.key==='삼환아파트');
  assert.equal(stop.kind,'tts','Korean recording is replaced, never silenced');assert.equal(stop.text,'삼환아파트입니다.');assert.ok(!requested.includes('audio/삼환아파트.wav'),'ignore stale/imported Korean recordings');
 }
 const normal=await context.resolve({name:'일반 정류장'},next,true);assert.ok(normal.some(s=>s.category==='phrases_en'));assert.equal(normal.find(s=>s.key==='일반 정류장').kind,'audio');
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'audio-files.json')));
 for(const f of ['선유도역.롯데웰푸드 (1).wav','삼환아파트.wav']){assert.ok(!manifest.includes(f));assert.ok(!fs.existsSync(path.join(root,'audio',f)));}
 assert.ok(fs.existsSync(path.join(root,'audio','선유도역.롯데웰푸드.wav')));
 console.log('PASS: English disabled for Seonyudo/Lotte and existing Lotte Mart rule, including terminal/TTS/AI paths; Samhwan Korean always TTS as current or next stop; ordinary audio preserved; deleted assets absent');
})().catch(e=>{console.error(e);process.exitCode=1;});
