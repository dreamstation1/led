(function(){
  if(window.__gaplessQueueV57)return;
  window.__gaplessQueueV57=true;

  const BlobCache=new Map();
  const LoadCache=new Map();
  const TOUCH_DEVICE=(()=>{try{return navigator.maxTouchPoints>0||matchMedia('(pointer:coarse)').matches||/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);}catch(e){return false;}})();
  const SEGMENT_GAP_MS=TOUCH_DEVICE?0:180;
  const SENTENCE_GAP_MS=TOUCH_DEVICE?0:450;
  let primeEl=null;
  let announcement=null;
  window.cancelGuideAnnouncement=function(){
    if(announcement)announcement.abort();
    announcement=null;
  };

  function pauseBetween(ms,signal){
    return new Promise(resolve=>{
      if(signal.aborted||ms<=0){resolve();return;}
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

  // 녹음 파일이 없을 때 브라우저 TTS 대신 직접 학습한 AI 목소리(GPT-SoVITS api_v2)로
  // 그 자리에서 만들어 재생한다. 서버 주소는 기본 http://127.0.0.1:9880 이고
  // 주소창에 ?aitts=https://... 를 붙여 열면 그 주소로 바뀌어 저장된다 (?aitts= 빈 값이면 초기화).
  // 서버가 꺼져 있거나 실패하면 1분 동안은 시도하지 않고 기존 브라우저 TTS로 넘어간다.
  const AI_TTS_KEY='aiTtsUrl';
  const AI_TTS_DEFAULT='http://127.0.0.1:9880';
  // 참고 음성은 GPT-SoVITS 폴더 기준 경로 (서버 PC 안에 있는 파일)
  const AI_TTS_REF={
    ko:{ref_audio_path:'custom_ui/refs/bus_ref_ko.wav',prompt_text:'강서면허시험장 강서농수산물시장입니다.',prompt_lang:'ko'},
    en:{ref_audio_path:'custom_ui/refs/bus_ref_en.wav',prompt_text:'Mokdong Complex 5, Arcade C, Mokdong Stadium, North Gate.',prompt_lang:'en'}
  };
  // 한국어 모델은 영문자를 못 읽어서 한글 읽기로 바꿔 보낸다 (CTS -> 씨티에스)
  const LATIN_KO={A:'에이',B:'비',C:'씨',D:'디',E:'이',F:'에프',G:'지',H:'에이치',I:'아이',J:'제이',K:'케이',L:'엘',M:'엠',N:'엔',O:'오',P:'피',Q:'큐',R:'알',S:'에스',T:'티',U:'유',V:'브이',W:'더블유',X:'엑스',Y:'와이',Z:'제트'};
  function koreanizeLatin(s){
    return s.replace(/APT/gi,'아파트').replace(/&/g,'앤')
      .replace(/[A-Za-z]+/g,w=>[...w.toUpperCase()].map(c=>LATIN_KO[c]||c).join(''));
  }
  const AiCache=new Map();
  let aiDownUntil=0;
  function aiTtsBase(){
    let v=null;
    try{
      const q=new URLSearchParams(location.search).get('aitts');
      if(q!==null){if(q)localStorage.setItem(AI_TTS_KEY,q);else localStorage.removeItem(AI_TTS_KEY);}
      v=localStorage.getItem(AI_TTS_KEY);
    }catch(e){}
    return String(v||AI_TTS_DEFAULT).replace(/\/+$/,'');
  }
  function aiSynth(text,lang){
    const textLang=/^en/i.test(lang||'')?'en':'ko';
    // '가양역1번출구.우성아파트' 의 점은 읽을 때 쉼표처럼 살짝 끊어 읽게
    let say=String(text||'').replace(/\s*[.·]\s*/g,', ').trim();
    if(textLang==='ko')say=koreanizeLatin(say);
    if(!say||typeof fetch!=='function')return Promise.resolve(null);
    const k=textLang+'|'+say;
    if(AiCache.has(k))return AiCache.get(k);
    if(Date.now()<aiDownUntil)return Promise.resolve(null);
    const p=(async()=>{
      const ctl=new AbortController();
      const timer=setTimeout(()=>ctl.abort(),20000);
      try{
        // cut0 = 문장을 쪼개지 않음 (쉼표에서 쪼개면 앞부분이 빠지는 경우가 있었음)
        const qs=new URLSearchParams({text:say,text_lang:textLang,...AI_TTS_REF[textLang],text_split_method:'cut0',batch_size:'1',media_type:'wav'});
        const r=await fetch(aiTtsBase()+'/tts?'+qs,{signal:ctl.signal,cache:'no-store'});
        if(!r.ok){AiCache.delete(k);return null;}
        const blob=await r.blob();
        if(!blob.size){AiCache.delete(k);return null;}
        return URL.createObjectURL(blob);
      }catch(e){
        // 서버 꺼짐/연결 불가 - 잠깐 쉬었다가 다시 시도
        aiDownUntil=Date.now()+60000;
        AiCache.delete(k);
        return null;
      }finally{clearTimeout(timer);}
    })();
    AiCache.set(k,p);
    return p;
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
      // This temporary element only verifies that the browser can decode the
      // file. Actual playback uses the one tap-unlocked element in unlock().
      const finish=ok=>{if(done)return;done=true;clearTimeout(timer);a.removeAttribute('src');resolve(ok?url:null);};
      const timer=setTimeout(()=>finish(a.readyState>=1),5000);
      a.addEventListener('loadedmetadata',()=>finish(true),{once:true});
      a.addEventListener('canplaythrough',()=>finish(true),{once:true});
      a.addEventListener('error',()=>finish(false),{once:true});
      try{a.load();}catch(e){finish(false);}
    });
  }

  async function resolveSegment(category,key,recordingOnly=false){
    const found=await firstPlayable(pathsFor(category,key));
    if(found){
      const preparedUrl=await prepareAudio(found.url);
      if(preparedUrl)return {kind:'audio',url:preparedUrl,category,key};
    }
    if(recordingOnly)return {kind:'missing',category,key};
    const t=await ttsInfo(category,key);
    const aiUrl=await aiSynth(t.text,t.lang);
    if(aiUrl){
      const preparedUrl=await prepareAudio(aiUrl);
      if(preparedUrl)return {kind:'audio',url:preparedUrl,category,key,ai:true};
    }
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
      // iOS/iPadOS only grants later playback to the media element unlocked by
      // the user's tap. Reuse that exact element for every recorded clip;
      // creating a fresh Audio here makes Safari reject play() and leaves only
      // the TTS fallback audible.
      const a=seg.audio||(primeEl||(primeEl=new Audio()));
      try{
        if(seg.url&&a.src!==seg.url){a.src=seg.url;a.load();}
        a.playbackRate=rate;a.volume=typeof guideVolume==='number'?guideVolume:1;a.currentTime=0;
      }catch(e){resolve(false);return;}
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
  // Pre-generate the AI clip for an upcoming stop that has no recording, so the
  // announcement doesn't wait for synthesis when the bus gets there.
  async function warmAi(category,key){
    try{
      if(await firstPlayable(pathsFor(category,key)))return;
      const t=await ttsInfo(category,key);
      await aiSynth(t.text,t.lang);
    }catch(e){}
  }
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
        warmAi('stops',k);warmAi('stops',k+' (1)');
      }
    }catch(e){}
  }

  function unlock(){
    warmFixed();warmUpcoming();
    if(primeEl)return;
    try{
      primeEl=new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=');
      primeEl.volume=0;primeEl.preload='auto';primeEl.playsInline=true;
      primeEl.setAttribute('playsinline','');
      primeEl.setAttribute('webkit-playsinline','');
      const p=primeEl.play();if(p&&p.then)p.then(()=>{try{primeEl.pause();}catch(e){}}).catch(()=>{});
    }catch(e){}
  }
  document.addEventListener('touchstart',unlock,{capture:true,passive:true});
  document.addEventListener('pointerdown',unlock,{capture:true,passive:true});
  document.addEventListener('click',unlock,{capture:true,passive:true});

  async function resolveAnnouncement(stop,next){
    const stopKey=stop.audioName||stop.name;
    const specs=[['phrases','이번정류소'],['stops',stopKey],next?['phrases','다음정류소']:['phrases','종점입니다'],...(next?[['stops',next.audioName||next.name]]:[])];
    const resolved=await Promise.all(specs.map(s=>resolveSegment(s[0],s[1])));
    const englishStop=await resolveSegment('stops',stopKey+' (1)',true);
    if(englishStop.kind==='audio'){
      resolved.push(await resolveSegment('phrases_en','thisstopis'),englishStop);
    }else{
      // If either Korean stop name already needed TTS, keep the announcement
      // consistent and synthesize its English ending too. Only a fully
      // recorded Korean announcement with a missing "(1)" clip ends here.
      // With the AI voice server available, a missing "(1)" clip is generated
      // too, so the English ending is never silently dropped.
      const stopNameUsesTts=resolved.some((seg,i)=>specs[i][0]==='stops'&&(seg.kind==='tts'||seg.ai));
      const englishSeg=await resolveSegment('stops',stopKey+' (1)');
      if(stopNameUsesTts||englishSeg.ai){
        resolved.push(await resolveSegment('phrases_en','thisstopis'),englishSeg);
      }
    }
    return resolved;
  }

  try{
    announceArrival=async function(stop,next){
      window.cancelGuideAnnouncement();
      if(!guideTtsOn)return;
      const controller=new AbortController();
      announcement=controller;
      unlock();
      try{
        const resolved=await resolveAnnouncement(stop,next);
        if(controller.signal.aborted)return;
        await playResolvedSequence(resolved,controller.signal);
      }finally{
        if(announcement===controller)announcement=null;
      }
    };
  }catch(e){console.error('native gapless announcement override failed',e);}

  warmFixed();setInterval(warmUpcoming,1200);
})();
