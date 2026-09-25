(function(){
  if(window.__gaplessQueueV50)return;
  window.__gaplessQueueV50=true;

  const BlobCache=new Map();
  const LoadCache=new Map();
  const SEGMENT_GAP_MS=180;
  const SENTENCE_GAP_MS=450;
  let primeEl=null;
  let announcement=null;
  window.cancelGuideAnnouncement=function(){
    if(announcement)announcement.abort();
    announcement=null;
  };

  function pauseBetween(ms,signal){
    return new Promise(resolve=>{
      if(signal.aborted){resolve();return;}
      const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};
      const timer=setTimeout(done,ms);
      signal.addEventListener('abort',done,{once:true});
    });
  }

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

  function sayTts(seg,signal){
    return new Promise(resolve=>{
      if(signal.aborted||!window.speechSynthesis){resolve(false);return;}
      let settled=false,timer;
      const u=new SpeechSynthesisUtterance(seg.text);
      u.lang=seg.lang;u.volume=guideVolume;u.rate=guideRate;
      const finish=ok=>{
        if(settled)return;settled=true;clearTimeout(timer);
        signal.removeEventListener('abort',cancel);
        u.onend=u.onerror=null;
        if(!ok)window.speechSynthesis.cancel();
        resolve(ok);
      };
      const cancel=()=>finish(false);
      u.onend=()=>finish(true);u.onerror=cancel;
      signal.addEventListener('abort',cancel,{once:true});
      timer=setTimeout(cancel,Math.max(30000,seg.text.length*1000/Math.max(.1,guideRate)));
      try{window.speechSynthesis.speak(u);}catch(e){cancel();}
    });
  }

  function playAudioSegment(seg,signal){
    return new Promise(resolve=>{
      if(signal.aborted){resolve(false);return;}
      const rate=Math.max(0.1,typeof guideRate==='number'?guideRate:1);
      const a=seg.audio;
      a.playbackRate=rate;a.volume=typeof guideVolume==='number'?guideVolume:1;a.currentTime=0;
      let settled=false,timer;
      const ended=()=>finish(true),failed=()=>finish(false);
      const finish=ok=>{
        if(settled)return;settled=true;clearTimeout(timer);
        a.removeEventListener('ended',ended);a.removeEventListener('error',failed);
        signal.removeEventListener('abort',failed);
        if(!ok)a.pause();
        resolve(ok);
      };
      a.addEventListener('ended',ended,{once:true});
      a.addEventListener('error',failed,{once:true});
      signal.addEventListener('abort',failed,{once:true});
      timer=setTimeout(failed,Math.max(5000,((Number.isFinite(a.duration)?a.duration/rate:30)+5)*1000));
      try{const p=a.play();if(p&&p.catch)p.catch(failed);}catch(e){failed();}
    });
  }

  async function playResolvedSequence(items,signal){
    for(let i=0;i<items.length;i++){
      if(signal.aborted)return;
      const seg=items[i];
      if(seg.kind==='tts')await sayTts(seg,signal);
      else await playAudioSegment(seg,signal);
      if(signal.aborted)return;
      if(i+1<items.length){
        // Keep phrase/name joins short, but breathe between complete sentences.
        // Wait for actual playback completion, including recorded/TTS transitions.
        const sentenceEnd=seg.category==='stops'||seg.key==='종점입니다';
        await pauseBetween(sentenceEnd?SENTENCE_GAP_MS:SEGMENT_GAP_MS,signal);
      }
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
      window.cancelGuideAnnouncement();
      if(!guideTtsOn)return;
      const controller=new AbortController();
      announcement=controller;
      unlock();
      const stopKey=stop.audioName||stop.name;
      const specs=[['phrases','이번정류소'],['stops',stopKey],next?['phrases','다음정류소']:['phrases','종점입니다'],...(next?[['stops',next.audioName||next.name]]:[]),['phrases_en','thisstopis'],['stops',stopKey+' (1)']];
      try{
        const resolved=await Promise.all(specs.map(s=>resolveSegment(s[0],s[1])));
        if(controller.signal.aborted)return;
        await playResolvedSequence(resolved,controller.signal);
      }finally{
        if(announcement===controller)announcement=null;
      }
    };
  }catch(e){console.error('native gapless announcement override failed',e);}

  warmFixed();setInterval(warmUpcoming,1200);
})();
