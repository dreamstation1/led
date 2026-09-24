(function(){
  if(window.__gaplessQueueV43)return; window.__gaplessQueueV43=true;
  const cache=new Map(), inflight=new Map(); let unlocked=false, prime=null;

  function paths(category,key){
    const s=String(key||'').trim(), out=['audio/'+s+'.wav'];
    try{ if(typeof audioPaths==='function'){ const p=audioPaths(category,key); if(Array.isArray(p)) out.push(...p); } }catch(e){}
    return [...new Set(out)].filter(p=>/\.wav(?:$|\?)/i.test(p));
  }
  async function blobUrl(path){
    if(cache.has(path))return cache.get(path);
    if(inflight.has(path))return inflight.get(path);
    const p=(async()=>{try{
      const r=await fetch(path,{cache:'force-cache'}); if(!r.ok)return null;
      const b=await r.blob(); if(!b.size)return null;
      const u=URL.createObjectURL(b); cache.set(path,u); return u;
    }catch(e){return null}finally{inflight.delete(path)}})();
    inflight.set(path,p); return p;
  }
  async function find(category,key){
    for(const p of paths(category,key)){const u=await blobUrl(p);if(u)return {path:p,url:u};}
    return null;
  }
  function tts(category,key){
    if(category==='phrases_en')return {text:key==='thisstopis'?'This stop is':key,lang:'en-US'};
    if(category==='stops'&&/ \(1\)$/.test(key))return {text:String(key).replace(/ \(1\)$/,''),lang:'en-US'};
    if(category==='stops')return {text:String(key)+'입니다',lang:'ko-KR'};
    return {text:({'이번정류소':'이번 정류소는','다음정류소':'다음 정류소는','종점입니다':'종점입니다'})[key]||key,lang:'ko-KR'};
  }
  function nativePlay(url){
    return new Promise(resolve=>{
      const a=new Audio(); a.preload='auto'; a.playsInline=true; a.setAttribute('playsinline','');
      a.src=url; a.volume=typeof guideVolume==='number'?guideVolume:1; a.playbackRate=Math.max(.1,typeof guideRate==='number'?guideRate:1);
      let done=false; const fin=ok=>{if(done)return;done=true;clearTimeout(to);resolve(ok)};
      a.onended=()=>fin(true); a.onerror=()=>fin(false);
      const to=setTimeout(()=>fin(false),120000);
      try{const p=a.play(); if(p&&p.catch)p.catch(()=>fin(false));}catch(e){fin(false)}
    });
  }
  async function speak(seg){try{if(typeof speakText==='function')return await speakText(seg.text,seg.lang)}catch(e){} return false}
  async function segment(category,key){
    const f=await find(category,key);
    if(f){
      // Crucial: if the recording exists but iOS temporarily blocks play(), do NOT replace it with TTS.
      // Keep the segment as recorded audio and retry after a short unlock attempt.
      if(await nativePlay(f.url))return true;
      await unlock(true);
      if(await nativePlay(f.url))return true;
      return false;
    }
    return await speak(tts(category,key));
  }
  async function unlock(force=false){
    if(unlocked&&!force)return;
    try{
      if(!prime){prime=new Audio();prime.playsInline=true;prime.src='audio/thisstopis.wav';prime.preload='auto';prime.volume=0.001;}
      const p=prime.play(); if(p&&p.then)await p; prime.pause(); prime.currentTime=0; unlocked=true;
    }catch(e){}
  }
  ['touchstart','pointerdown','click'].forEach(ev=>document.addEventListener(ev,()=>unlock(),{capture:true,passive:true}));
  window.unlockAudioForMobile=unlock;
  try{
    announceArrival=async function(stop,next){
      if(!guideTtsOn)return;
      const k=stop.audioName||stop.name;
      const seq=[['phrases','이번정류소'],['stops',k],next?['phrases','다음정류소']:['phrases','종점입니다'],...(next?[['stops',next.audioName||next.name]]:[]),['phrases_en','thisstopis'],['stops',k+' (1)']];
      // Resolve/play one by one so Safari is not asked to create six locked Audio elements at once.
      for(const [c,x] of seq)await segment(c,x);
    };
  }catch(e){console.error('v43 recorded audio override failed',e)}
})();