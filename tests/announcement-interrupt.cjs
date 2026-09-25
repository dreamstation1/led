const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function setup({touch=false}={}){
  const played=[],audios=[],spoken=[];let cancelled=0;
  class Audio extends EventTarget{
    constructor(src=''){super();this.src=src;this.duration=10;this.readyState=4;audios.push(this);}
    setAttribute(){} removeAttribute(name){if(name==='src')this.src='';} load(){this.dispatchEvent(new Event('loadedmetadata'));}
    play(){played.push(this.src);return Promise.resolve();} pause(){this.paused=true;}
  }
  const c={window:{speechSynthesis:{speak:u=>spoken.push(u),cancel:()=>cancelled++}},document:{addEventListener(){}},navigator:{maxTouchPoints:touch?5:0,userAgent:touch?'Android':''},matchMedia:()=>({matches:touch}),Audio,SpeechSynthesisUtterance:class{constructor(text){this.text=text;}},AbortController,setTimeout,clearTimeout,setInterval:()=>0,console,
    guideRate:1,guideVolume:1,guideTtsOn:true,fetch:async()=>({ok:false}),URL,
    translateStationName:async n=>n};
  vm.createContext(c);
  let src=fs.readFileSync(path.join(__dirname,'../gapless-patch.js'),'utf8');
  src=src.replace('  warmFixed();setInterval','  window.test={playAudioSegment,sayTts,playResolvedSequence,pauseBetween,resolveAnnouncement,unlock,getPrime:()=>primeEl,getGaps:()=>[SEGMENT_GAP_MS,SENTENCE_GAP_MS],setResolver:f=>resolveSegment=f};\n  warmFixed();setInterval');
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
test('recorded clips reuse the exact audio element unlocked by the user tap',async()=>{
  const s=setup();s.api.unlock();await flush();
  const unlocked=s.api.getPrime();assert.equal(s.audios.length,1);
  s.played.length=0;
  for(const url of ['blob:first','blob:second']){
    const ctrl=new AbortController();
    const p=s.api.playAudioSegment({kind:'audio',url},ctrl.signal);
    await flush();assert.equal(s.api.getPrime(),unlocked);assert.equal(unlocked.src,url);
    unlocked.dispatchEvent(new Event('ended'));assert.equal(await p,true);
  }
  assert.equal(s.audios.length,1);assert.deepEqual(s.played,['blob:first','blob:second']);
});
test('touch devices join announcement clips without an added pause',()=>{
  assert.equal(Array.from(setup({touch:true}).api.getGaps()).join(','),'0,0');
  assert.equal(Array.from(setup().api.getGaps()).join(','),'180,450');
});
test('missing English stop recording omits both thisstopis and the English stop pair',async()=>{
  const s=setup();
  s.c.Audio.prototype.play=function(){s.played.push(this.src);queueMicrotask(()=>this.dispatchEvent(new Event('ended')));return Promise.resolve();};
  s.api.setResolver(async(category,key)=>{
    if(key.endsWith(' (1)'))return {kind:'missing',category,key};
    const audio=new s.c.Audio();audio.src=key;return {kind:'audio',audio,category,key};
  });
  const announcement=s.c.announceArrival({name:'첫정류소'},{name:'다음정류소이름'});
  s.played.length=0;
  await announcement;
  assert.deepEqual(s.played,['이번정류소','첫정류소','다음정류소','다음정류소이름']);
  assert.equal(s.played.includes('thisstopis'),false);
});
test('a TTS stop name also gets a TTS English ending when the (1) recording is missing',async()=>{
  const s=setup();
  s.api.setResolver(async(category,key,recordingOnly=false)=>{
    if(key.endsWith(' (1)'))return recordingOnly?{kind:'missing',category,key}:{kind:'tts',text:'English stop',lang:'en-US',category,key};
    if(category==='stops'&&key==='녹음없는정류소')return {kind:'tts',text:key,lang:'ko-KR',category,key};
    return {kind:'audio',url:'blob:'+key,category,key};
  });
  const result=Array.from(await s.api.resolveAnnouncement({name:'녹음없는정류소'},{name:'다음정류소'}));
  assert.deepEqual(result.slice(-2).map(x=>[x.key,x.kind]),[['thisstopis','audio'],['녹음없는정류소 (1)','tts']]);
});
