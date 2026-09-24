(function(){
  if(window.__gaplessQueueV45)return;
  window.__gaplessQueueV45=true;

  const BlobCache=new Map();
  const LoadCache=new Map();
  const AUDIO_OVERLAP_SEC=0;
  const TTS_PRETRIGGER_SEC=0;
  let primeEl=null;

  function pathsFor(category,key){
    try{if(typeof audioPaths==='function')return audioPaths(category,key)||[];}catch(e){}
    const s=String(key||'');
    return ['audio/'+s+'.wav','audio/'+s+'.mp3','audio/'+category+'/'+s+'.wav','audio/'+category+'/'+s+'.mp3'];
  }

  async function loadBlobUrl(src){
    if(BlobCache.has(src))return BlobCache.get(src);
    if(LoadCache.has(src))return LoadCache.get(src);
    const p=(async()=>{
      try{
        const r=await fetch(src,{cache:'force-cache'});
        if(!r.ok)return null;
        const blob=await r.blob();
        const url=URL.createObjectURL(blob);
        BlobCache.set(src,url);
        return url;
      }catch(e){return null;}
      finally{LoadCache.delete(src);}
    })();
    LoadCache.set(src,p);
    return p;
  }

  async function firstPlayable(paths){
    if(!Array.isArray(paths)||!paths.length)return null;
    const jobs=paths.map(async p=>({path:p,url:await loadBlobUrl(p)}));
    const all=await Promise.all(jobs);
    return all.find(x=>x.url)||null;
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

  function prepareAudio(url){
    return new Promise(resolve=>{
      const a=new Audio();
      a.preload='auto';
      a.playsInline=true;
      a.setAttribute('playsinline','');
      a.setAttribute('webkit-playsinline','');
      a.src=url;
      let done=false;
      const finish=ok=>{if(done)return;done=true;clearTimeout(timer);resolve(ok?a:null);};
      const timer=setTimeout(()=>finish(a.readyState>=1),5000);
      a.addEventListener('loadedmetadata',()=>finish(true),{once:true});
      a.addEventListener('canplaythrough',()=>finish(true),{once:true});
      a.addEventListener('error',()=>finish(false),{once:true});
      try{a.load();}catch(e){finish(false);}
    });
  }

  async function resolveSegment(category,key){
    const found=await firstPlayable(pathsFor(category,key));
    if(found){
      const audio=await prepareAudio(found.url);
      if(audio)return {kind:'audio',audio,category,key};
    }
    const t=await ttsInfo(category,key);
    return {kind:'tts',text:t.text,lang:t.lang,category,key};
  }

  async function sayTts(seg){
    try{if(typeof speakText==='function')return await speakText(seg.text,seg.lang);}catch(e){}
    return false;
  }

  function playAudioRun(run,onBeforeEnd){
    return new Promise(resolve=>{
      if(!run.length){resolve(false);return;}
      const rate=Math.max(0.1,typeof guideRate==='number'?guideRate:1);
      const vol=typeof guideVolume==='number'?guideVolume:1;
      const starts=[];
      let t=0;
      for(let i=0;i<run.length;i++){
        const a=run[i].audio;
        a.playbackRate=rate;a.volume=vol;a.currentTime=0;
        starts.push(Math.max(0,t));
        const d=Number.isFinite(a.duration)?a.duration/rate:0;
        t=Math.max(0,t+d-AUDIO_OVERLAP_SEC);
      }
      const last=run[run.length-1].audio;
      let settled=false;
      const timers=[];
      const finish=ok=>{if(settled)return;settled=true;timers.forEach(clearTimeout);resolve(ok);};
      run.forEach((item,i)=>{
        timers.push(setTimeout(()=>{
          try{const p=item.audio.play();if(p&&p.catch)p.catch(()=>{});}catch(e){}
        },Math.round(starts[i]*1000)));
      });
      if(onBeforeEnd){
        const finalDur=Number.isFinite(last.duration)?last.duration/rate:0;
        const trigger=Math.max(0,(starts[starts.length-1]+finalDur-TTS_PRETRIGGER_SEC)*1000);
        timers.push(setTimeout(()=>{try{onBeforeEnd();}catch(e){}},trigger));
      }
      last.addEventListener('ended',()=>finish(true),{once:true});
      timers.push(setTimeout(()=>finish(false),Math.max(2000,(t+5)*1000)));
    });
  }

  async function playResolvedSequence(items){
    let i=0;
    while(i<items.length){
      if(items[i].kind==='tts'){
        await sayTts(items[i]);i++;continue;
      }
      const run=[];
      while(i<items.length&&items[i].kind==='audio'){run.push(items[i]);i++;}
      if(i<items.length&&items[i].kind==='tts'){
        const seg=items[i];let p=null;
        await playAudioRun(run,()=>{p=sayTts(seg);});
        if(!p)p=sayTts(seg);
        await p;i++;
      }else await playAudioRun(run,null);
    }
  }

  function warmSegment(category,key){try{pathsFor(category,key).forEach(loadBlobUrl);}catch(e){}}
  function warmFixed(){
    warmSegment('phrases','이번정류소');warmSegment('phrases','다음정류소');
    warmSegment('phrases','종점입니다');warmSegment('phrases_en','thisstopis');
  }
  function warmUpcoming(){
    try{
      if(!Array.isArray(currentGuideStops))return;
      const idx=Math.max(0,Number(guideNextIndex)||0);
      for(let i=Math.max(0,idx-1);i<Math.min(currentGuideStops.length,idx+3);i++){
        const s=currentGuideStops[i],k=s.audioName||s.name;
        warmSegment('stops',k);warmSegment('stops',k+' (1)');
      }
    }catch(e){}
  }

  function unlock(){
    warmFixed();warmUpcoming();
    if(primeEl)return;
    try{
      primeEl=new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=');
      primeEl.volume=0;primeEl.playsInline=true;
      const p=primeEl.play();if(p&&p.then)p.then(()=>{try{primeEl.pause();}catch(e){}}).catch(()=>{});
    }catch(e){}
  }
  document.addEventListener('touchstart',unlock,{capture:true,passive:true});
  document.addEventListener('pointerdown',unlock,{capture:true,passive:true});
  document.addEventListener('click',unlock,{capture:true,passive:true});

  try{
    announceArrival=async function(stop,next){
      if(!guideTtsOn)return;
      unlock();
      const stopKey=stop.audioName||stop.name;
      const specs=[['phrases','이번정류소'],['stops',stopKey],next?['phrases','다음정류소']:['phrases','종점입니다'],...(next?[['stops',next.audioName||next.name]]:[]),['phrases_en','thisstopis'],['stops',stopKey+' (1)']];
      const resolved=await Promise.all(specs.map(s=>resolveSegment(s[0],s[1])));
      await playResolvedSequence(resolved);
    };
  }catch(e){console.error('native gapless announcement override failed',e);}

  warmFixed();setInterval(warmUpcoming,1200);
})();
