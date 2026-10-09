(function(){
  if(window.__gaplessQueueV66)return;
  window.__gaplessQueueV66=true;

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
        // Revalidate once with GitHub Pages before keeping the clip in the
        // in-memory Blob cache. Android Chrome otherwise keeps an old 404
        // after a recording has subsequently been uploaded.
        const r=await fetch(src,{cache:'no-cache'});
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
      try{return {text:await translateStationName(name),lang:'en-US',source:name};}catch(e){return {text:name,lang:'en-US'};}
    }
    if(category==='stops')return {text:String(key).replace(/ \(1\)$/,'')+'입니다',lang:'ko-KR'};
    const m={'이번정류소':'이번 정류소는','다음정류소':'다음 정류소는','종점입니다':'종점입니다'};
    return {text:m[key]||key,lang:'ko-KR'};
  }

  // 녹음 파일이 없을 때 브라우저 TTS 대신 직접 학습한 AI 목소리(GPT-SoVITS)로
  // 그 자리에서 만들어 재생한다. 기본 서버는 오라클 클라우드(PC 꺼도 동작).
  // 주소창에 ?aitts=https://... 를 붙여 열면 그 주소로 바뀌어 저장된다 (?aitts= 빈 값이면 초기화).
  // 예) 집 PC 서버로 쓰려면 ?aitts=http://127.0.0.1:9880
  // 서버가 꺼져 있거나 실패하면 1분 동안은 시도하지 않고 기존 브라우저 TTS로 넘어간다.
  const AI_TTS_KEY='aiTtsUrl';
  const AI_TTS_DEFAULT='https://168-110-38-243.sslip.io';
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
  // 정류소 이름의 숫자는 한자어로 읽는다 (5번출구 -> 오번출구, 102동 -> 백이동).
  // 그대로 보내면 모델이 '다섯번출구'처럼 고유어로 읽어버림.
  const SINO_DIGIT=['','일','이','삼','사','오','육','칠','팔','구'];
  function sinoUnder10000(n){
    let out='';
    [[1000,'천'],[100,'백'],[10,'십']].forEach(([v,u])=>{
      const d=Math.floor(n/v)%10;
      if(d)out+=(d===1?'':SINO_DIGIT[d])+u;
    });
    return out+SINO_DIGIT[n%10];
  }
  function sinoNumber(str){
    // 01 처럼 0으로 시작하거나 119/112 같은 긴급번호는 한 자리씩 (공일, 일일구)
    if((str.length>1&&str[0]==='0')||str==='119'||str==='112')return [...str].map(c=>c==='0'?'공':SINO_DIGIT[+c]).join('');
    const n=parseInt(str,10);
    if(!n)return '영';
    if(n>=100000000)return [...str].map(c=>c==='0'?'공':SINO_DIGIT[+c]).join('');
    const man=Math.floor(n/10000),rest=n%10000;
    return (man?(man===1?'':sinoUnder10000(man))+'만':'')+sinoUnder10000(rest);
  }
  function koreanizeNumbers(s){return s.replace(/\d+/g,sinoNumber);}
  // 영어 모델은 사전에 없는 로마자 지명을 철자로 읽는다 ("Shinwol" -> "신 더블유 원").
  // 원래 한글 정류소명을 로마자로 바꾼 것에 들어 있는 단어(=지명)만 음절마다
  // 띄어 보내면 ("Shin wol") 소리 나는 대로 읽는다. Shopping, Hospital 같은
  // 번역된 영어 단어는 한글 이름에 없으니 그대로 둔다.
  const EN_AS_IS=new Set(['seoul','korea','samsung','hyundai','daewoo','lotte']);
  const ROMAN_SYLLABLE=/(kk|tt|pp|ss|jj|ch|sh|[gndrmbsjkthpl])?(yae|wae|yeo|ae|ya|eo|ye|wa|oe|yo|wo|we|wi|yu|eu|ui|a|e|i|o|u)(ng(?![aeiou])|[nmlkpt](?![aeiou]))?/y;
  function splitRomanizedWord(word){
    const lower=word.toLowerCase();
    if(lower.length<5||EN_AS_IS.has(lower))return word;
    const parts=[];ROMAN_SYLLABLE.lastIndex=0;
    while(ROMAN_SYLLABLE.lastIndex<lower.length){
      const at=ROMAN_SYLLABLE.lastIndex,m=ROMAN_SYLLABLE.exec(lower);
      if(!m||m.index!==at)return word;
      parts.push(word.slice(at,ROMAN_SYLLABLE.lastIndex));
    }
    return parts.length>1?parts.join(' '):word;
  }
  function englishSpeakable(s,korean){
    if(!korean||typeof romanizeKorean!=='function')return s;
    const norm=w=>w.toLowerCase().replace(/sh/g,'s').replace(/[^a-z]/g,'');
    const ref=norm(romanizeKorean(String(korean)));
    return s.replace(/[A-Za-z]+/g,w=>{const n=norm(w);return n.length>=5&&ref.includes(n)?splitRomanizedWord(w):w;});
  }
  const AiCache=new Map();
  let aiDownUntil=0;
  let aiQueue=Promise.resolve();
  function aiTtsBase(){
    let v=null;
    try{
      const q=new URLSearchParams(location.search).get('aitts');
      if(q!==null){if(q)localStorage.setItem(AI_TTS_KEY,q);else localStorage.removeItem(AI_TTS_KEY);}
      v=localStorage.getItem(AI_TTS_KEY);
    }catch(e){}
    return String(v||AI_TTS_DEFAULT).replace(/\/+$/,'');
  }
  // 재생 시간(초). 알 수 없으면 -1
  function clipDuration(url){
    return new Promise(resolve=>{
      let done=false;
      const a=new Audio();
      const finish=v=>{if(done)return;done=true;clearTimeout(timer);a.removeAttribute('src');resolve(v);};
      const timer=setTimeout(()=>finish(-1),5000);
      a.preload='metadata';
      a.addEventListener('loadedmetadata',()=>finish(Number.isFinite(a.duration)?a.duration:-1),{once:true});
      a.addEventListener('error',()=>finish(-1),{once:true});
      a.src=url;
      try{a.load();}catch(e){finish(-1);}
    });
  }
  function aiSynth(text,lang,source){
    const textLang=/^en/i.test(lang||'')?'en':'ko';
    // '가양역1번출구.우성아파트' 의 점은 읽을 때 쉼표처럼 살짝 끊어 읽게
    let say=String(text||'').replace(/\s*[.·]\s*/g,', ').trim();
    if(textLang==='ko')say=koreanizeNumbers(koreanizeLatin(say));
    else say=englishSpeakable(say,source);
    if(!say||typeof fetch!=='function')return Promise.resolve(null);
    const k=textLang+'|'+say;
    if(AiCache.has(k))return AiCache.get(k);
    if(Date.now()<aiDownUntil)return Promise.resolve(null);
    // 서버에 한 번에 하나씩만 요청 (무료 서버처럼 느린 곳에 몰리지 않게, 가까운 정류소부터 차례로)
    const job=async()=>{
      if(Date.now()<aiDownUntil){AiCache.delete(k);return null;}
      const ctl=new AbortController();
      // 느린(무료 CPU) 서버도 기다릴 수 있게 넉넉히
      const timer=setTimeout(()=>ctl.abort(),120000);
      try{
        // cut0 = 문장을 쪼개지 않음 (쉼표에서 쪼개면 앞부분이 빠지는 경우가 있었음)
        const qs=new URLSearchParams({text:say,text_lang:textLang,...AI_TTS_REF[textLang],text_split_method:'cut0',batch_size:'1',media_type:'wav'});
        // 모델이 가끔 0.7초짜리로 잘린 소리를 내서, 글자 수에 비해 너무 짧으면 다시 만든다
        const minSec=say.replace(/[\s,.]/g,'').length/(textLang==='ko'?12:30);
        let best=null,bestDur=-1;
        for(let attempt=0;attempt<3;attempt++){
          const r=await fetch(aiTtsBase()+'/tts?'+qs,{signal:ctl.signal,cache:'no-store'});
          if(!r.ok)break;
          const blob=await r.blob();
          if(!blob.size)break;
          const url=URL.createObjectURL(blob);
          const dur=await clipDuration(url);
          if(dur>bestDur){if(best)URL.revokeObjectURL(best);best=url;bestDur=dur;}else URL.revokeObjectURL(url);
          if(!(dur>=0)||dur>=minSec)break;
        }
        if(!best)AiCache.delete(k);
        return best;
      }catch(e){
        // 서버 꺼짐/연결 불가 - 잠깐 쉬었다가 다시 시도
        aiDownUntil=Date.now()+60000;
        AiCache.delete(k);
        return null;
      }finally{clearTimeout(timer);}
    };
    const p=new Promise(resolve=>{
      aiQueue=aiQueue.then(async()=>resolve(await job())).catch(()=>{AiCache.delete(k);resolve(null);});
    });
    AiCache.set(k,p);
    return p;
  }

  // ---- Web Audio: 안내 조각들을 미리 풀어두고 하나로 이어 붙여 한 번에 재생 ----
  // 폰(특히 아이폰)은 <audio>에 파일을 바꿔 끼울 때마다 다시 불러오느라
  // '이번정류소' 와 '궁동입구' 사이에 텀이 생긴다. 미리 디코딩한 버퍼를
  // 한 덩어리로 합쳐 재생하면 조각 사이 틈이 생길 수 없다.
  let actx=null;
  function audioCtx(){
    if(actx?.state==='closed')actx=null;
    if(actx)return actx;
    const C=window.AudioContext||window.webkitAudioContext;
    if(!C)return null;
    // 아이폰 무음 스위치가 켜져 있어도 안내방송이 들리게 (Safari 17+)
    try{if(navigator.audioSession)navigator.audioSession.type='playback';}catch(e){}
    try{actx=new C();}catch(e){actx=null;}
    return actx;
  }
  // 앞뒤 무음을 잘라서 이어 붙였을 때 늘어지지 않게 (30ms 여유는 남김)
  function trimSilence(buf){
    const ctx=audioCtx();
    if(!ctx||!buf||!buf.length)return buf;
    const TH=0.004,len=buf.length,chs=[];
    for(let c=0;c<buf.numberOfChannels;c++)chs.push(buf.getChannelData(c));
    const loud=i=>chs.some(d=>Math.abs(d[i])>TH);
    let s=0,e=len-1;
    while(s<len&&!loud(s))s++;
    while(e>s&&!loud(e))e--;
    const pad=Math.round(buf.sampleRate*0.03);
    s=Math.max(0,s-pad);e=Math.min(len-1,e+pad);
    if(s>=e||(s===0&&e===len-1))return buf;
    const out=ctx.createBuffer(buf.numberOfChannels,e-s+1,buf.sampleRate);
    chs.forEach((d,c)=>out.getChannelData(c).set(d.subarray(s,e+1)));
    return out;
  }
  const BufCache=new Map();
  const LoudnessGainCache=new WeakMap();
  function loudnessGain(buf){
    if(LoudnessGainCache.has(buf))return LoudnessGainCache.get(buf);
    // Measure only blocks containing speech, so leading/trailing silence does
    // not make a quiet recording receive an excessive boost. Every recorded
    // phrase, Korean/English stop name and decoded AI clip is brought to the
    // same speech RMS, with a peak ceiling to prevent clipping.
    const block=Math.max(128,Math.round(buf.sampleRate*.04));
    let activeEnergy=0,activeCount=0,totalEnergy=0,totalCount=0,peak=0;
    for(let start=0;start<buf.length;start+=block){
      const end=Math.min(buf.length,start+block);let energy=0,count=0;
      for(let c=0;c<buf.numberOfChannels;c++){
        const data=buf.getChannelData(c);
        for(let i=start;i<end;i++){const v=data[i];energy+=v*v;count++;if(Math.abs(v)>peak)peak=Math.abs(v);}
      }
      totalEnergy+=energy;totalCount+=count;
      if(count&&Math.sqrt(energy/count)>=.006){activeEnergy+=energy;activeCount+=count;}
    }
    const rms=Math.sqrt((activeCount?activeEnergy:totalEnergy)/Math.max(1,activeCount||totalCount));
    const TARGET_RMS=.12,MAX_PEAK=.94;
    let gain=rms>0?TARGET_RMS/rms:1;
    gain=Math.max(.3,Math.min(4,gain));
    if(peak>0)gain=Math.min(gain,MAX_PEAK/peak);
    LoudnessGainCache.set(buf,gain);
    return gain;
  }
  function decodeUrl(url){
    const ctx=audioCtx();
    if(!ctx||!url)return Promise.resolve(null);
    if(BufCache.has(url))return BufCache.get(url);
    const p=(async()=>{
      try{
        const ab=await (await fetch(url)).arrayBuffer();
        const buf=await new Promise((res,rej)=>{
          const r=ctx.decodeAudioData(ab,res,rej);
          if(r&&r.then)r.then(res,rej);
        });
        return trimSilence(buf);
      }catch(e){BufCache.delete(url);return null;}
    })();
    BufCache.set(url,p);
    return p;
  }
  // items: [{buf,gapAfter(ms)}] -> 하나의 버퍼로 합쳐 재생
  function playBuffers(items,signal,rate=1){
    return new Promise(resolve=>{
      const ctx=audioCtx();
      if(!ctx||signal.aborted||!items.length){resolve(false);return;}
      const sr=ctx.sampleRate;
      const gapLen=ms=>Math.round(Math.max(0,ms||0)*sr/1000);
      let total=0;
      items.forEach(it=>{total+=it.buf.length+gapLen(it.gapAfter);});
      const ch=Math.max(...items.map(it=>it.buf.numberOfChannels));
      const out=ctx.createBuffer(ch,Math.max(1,total),sr);
      let off=0;
      for(const it of items){
        const normalize=loudnessGain(it.buf);
        for(let c=0;c<ch;c++){
          const input=it.buf.getChannelData(Math.min(c,it.buf.numberOfChannels-1)),output=out.getChannelData(c);
          for(let n=0;n<input.length;n++)output[off+n]=input[n]*normalize;
        }
        off+=it.buf.length+gapLen(it.gapAfter);
      }
      const src=ctx.createBufferSource();
      src.buffer=out;
      src.playbackRate.value=Math.max(.1,rate||1);
      const gain=ctx.createGain();
      gain.gain.value=typeof guideVolume==='number'?guideVolume:1;
      src.connect(gain);gain.connect(ctx.destination);
      let settled=false,startedAt=0;
      const finish=ok=>{
        if(settled)return;settled=true;clearTimeout(timer);
        signal.removeEventListener('abort',abort);
        ctx.removeEventListener?.('statechange',stateChanged);
        src.onended=null;
        if(!ok){try{src.stop();}catch(e){}}
        resolve(ok);
      };
      const abort=()=>finish(false);
      const stateChanged=()=>{if(ctx.state!=='running')finish(false);};
      src.onended=()=>{
        // Some mobile browsers end a suspended WebAudio source almost
        // immediately. Treat that as a failed joined playback so the normal
        // tap-unlocked <audio> path replays every segment.
        const heard=(performance.now()-startedAt)/1000;
        finish(heard>=Math.min(2,Math.max(.2,out.duration*.65)));
      };
      signal.addEventListener('abort',abort,{once:true});
      ctx.addEventListener?.('statechange',stateChanged);
      const timer=setTimeout(()=>finish(true),(out.duration/Math.max(.1,rate||1)+5)*1000);
      try{startedAt=performance.now();src.start();}catch(e){finish(false);}
    });
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

  // 미리 디코딩된 버퍼가 있으면 그걸 붙이고(이어 붙여 재생용), 안 되면 기존처럼 <audio>로 검사
  async function audioSegment(url,extra){
    const buf=await decodeUrl(url);
    if(buf)return {kind:'audio',url,buf,...extra};
    const preparedUrl=await prepareAudio(url);
    return preparedUrl?{kind:'audio',url:preparedUrl,...extra}:null;
  }

  async function resolveSegment(category,key,recordingOnly=false,waitForAi=false){
    const found=await firstPlayable(pathsFor(category,key));
    if(found){
      const seg=await audioSegment(found.url,{category,key});
      if(seg)return seg;
    }
    if(recordingOnly)return {kind:'missing',category,key};
    const t=await ttsInfo(category,key);
    // Do not let a slow AI server or its pre-generation queue silence an
    // entire simulation announcement. The synthesis keeps warming the cache;
    // this announcement uses browser speech if it is not ready in time.
    // AI 서버(오라클 CPU)는 처음 만드는 정류소에 4~10초 걸려서, 1~2초만 기다리면
    // 거의 항상 브라우저(윈도우) 목소리로 넘어감 -> 15초까지 기다린다.
    const aiPromise=aiSynth(t.text,t.lang,t.source),AI_WAIT_MS=15000;
    let timer=null;
    const aiUrl=waitForAi?await aiPromise:await Promise.race([aiPromise,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),AI_WAIT_MS);})]);
    if(timer)clearTimeout(timer);
    if(aiUrl){
      const seg=await audioSegment(aiUrl,{category,key,ai:true});
      if(seg)return seg;
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
    // Keep phrase/name joins short, but breathe between complete sentences.
    const gapAfter=seg=>(seg.category==='stops'||seg.key==='종점입니다')?SENTENCE_GAP_MS:SEGMENT_GAP_MS;
    // Decoded playback is also the normalization path, so use it at every
    // guide speed. The playbackRate is applied once to the joined sequence.
    const ctx=audioCtx();
    let useBuffers=false;
    if(ctx){
      try{if(ctx.state!=='running')await Promise.race([ctx.resume(),new Promise(r=>setTimeout(r,300))]);}catch(e){}
      useBuffers=ctx.state==='running';
    }
    const joinable=seg=>useBuffers&&seg&&seg.kind==='audio'&&seg.buf;
    for(let i=0;i<items.length;){
      if(signal.aborted)return;
      const seg=items[i];
      if(!seg||seg.kind==='missing'){i++;continue;}
      if(joinable(seg)){
        // 녹음/AI 조각이 연속된 구간은 통째로 한 번에 재생
        let j=i;
        const run=[];
        while(joinable(items[j])){
          run.push({buf:items[j].buf,gapAfter:joinable(items[j+1])?gapAfter(items[j]):0});
          j++;
        }
        const ok=await playBuffers(run,signal,typeof guideRate==='number'?guideRate:1);
        if(signal.aborted)return;
        if(!ok){
          for(let k=i;k<j;k++){
            await playAudioSegment(items[k],signal);
            if(signal.aborted)return;
            if(k+1<j)await pauseBetween(gapAfter(items[k]),signal);
          }
        }
        if(j<items.length)await pauseBetween(gapAfter(items[j-1]),signal);
        i=j;
        continue;
      }
      if(seg.kind==='tts')await sayTts(seg,signal);
      else await playAudioSegment(seg,signal);
      if(signal.aborted)return;
      // Wait for actual playback completion, including recorded/TTS transitions.
      if(i+1<items.length)await pauseBetween(gapAfter(seg),signal);
      i++;
    }
  }

  // 파일을 받아두는 것뿐 아니라 재생 가능한 상태로 미리 풀어둔다
  function warmSegment(category,key){
    try{pathsFor(category,key).forEach(p=>loadBlobUrl(p).then(u=>{if(u)decodeUrl(u);}));}catch(e){}
  }
  // Pre-generate the AI clip for an upcoming stop that has no recording, so the
  // announcement doesn't wait for synthesis when the bus gets there.
  async function warmAi(category,key){
    try{
      if(await firstPlayable(pathsFor(category,key)))return;
      const t=await ttsInfo(category,key);
      const url=await aiSynth(t.text,t.lang,t.source);
      if(url)decodeUrl(url);
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
      // 가까운 정류소부터: 다음 정류소, 그다음 3개, 마지막으로 직전 정류소.
      // AI 생성은 한 번에 하나씩 차례로 처리되니 이 순서가 곧 만드는 순서다.
      // 빠른 시뮬레이션에서도 도착 전에 만들어지게 앞쪽 6개까지 미리 준비
      const order=[idx,idx+1,idx+2,idx+3,idx+4,idx+5,idx-1].filter(i=>i>=0&&i<currentGuideStops.length);
      order.forEach(i=>{
        const s=currentGuideStops[i],k=s.audioName||s.name;
        warmSegment('stops',k);warmSegment('stops',k+' (1)');
      });
      // Prepare each stop's Korean and English pair together. The first
      // simulation announcement no longer waits behind six unrelated Korean
      // clips before its English ending can be ready.
      order.forEach(i=>{const s=currentGuideStops[i],k=s.audioName||s.name;warmAi('stops',k);warmAi('stops',k+' (1)');});
    }catch(e){}
  }

  function unlock(){
    // 사용자가 화면을 만질 때 Web Audio를 깨워둔다 (아이폰은 탭 안에서만 허용)
    const ctx=audioCtx();
    if(ctx){
      try{
        if(ctx.state!=='running')ctx.resume();
        const s=ctx.createBufferSource();
        s.buffer=ctx.createBuffer(1,1,22050);
        s.connect(ctx.destination);s.start(0);
      }catch(e){}
    }
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

  async function resolveAnnouncement(stop,next,waitForAi=false){
    const stopKey=stop.audioName||stop.name;
    const skipEnglish=new Set(['롯데마트맥스영등포점']).has(stopKey);
    const specs=next
      ? [['phrases','이번정류소'],['stops',stopKey],['phrases','다음정류소'],['stops',next.audioName||next.name]]
      : [['phrases','이번정류소'],['stops',stopKey]];
    const resolved=await Promise.all(specs.map(async s=>{
      try{return await resolveSegment(s[0],s[1],false,waitForAi);}
      catch(e){const t=await ttsInfo(s[0],s[1]);return {kind:'tts',text:t.text,lang:t.lang,category:s[0],key:s[1]};}
    }));
    if(!next){
      if(!skipEnglish){const englishStop=await resolveSegment('stops',stopKey+' (1)',false,waitForAi);resolved.push(await resolveSegment('phrases_en','thisstopis'),englishStop);}
      resolved.push(await resolveSegment('phrases','종착',false,waitForAi));
      return resolved;
    }
    if(skipEnglish)return resolved;
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
      const englishSeg=await resolveSegment('stops',stopKey+' (1)',false,waitForAi);
      if(stopNameUsesTts||englishSeg.ai){
        resolved.push(await resolveSegment('phrases_en','thisstopis'),englishSeg);
      }
    }
    return resolved;
  }

  try{
    announceArrival=async function(stop,next,options={}){
      window.cancelGuideAnnouncement();
      if(!guideTtsOn)return;
      const controller=new AbortController();
      announcement=controller;
      unlock();
      try{
        const resolved=await resolveAnnouncement(stop,next,!!options.waitForAi);
        if(controller.signal.aborted)return;
        await playResolvedSequence(resolved,controller.signal);
      }finally{
        if(announcement===controller)announcement=null;
      }
    };
  }catch(e){console.error('native gapless announcement override failed',e);}

  warmFixed();setInterval(warmUpcoming,1200);
})();
