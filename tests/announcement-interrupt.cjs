const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function setup(){
  const played=[],audios=[],spoken=[];let cancelled=0;
  class Audio extends EventTarget{
    constructor(){super();this.duration=10;this.readyState=4;audios.push(this);}
    setAttribute(){} load(){this.dispatchEvent(new Event('loadedmetadata'));}
    play(){played.push(this.src);return Promise.resolve();} pause(){this.paused=true;}
  }
  const c={window:{speechSynthesis:{speak:u=>spoken.push(u),cancel:()=>cancelled++}},document:{addEventListener(){}},Audio,SpeechSynthesisUtterance:class{constructor(text){this.text=text;}},AbortController,setTimeout,clearTimeout,setInterval:()=>0,console,
    guideRate:1,guideVolume:1,guideTtsOn:true,fetch:async()=>({ok:false}),URL,
    translateStationName:async n=>n};
  vm.createContext(c);
  let src=fs.readFileSync(path.join(__dirname,'../gapless-patch.js'),'utf8');
  src=src.replace('  warmFixed();setInterval','  window.test={playAudioSegment,sayTts,playResolvedSequence,pauseBetween,setResolver:f=>resolveSegment=f};\n  warmFixed();setInterval');
  vm.runInContext(src,c);
  return {c,api:c.window.test,played,audios,spoken,cancelled:()=>cancelled};
}
const flush=()=>new Promise(r=>setImmediate(r));
test('new arrival pauses current recording and only starts latest announcement',async()=>{
  const s=setup();s.api.setResolver(async(category,key)=>{const audio=new s.c.Audio();audio.src=key;return {kind:'audio',audio,category,key};});
  const old=s.c.announceArrival({name:'old'},{name:'oldNext'});await flush();
  const playing=s.audios.find(a=>a.src==='이번정류소'&&!a.paused);
  const latest=s.c.announceArrival({name:'latest'},null);await flush();
  assert.equal(playing.paused,true);await old;
  assert.equal(s.played.includes('old'),false);assert.equal(s.played.filter(x=>x==='이번정류소').length,2);
  s.c.window.cancelGuideAnnouncement();await latest;
});
test('cancelled TTS settles even when browser does not emit onend',async()=>{
  const s=setup(),ctrl=new AbortController();const p=s.api.sayTts({text:'old',lang:'ko-KR'},ctrl.signal);
  ctrl.abort();assert.equal(await p,false);assert.equal(s.cancelled(),1);
});
test('superseded loading cannot start playback after latest request',async()=>{
  const s=setup();let release;const pending=new Promise(r=>release=r);
  s.api.setResolver(async(category,key)=>{if(key==='old')await pending;const audio=new s.c.Audio();audio.src=key;return {kind:'audio',audio,category,key};});
  const old=s.c.announceArrival({name:'old'},null);
  const latest=s.c.announceArrival({name:'latest'},null);await flush();release();await old;
  assert.equal(s.played.filter(x=>x==='이번정류소').length,1);
  s.c.window.cancelGuideAnnouncement();await latest;
});
test('aborting an inter-sentence pause prevents the next segment',async()=>{
  const s=setup(),ctrl=new AbortController();const a=new s.c.Audio(),b=new s.c.Audio();a.src='first';b.src='stale';
  const p=s.api.playResolvedSequence([{kind:'audio',audio:a,category:'stops'},{kind:'audio',audio:b}],ctrl.signal);
  a.dispatchEvent(new Event('ended'));await flush();ctrl.abort();await p;
  assert.deepEqual(s.played,['first']);
});
