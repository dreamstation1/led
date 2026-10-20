const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'gapless-patch.js'),'utf8');
const helper=source.slice(source.indexOf('  const ENGLISH_TTS_EXTRA_PROBABILITY='),source.indexOf('  let primeEl='));
const playback=source.slice(source.indexOf('  async function playResolvedSequence('),source.indexOf('  // 파일을 받아두는'));
const events=[];let fetches=0,missing=false,random=()=>0;
const ctx={window:{LED_BASE:'/led/'},Math:Object.create(Math),loadBlobUrl:async url=>{fetches++;return missing?null:url;},audioSegment:async(url,extra)=>({kind:'audio',url,...extra}),SEGMENT_GAP_MS:180,SENTENCE_GAP_MS:450,audioCtx:()=>null,guideRate:1,sayTts:async()=>{await Promise.resolve();events.push('tts-ended');},playAudioSegment:async s=>events.push(s.category),pauseBetween:async ms=>events.push(ms)};
ctx.Math.random=()=>random();
vm.createContext(ctx);vm.runInContext(helper+playback+';this.choose=chooseEnglishTtsExtra;this.append=appendEnglishTtsExtra;this.play=playResolvedSequence;',ctx);
const tts={kind:'tts',category:'stops',key:'테스트 (1)'};
const ai={kind:'audio',ai:true,category:'stops',key:'테스트 (1)'};
const recorded={kind:'audio',category:'stops',key:'테스트 (1)'};
(async()=>{
 for(const seg of [recorded,{...tts,key:'테스트'},{...tts,category:'phrases_en'}])assert.equal(ctx.choose(seg,()=>{throw Error('must not draw');}),null);
 assert.equal(ctx.choose(tts,()=>.7),null);
 assert.equal(ctx.choose(tts,()=>1),null);
 const draw=(a,b)=>{let n=0;return ()=>n++?b:a;};
 assert.equal(ctx.choose(tts,draw(.699999,0)),'audio/tts-extra-01.wav');
 assert.equal(ctx.choose(ai,draw(0,.99999)),'audio/tts-extra-28.wav');
 // Each call draws afresh, with repeats allowed.
 assert.equal(ctx.choose(tts,draw(0,.5)),ctx.choose(tts,draw(0,.5)));
 let seed=42,selected=0;const counts=Array(28).fill(0);
 const rng=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
 for(let i=0;i<100000;i++){const p=ctx.choose(tts,rng);if(p){selected++;counts[Number(p.match(/(\d+)\.wav$/)[1])-1]++;}}
 assert.ok(Math.abs(selected/100000-.7)<.005);assert.ok(counts.every(n=>n>2250&&n<2750));
 const list=[{category:'phrases'},tts,{kind:'audio',category:'phrases',key:'종착'}];
 await ctx.append(list);assert.equal(list[2].category,'extras');assert.equal(list[2].immediate,true);assert.equal(list[3].key,'종착');assert.equal(list[2].url,'/led/audio/tts-extra-01.wav');
 fetches=0;await ctx.append([recorded]);assert.equal(fetches,0);
 missing=true;const failed=[tts];await ctx.append(failed);assert.equal(failed.length,1);missing=false;
 random=()=>.9;const noExtra=[ai];await ctx.append(noExtra);assert.equal(noExtra.length,1);
 events.length=0;await ctx.play([tts,{kind:'audio',category:'extras',immediate:true}],new AbortController().signal);assert.deepEqual(events,['tts-ended',0,'extras']);
 const abort=new AbortController();abort.abort();events.length=0;await ctx.play(list,abort.signal);assert.deepEqual(events,[]);
 const pool=JSON.parse(fs.readFileSync(path.join(root,'audio-tts-extras.json')));assert.equal(pool.probability,.7);assert.equal(pool.clips.length,28);
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'audio-files.json')));
 for(const clip of pool.clips){assert.ok(manifest.includes(clip.path.slice(6)));const b=fs.readFileSync(path.join(root,clip.path));assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.toString('ascii',8,12),'WAVE');assert.ok(clip.duration>3&&clip.duration<18);assert.ok(!clip.title.includes('집수리'));}
 console.log('PASS: recorded/TTS/AI eligibility, 70% gate, uniform independent selection, repeats, terminal insertion, optional failure, completion order, immediate join, cancellation, 28 WAV assets and manifest');
})().catch(e=>{console.error(e);process.exitCode=1;});
