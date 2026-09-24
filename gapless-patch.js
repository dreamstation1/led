(function(){
  if(window.__gaplessQueueV40)return;
  window.__gaplessQueueV40=true;

  const BufferCache=new Map();
  const LoadCache=new Map();
  let ctx=null;
  let unlockStarted=false;

  function getCtx(){
    if(ctx)return ctx;
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC)return null;
    try{ctx=new AC({latencyHint:'interactive'});}catch(e){try{ctx=new AC();}catch(_){return null;}}
    window.__guideAudioContext=ctx;
    return ctx;
  }

  function pathsFor(category,key){
    try{
      if(typeof audioPaths==='function'){
        const p=audioPaths(category,key);
        if(Array.isArray(p)&&p.length)return p;
      }
    }catch(e){}
    const s=String(key||'');
    return ['audio/'+s+'.wav','audio/'+s+'.mp3','audio/'+category+'/'+s+'.wav','audio/'+category+'/'+s+'.mp3'];
  }

  function decode(c,ab){
    return new Promise((resolve,reject)=>{
      let done=false;
      const ok=b=>{if(done)return;done=true;resolve(b);};
      const bad=e=>{if(done)return;done=true;reject(e);};
      try{
        const p=c.decodeAudioData(ab.slice(0),ok,bad);
        if(p&&p.then)p.then(ok,bad);
      }catch(e){bad(e);}
    });
  }

  async function loadBuffer(src){
    if(BufferCache.has(src))return BufferCache.get(src);
    if(LoadCache.has(src))return LoadCache.get(src);
    const p=(async()=>{
      try{
        const c=getCtx();if(!c)return null;
        const r=await fetch(src,{cache:'force-cache'});
        if(!r.ok)return null;
        const b=await decode(c,await r.arrayBuffer());
        BufferCache.set(src,b);
        return b;
      }catch(e){return null;}
      finally{LoadCache.delete(src);}
    })();
    LoadCache.set(src,p);
    return p;
  }

  async function firstBuffer(paths){
    if(!Array.isArray(paths)||!paths.length)return null;
    // Try in order. Flat WAV is first, so iPhone/iPad do not waste requests on dead candidates.
    for(const p of paths){
      const b=await loadBuffer(p);
      if(b)return {path:p,buffer:b};
    }
    return null;
  }

  async function ttsInfo(category,key){
    if(category==='phrases_en')return {text:key==='thisstopis'?'This stop is':key,lang:'en-US'};
    if(category==='stops'&&/ \(1\)$/.test(key)){
      const name=key.replace(/ \(1\)$/,'');
      try{return {text:await translateStationName(name),lang:'en-US'};}catch(e){return {text:name,lang:'en-US'};}
    }
    if(category==='stops')return {text:String(key).replace(/ \(1\)$/,'')+'입니다',lang:'ko-KR'};
    const m={'이번정류소':'이번 정류소는','다음정류소':'다음 정류소는','종점입니다':'종점입니다'};
    return {text:m[key]||key,lang:'ko-KR'};
  }

  async function resolveSegment(category,key){
    const found=await firstBuffer(pathsFor(category,key));
    if(found)return {kind:'audio',buffer:found.buffer,category,key};
    const t=await ttsInfo(category,key);
    return {kind:'tts',text:t.text,lang:t.lang,category,key};
  }

  async function ensureRunning(){
    const c=getCtx();if(!c)return null;
    try{if(c.state==='suspended')await c.resume();}catch(e){}
    return c;
  }

  function playBuffer(buffer,when=0){
    return new Promise(async resolve=>{
      const c=await ensureRunning();if(!c||!buffer){resolve(false);return;}
      try{
        const src=c.createBufferSource();
        const gain=c.createGain();
        const rate=Math.max(.1,typeof guideRate==='number'?guideRate:1);
        src.buffer=buffer;src.playbackRate.value=rate;
        gain.gain.value=typeof guideVolume==='number'?guideVolume:1;
        src.connect(gain);gain.connect(c.destination);
        let done=false;
        const finish=ok=>{if(done)return;done=true;clearTimeout(timer);resolve(ok);};
        src.onended=()=>finish(true);
        const dur=Math.max(.1,buffer.duration/rate);
        const timer=setTimeout(()=>finish(false),(dur+5)*1000);
        src.start(c.currentTime+Math.max(0,when));
      }catch(e){resolve(false);}
    });
  }

  async function sayTts(seg){
    try{if(typeof speakText==='function')return await speakText(seg.text,seg.lang);}catch(e){}
    return false;
  }

  async function playResolvedSequence(items){
    for(const seg of items){
      if(seg.kind==='audio')await playBuffer(seg.buffer);
      else await sayTts(seg);
    }
  }

  function warmSegment(category,key){
    try{
      const p=pathsFor(category,key);
      if(Array.isArray(p)&&p.length)loadBuffer(p[0]);
    }catch(e){}
  }
  function warmFixed(){
    warmSegment('phrases','이번정류소');
    warmSegment('phrases','다음정류소');
    warmSegment('phrases','종점입니다');
    warmSegment('phrases_en','thisstopis');
  }
  function warmUpcoming(){
    try{
      if(!Array.isArray(currentGuideStops))return;
      const idx=Math.max(0,Number(guideNextIndex)||0);
      for(let i=Math.max(0,idx-1);i<Math.min(currentGuideStops.length,idx+3);i++){
        const s=currentGuideStops[i],k=s.audioName||s.name;
        warmSegment('stops',k);
        warmSegment('stops',k+' (1)');
      }
    }catch(e){}
  }

  async function unlock(){
    const c=getCtx();
    if(c){
      try{if(c.state==='suspended')await c.resume();}catch(e){}
      // iOS/iPadOS: start an actual zero-gain WebAudio source in the user gesture.
      if(!unlockStarted){
        unlockStarted=true;
        try{
          const b=c.createBuffer(1,1,22050),s=c.createBufferSource(),g=c.createGain();
          g.gain.value=0;s.buffer=b;s.connect(g);g.connect(c.destination);s.start(0);
        }catch(e){}
      }
    }
    warmFixed();warmUpcoming();
  }

  document.addEventListener('touchstart',unlock,{capture:true,passive:true});
  document.addEventListener('pointerdown',unlock,{capture:true,passive:true});
  document.addEventListener('click',unlock,{capture:true,passive:true});
  window.unlockAudioForMobile=unlock;

  try{
    announceArrival=async function(stop,next){
      if(!guideTtsOn)return;
      await unlock();
      const stopKey=stop.audioName||stop.name;
      const specs=[
        ['phrases','이번정류소'],
        ['stops',stopKey],
        next?['phrases','다음정류소']:['phrases','종점입니다'],
        ...(next?[['stops',next.audioName||next.name]]:[]),
        ['phrases_en','thisstopis'],
        ['stops',stopKey+' (1)']
      ];
      const resolved=[];
      for(const s of specs)resolved.push(await resolveSegment(s[0],s[1]));
      await playResolvedSequence(resolved);
    };
  }catch(e){console.error('native WebAudio announcement override failed',e);}

  warmFixed();
  setInterval(warmUpcoming,1500);
})();