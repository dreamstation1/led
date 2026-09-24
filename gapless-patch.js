(function(){
  if(window.__gaplessQueueV41)return;
  window.__gaplessQueueV41=true;

  const BlobCache=new Map();
  const LoadCache=new Map();
  const AUDIO_OVERLAP_MS=45;
  const TTS_PRETRIGGER_MS=100;

  function exactPaths(category,key){
    const s=String(key||'').trim();
    const out=[];
    // Repository recordings are flat files under /audio. Always try the exact WAV first.
    out.push('audio/'+s+'.wav');
    // Keep legacy candidates only after the exact flat WAV.
    try{
      if(typeof audioPaths==='function'){
        const p=audioPaths(category,key);
        if(Array.isArray(p))out.push(...p);
      }
    }catch(e){}
    return [...new Set(out)].filter(p=>/\.wav(?:$|\?)/i.test(p));
  }

  async function loadBlobUrl(src){
    if(BlobCache.has(src))return BlobCache.get(src);
    if(LoadCache.has(src))return LoadCache.get(src);
    const p=(async()=>{
      try{
        const r=await fetch(src,{cache:'force-cache'});
        if(!r.ok)return null;
        const blob=await r.blob();
        if(!blob||!blob.size)return null;
        const url=URL.createObjectURL(blob);
        BlobCache.set(src,url);
        return url;
      }catch(e){return null;}
      finally{LoadCache.delete(src);}
    })();
    LoadCache.set(src,p);return p;
  }

  function prepareAudio(url){
    return new Promise(resolve=>{
      const a=new Audio();
      a.preload='auto';a.playsInline=true;
      a.setAttribute('playsinline','');a.setAttribute('webkit-playsinline','');
      a.src=url;
      let done=false;
      const finish=ok=>{if(done)return;done=true;clearTimeout(timer);resolve(ok?a:null);};
      const timer=setTimeout(()=>finish(a.readyState>=1),5000);
      a.addEventListener('loadedmetadata',()=>finish(true),{once:true});
      a.addEventListener('canplay',()=>finish(true),{once:true});
      a.addEventListener('error',()=>finish(false),{once:true});
      try{a.load();}catch(e){finish(false);}
    });
  }

  async function firstAudio(category,key){
    for(const path of exactPaths(category,key)){
      const url=await loadBlobUrl(path);
      if(!url)continue;
      const audio=await prepareAudio(url);
      if(audio)return {path,audio};
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
    const found=await firstAudio(category,key);
    if(found)return {kind:'audio',audio:found.audio,path:found.path,category,key};
    const t=await ttsInfo(category,key);
    return {kind:'tts',text:t.text,lang:t.lang,category,key};
  }

  async function sayTts(seg){
    try{if(typeof speakText==='function')return await speakText(seg.text,seg.lang);}catch(e){}
    return false;
  }

  async function playAudio(a){
    return await new Promise(resolve=>{
      let done=false;
      const finish=ok=>{if(done)return;done=true;clearTimeout(timer);resolve(ok);};
      a.currentTime=0;
      a.playbackRate=Math.max(.1,typeof guideRate==='number'?guideRate:1);
      a.volume=typeof guideVolume==='number'?guideVolume:1;
      a.addEventListener('ended',()=>finish(true),{once:true});
      a.addEventListener('error',()=>finish(false),{once:true});
      const timer=setTimeout(()=>finish(false),120000);
      try{const p=a.play();if(p&&p.catch)p.catch(()=>finish(false));}catch(e){finish(false);}
    });
  }

  async function playResolvedSequence(items){
    for(let i=0;i<items.length;i++){
      const seg=items[i];
      if(seg.kind==='audio'){
        const next=items[i+1];
        if(next&&next.kind==='audio'&&Number.isFinite(seg.audio.duration)){
          const wait=Math.max(0,(seg.audio.duration/Math.max(.1,seg.audio.playbackRate||1))*1000-AUDIO_OVERLAP_MS);
          let nextStarted=false;
          const timer=setTimeout(()=>{nextStarted=true;playAudio(next.audio);},wait);
          await playAudio(seg.audio);clearTimeout(timer);
          if(nextStarted)i++;
        }else if(next&&next.kind==='tts'&&Number.isFinite(seg.audio.duration)){
          let p=null;
          const wait=Math.max(0,(seg.audio.duration/Math.max(.1,seg.audio.playbackRate||1))*1000-TTS_PRETRIGGER_MS);
          const timer=setTimeout(()=>{p=sayTts(next);},wait);
          await playAudio(seg.audio);clearTimeout(timer);
          if(!p)p=sayTts(next);await p;i++;
        }else await playAudio(seg.audio);
      }else await sayTts(seg);
    }
  }

  function warm(category,key){exactPaths(category,key).slice(0,1).forEach(loadBlobUrl);}
  function warmFixed(){warm('phrases','이번정류소');warm('phrases','다음정류소');warm('phrases','종점입니다');warm('phrases_en','thisstopis');}
  function warmUpcoming(){
    try{
      if(!Array.isArray(currentGuideStops))return;
      const idx=Math.max(0,Number(guideNextIndex)||0);
      for(let i=Math.max(0,idx-1);i<Math.min(currentGuideStops.length,idx+3);i++){
        const s=currentGuideStops[i],k=s.audioName||s.name;
        warm('stops',k);warm('stops',k+' (1)');
      }
    }catch(e){}
  }

  function unlock(){
    warmFixed();warmUpcoming();
    try{
      const a=new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=');
      a.volume=0;a.playsInline=true;const p=a.play();if(p&&p.then)p.then(()=>a.pause()).catch(()=>{});
    }catch(e){}
  }
  document.addEventListener('touchstart',unlock,{capture:true,passive:true});
  document.addEventListener('pointerdown',unlock,{capture:true,passive:true});
  document.addEventListener('click',unlock,{capture:true,passive:true});
  window.unlockAudioForMobile=unlock;

  try{
    announceArrival=async function(stop,next){
      if(!guideTtsOn)return;
      unlock();
      const stopKey=stop.audioName||stop.name;
      const specs=[['phrases','이번정류소'],['stops',stopKey],next?['phrases','다음정류소']:['phrases','종점입니다'],...(next?[['stops',next.audioName||next.name]]:[]),['phrases_en','thisstopis'],['stops',stopKey+' (1)']];
      const resolved=await Promise.all(specs.map(s=>resolveSegment(s[0],s[1])));
      await playResolvedSequence(resolved);
    };
  }catch(e){console.error('recorded-audio announcement override failed',e);}

  warmFixed();setInterval(warmUpcoming,1500);
})();