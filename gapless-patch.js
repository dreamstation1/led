(function(){
  if(window.__gaplessQueueV30)return;
  window.__gaplessQueueV30=true;

  const BufferCache=new Map();
  const LoadCache=new Map();
  let ctx=null;
  let warmingTimer=null;
  const AUDIO_OVERLAP_SEC=0.045;
  const TTS_PRETRIGGER_SEC=0.12;

  function getCtx(){
    if(ctx)return ctx;
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC)return null;
    ctx=new AC();
    window.__guideGaplessContext=ctx;
    return ctx;
  }

  async function decode(c,ab){
    return await new Promise((resolve,reject)=>{
      let done=false;
      const ok=b=>{if(!done){done=true;resolve(b);}};
      const bad=e=>{if(!done){done=true;reject(e);}};
      try{
        const p=c.decodeAudioData(ab.slice(0),ok,bad);
        if(p&&p.then)p.then(ok,bad);
      }catch(e){bad(e);}
    });
  }

  function loadBuffer(src){
    if(!src)return Promise.resolve(null);
    if(BufferCache.has(src))return Promise.resolve(BufferCache.get(src));
    if(LoadCache.has(src))return LoadCache.get(src);
    const p=(async()=>{
      try{
        const c=getCtx();
        if(!c)return null;
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
    const loads=paths.map(loadBuffer);
    for(let i=0;i<loads.length;i++){
      const b=await loads[i];
      if(b)return {buffer:b,path:paths[i]};
    }
    return null;
  }

  function pathsFor(category,key){
    try{
      if(typeof audioPaths==='function')return audioPaths(category,key)||[];
    }catch(e){}
    const safe=String(key||'');
    return ['audio/'+safe+'.wav','audio/'+safe+'.mp3','audio/'+category+'/'+safe+'.wav','audio/'+category+'/'+safe+'.mp3'];
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
    const clip=await firstBuffer(pathsFor(category,key));
    if(clip)return {kind:'audio',buffer:clip.buffer,category,key};
    const t=await ttsInfo(category,key);
    return {kind:'tts',text:t.text,lang:t.lang,category,key};
  }

  function playAudioRun(run,onBeforeEnd){
    return new Promise(async resolve=>{
      const c=getCtx();
      if(!c||!run.length){resolve(false);return;}
      try{if(c.state==='suspended')await c.resume();}catch(e){}
      const rate=Math.max(0.1,typeof guideRate==='number'?guideRate:1);
      const volume=typeof guideVolume==='number'?guideVolume:1;
      let start=c.currentTime+0.025;
      let end=start;
      let last=null;
      try{
        for(let i=0;i<run.length;i++){
          const item=run[i];
          const src=c.createBufferSource();
          const gain=c.createGain();
          src.buffer=item.buffer;
          src.playbackRate.value=rate;
          gain.gain.value=volume;
          src.connect(gain);gain.connect(c.destination);
          if(i>0)start=Math.max(c.currentTime+0.002,end-AUDIO_OVERLAP_SEC);
          src.start(start);
          end=start+(item.buffer.duration/rate);
          last=src;
        }
      }catch(e){resolve(false);return;}

      if(onBeforeEnd){
        const delay=Math.max(0,(end-c.currentTime-TTS_PRETRIGGER_SEC)*1000);
        setTimeout(()=>{try{onBeforeEnd();}catch(e){}},delay);
      }
      if(!last){resolve(false);return;}
      let settled=false;
      const watchdog=setTimeout(()=>{if(!settled){settled=true;resolve(false);}},Math.max(1000,(end-c.currentTime+2)*1000));
      last.onended=()=>{if(settled)return;settled=true;clearTimeout(watchdog);resolve(true);};
    });
  }

  async function sayTts(seg){
    try{
      if(typeof speakText==='function')return await speakText(seg.text,seg.lang);
    }catch(e){}
    return false;
  }

  async function playResolvedSequence(items){
    let i=0;
    while(i<items.length){
      if(items[i].kind==='tts'){
        await sayTts(items[i]);
        i++;
        continue;
      }
      const run=[];
      while(i<items.length&&items[i].kind==='audio'){
        run.push(items[i]);
        i++;
      }
      if(i<items.length&&items[i].kind==='tts'){
        const ttsSeg=items[i];
        let ttsPromise=null;
        await playAudioRun(run,()=>{ttsPromise=sayTts(ttsSeg);});
        if(!ttsPromise)ttsPromise=sayTts(ttsSeg);
        await ttsPromise;
        i++;
      }else{
        await playAudioRun(run,null);
      }
    }
  }

  function warmSegment(category,key){
    try{pathsFor(category,key).forEach(loadBuffer);}catch(e){}
  }
  function warmFixed(){
    warmSegment('phrases','이번정류소');
    warmSegment('phrases','다음정류소');
    warmSegment('phrases','종점입니다');
    warmSegment('phrases_en','thisstopis');
  }
  function warmUpcoming(){
    try{
      if(!Array.isArray(currentGuideStops)||!currentGuideStops.length)return;
      const idx=Math.max(0,Number(guideNextIndex)||0);
      for(let i=Math.max(0,idx-1);i<Math.min(currentGuideStops.length,idx+3);i++){
        const s=currentGuideStops[i];
        const k=s.audioName||s.name;
        warmSegment('stops',k);
        warmSegment('stops',k+' (1)');
      }
    }catch(e){}
  }

  function unlock(){
    const c=getCtx();
    try{if(c&&c.state==='suspended')c.resume();}catch(e){}
    warmFixed();warmUpcoming();
  }
  document.addEventListener('pointerdown',unlock,{capture:true,passive:true});
  document.addEventListener('touchstart',unlock,{capture:true,passive:true});
  document.addEventListener('click',unlock,{capture:true,passive:true});

  try{
    announceArrival=async function(stop,next){
      if(!guideTtsOn)return;
      unlock();
      const stopKey=stop.audioName||stop.name;
      const specs=[
        ['phrases','이번정류소'],
        ['stops',stopKey],
        next?['phrases','다음정류소']:['phrases','종점입니다'],
        ...(next?[['stops',next.audioName||next.name]]:[]),
        ['phrases_en','thisstopis'],
        ['stops',stopKey+' (1)']
      ];
      // Resolve and decode every segment before the first clip starts. Once playback
      // begins, there is no network/decode wait between files on iPhone.
      const resolved=await Promise.all(specs.map(s=>resolveSegment(s[0],s[1])));
      await playResolvedSequence(resolved);
    };
  }catch(e){console.error('gapless announcement override failed',e);}

  warmFixed();
  warmingTimer=setInterval(()=>{warmUpcoming();},1200);
})();