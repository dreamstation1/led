(function(){
  if(window.__gaplessQueueV69)return;
  window.__gaplessQueueV69=true;
  // 아이폰 오디오 모드를 첫 소리(무음 깨우기, 시뮬 유지용 무음 루프 포함)보다 먼저 정해 둔다:
  // 기본은 애플뮤직 등 다른 앱 노래와 섞기(ambient). '노래랑 같이 듣기'를 끄면 playback.
  const setLedAudioSession=()=>{try{if(navigator.audioSession)navigator.audioSession.type=localStorage.getItem('ledMixMusic')!=='0'?'ambient':'playback';}catch(e){}};
  setLedAudioSession();

  // Explicit user choices take precedence over recordings, imports and AI fallback.
  const STOP_AUDIO_RULES=Object.assign(Object.create(null),{
    '선유도역롯데웰푸드':{english:'off'},
    '롯데마트맥스영등포점':{english:'off'},
    '영등포시장역4번출구':{korean:'tts',english:'tts'}
  });
  const stopAudioKey=name=>String(name||'').replace(/\s*\(1\)$/, '').replace(/[\s.·ㆍ]/g,'');
  const skipStopEnglish=name=>STOP_AUDIO_RULES[stopAudioKey(name)]?.english==='off';
  const forceStopEnglishTts=name=>['auto','tts'].includes(STOP_AUDIO_RULES[stopAudioKey(name)]?.english);
  // 'ad': this stop's "(1)" clip is its own ad, played right after the Korean with no "This stop is" (only this stop)
  const stopEnglishIsAd=name=>STOP_AUDIO_RULES[stopAudioKey(name)]?.english==='ad';
  function suppressStopRecording(category,key){
    if(category!=='stops')return false;
    const rule=STOP_AUDIO_RULES[stopAudioKey(key)];
    return / \(1\)$/.test(key)?['off','tts'].includes(rule?.english):rule?.korean==='tts';
  }

  // Shared management settings are authoritative; remember them for offline use.
  const audioSettingsReady=(async()=>{
    const apply=data=>{if(!data||data.version!==1||!data.stops||typeof data.stops!=='object')return;
      for(const [name,rule] of Object.entries(data.stops)){if(!rule||typeof rule!=='object')continue;
        const target=STOP_AUDIO_RULES[stopAudioKey(name)]||(STOP_AUDIO_RULES[stopAudioKey(name)]={});
        if(['auto','tts'].includes(rule.korean))target.korean=rule.korean;
        if(['auto','tts','off','ad'].includes(rule.english))target.english=rule.english;
      }
    };
    try{apply(JSON.parse(localStorage.getItem('ledAudioSettings.v1')||'null'));}catch(e){}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),3000);
    try{const r=await fetch((window.LED_BASE||'')+'audio-settings.json',{cache:'no-cache',signal:controller.signal});
      if(r.ok){const data=await r.json();apply(data);try{localStorage.setItem('ledAudioSettings.v1',JSON.stringify(data));}catch(e){}}
    }catch(e){}finally{clearTimeout(timer);}
  })();

  // The embedded page manifest can lag behind newly uploaded recordings.
  // Refresh it before resolving a name, while retaining the offline manifest.
  const recordingManifestReady=(async()=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),3000);
    try{
      const response=await fetch((window.LED_BASE||'')+'audio-files.json',{cache:'no-cache',signal:controller.signal});
      if(!response.ok)return;
      const names=await response.json();
      if(!Array.isArray(names)||!names.every(name=>typeof name==='string'))return;
      const manifest=document.getElementById('audioFileManifest');
      const merged=new Set(names);
      if(manifest)manifest.textContent=JSON.stringify([...merged]);
      if(typeof audioPaths==='function')audioPaths.manifest=merged;
    }catch(e){/* Keep the embedded manifest when offline. */}
    finally{clearTimeout(timer);}
  })();

  const BlobCache=new Map();
  const LoadCache=new Map();
  const TOUCH_DEVICE=(()=>{try{return navigator.maxTouchPoints>0||matchMedia('(pointer:coarse)').matches||/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);}catch(e){return false;}})();
  const SEGMENT_GAP_MS=TOUCH_DEVICE?0:180;
  const SENTENCE_GAP_MS=TOUCH_DEVICE?0:450;
  // Independently draw on each synthesized English stop announcement.
  // Actual recordings already contain their original trailing announcements.
  const ENGLISH_TTS_EXTRA_PROBABILITY=.7;
  const ENGLISH_TTS_EXTRAS=Array.from({length:28},(_,i)=>'audio/tts-extra-'+String(i+1).padStart(2,'0')+'.wav');
  function chooseEnglishTtsExtra(seg,random=Math.random){
    if(!seg||seg.category!=='stops'||! / \(1\)$/.test(seg.key)||!(seg.kind==='tts'||seg.ai))return null;
    if(random()>=ENGLISH_TTS_EXTRA_PROBABILITY)return null;
    return ENGLISH_TTS_EXTRAS[Math.floor(random()*ENGLISH_TTS_EXTRAS.length)];
  }
  async function appendEnglishTtsExtra(items){
    const index=items.findIndex(seg=>seg?.category==='stops'&&/ \(1\)$/.test(seg.key)&&(seg.kind==='tts'||seg.ai));
    if(index<0)return items;
    const path=chooseEnglishTtsExtra(items[index]);
    if(!path)return items;
    try{
      const url=await loadBlobUrl((window.LED_BASE||'')+path);
      if(!url)return items;
      const extra=await audioSegment(url,{category:'extras',key:path,immediate:true});
      if(extra)items.splice(index+1,0,extra);
    }catch(e){/* A missing optional clip must not interrupt the stop announcement. */}
    return items;
  }
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
    if(suppressStopRecording(category,key))return [];
    try{if(typeof audioPaths==='function'){
      const paths=audioPaths(category,key)||[],canonical=String(key).replace(/\s/g,'');
      const formats=[...(audioPaths.manifest||[])].filter(name=>/\.(?:m4a|ogg)$/i.test(name)&&name.split('/').pop().replace(/\.[^.]+$/,'').replace(/\s/g,'')===canonical).map(name=>'audio/'+name.split('/').map(encodeURIComponent).join('/'));
      return [...new Set([...paths,...formats])];
    }}catch(e){}
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

  // 한국어 목소리 그룹(1/2): 같은 성우가 다른 시기에 녹음한 두 가지 목소리. 녹음이 있는 정류소는
  // 그 녹음의 그룹(voice-groups.json)을 알고 있고, 녹음이 없는 정류소는 노선에서 가장 가까운
  // 녹음 정류소(앞쪽 우선)와 같은 그룹 목소리로 AI 음성을 만들어 방송 중간에 목소리가 바뀌지 않게 한다.
  // 신형 녹음 그룹(1)은 새로 학습한 신형 목소리(서버 voice=3, bus_jsk)로 읽는다. 화자 임베딩으로 비교하면
  // 신형 목소리는 그룹 1 녹음에 더 가깝다(유사도 중앙값 0.37 vs 0.27). 주변에 녹음 정류소가 없으면
  // 가장 흔한 신형으로 읽는다.
  const NEW_STYLE_GROUP='1',NEW_STYLE_VOICE='3';
  let voiceGroupsPromise=null;
  function loadVoiceGroups(){
    voiceGroupsPromise=voiceGroupsPromise||fetch((window.LED_BASE||'')+'voice-groups.json').then(r=>r.ok?r.json():{})
      .then(g=>new Map(Object.entries(g).map(([k,v])=>[k.replace(/\s*\(\d+\)$/,''),String(v)===NEW_STYLE_GROUP?NEW_STYLE_VOICE:String(v)]))).catch(()=>new Map());
    return voiceGroupsPromise;
  }
  async function voiceGroupFor(name,stops){
    const g=await loadVoiceGroups();
    if(g.has(name))return g.get(name);
    const src=stops||(typeof currentGuideStops!=='undefined'?currentGuideStops:[]);
    const list=src.map(s=>typeof s==='string'?s:(s.audioName||s.name));
    const i=list.indexOf(name);
    if(i<0)return NEW_STYLE_VOICE;
    for(let d=1;d<list.length;d++)for(const j of [i-d,i+d])if(j>=0&&j<list.length&&g.has(list[j]))return g.get(list[j]);
    return NEW_STYLE_VOICE;
  }
  async function ttsInfo(category,key){
    if(category==='phrases_en')return {text:key==='thisstopis'?'This stop is':key,lang:'en-US'};
    if(category==='stops'&&/ \(1\)$/.test(key)){
      const name=key.replace(/ \(1\)$/,'');
      try{return {text:await translateStationName(name),lang:'en-US',source:name};}catch(e){return {text:name,lang:'en-US'};}
    }
    if(category==='stops')return {text:String(key).replace(/ \(1\)$/,'')+'입니다',lang:'ko-KR',voice:await voiceGroupFor(String(key))};
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
  // 서울시 공식 영문 정류소명(stop-en.json)을 소리 내어 읽기 좋게 다듬는다.
  // "5(o)-dong" 은 숫자를 괄호 속 한국어 발음으로만 읽고(five o 처럼 두 번 읽지 않게),
  // 중앙차로 표시 "(Median Bus Lane)" 은 읽지 않으며, 약어는 풀어서 읽는다.
  const EN_ABBR=[[/\bApts\./g,'Apartments'],[/\bApt\./g,'Apartment'],[/\bUniv\./g,'University'],[/\bStn\./g,'Station'],
    [/\bNat'l\b/g,'National'],[/\bInt'l\b/g,'International'],[/\bDept\./g,'Department'],[/\bBr\./g,'Bridge'],
    [/\b[Bb]ldg\./g,'Building'],[/\bJct\./g,'Junction'],[/\bSt\.(?=\s*[A-Z][a-z]*'s\b)/g,'Saint']];
  const KO_NUM_TAIL=/^(ga|dong|gil|ro|ri|gu|danji|cha|ho|ban|jigu)$/i;
  function speakableEnglish(s){
    s=String(s||'').replace(/​/g,'').replace(/[’´]/g,"'").replace(/\s*\(Median Bus Lane\)/gi,'');
    s=s.replace(/\b\d+\s*\(([a-z]+)\)(?:\s*-?\s*([A-Za-z]+))?/g,(m,ko,tail)=>{
      const w=ko.charAt(0).toUpperCase()+ko.slice(1);
      return tail&&KO_NUM_TAIL.test(tail)?w+tail.toLowerCase():w+(tail?' '+tail:'');
    });
    for(const [re,to] of EN_ABBR)s=s.replace(re,to);
    return s.replace(/\s*&\s*/g,' and ').replace(/\s*\/\s*/g,', ').replace(/[()]/g,' ').replace(/\s+/g,' ').trim();
  }
  // 긴 정류소명을 붙여 보내면 모델이 엉뚱한 곳에서 쉰다 ("서울과학수사연구.소입구", "마천이동주민센터").
  // 실제 AI 음성을 받아쓰기로 채점해 고른 규칙(2026-11): 낱말 경계마다 띄어 보내면 그 자리에서 끊어 읽는다.
  //  - 숫자와 단위: 마천2동주민센터 -> 마천 2동 주민센터, 가양역1번출구 -> 가양역 1번 출구
  //  - 앞의 지역명(구, 지하철역 이름): 송파레이크파크 -> 송파 레이크파크
  //  - 중간의 시설/브랜드 낱말: 효창파크푸르지오아파트 -> 효창파크 푸르지오 아파트
  //  - 끝의 낱말(입구, 정문, 아파트 브랜드...): 잠실우성 -> 잠실 우성
  const KO_AREAS='가락시장 강남구청 강동구청 건대입구 걸포북변 검단오류 경기광주 경마공원 경찰병원 공항시장 광교중앙 굽은다리 금천구청 김포공항 남동구청 동대입구 둔촌오륜 마곡나루 마포구청 매탄권선 몽촌토성 버티고개 부천시청 부평구청 부평시장 삼성중앙 상왕십리 서해구청 석촌고분 성균관대 소래포구 솔밭공원 송파나루 수원시청 수지구청 숙대입구 시민공원 시흥능곡 시흥대야 시흥시청 신길온천 양천구청 양천향교 여의나루 예술회관 온양온천 운정중앙 인천가좌 인천논현 인천시청 잠실나루 잠실새내 장승배기 태릉입구 평내호평 평택지제 하남시청 하남풍산 한성백제 홍대입구 가오리 가재울 가천대 강남대 개포동 개화산 검바위 경복궁 고려대 곤지암 관악산 광나루 광운대 광화문 광흥창 구반포 구파발 굴봉산 굴포천 김량장 김유정 까치산 까치울 낙성대 남구로 남위례 남춘천 남태령 노량진 녹사평 답십리 대공원 대성리 대야미 도림천 도봉산 독립문 독바위 돌곶이 동구릉 동대문 동두천 동묘앞 동인천 둔촌동 망월사 명지대 무악재 백양리 보라매 봉은사 봉화산 불암산 사가정 삼각지 상록수 상월곡 상일동 서강대 서대문 서동탄 서빙고 서울숲 서정리 선바위 선유도 선정릉 소새울 소요산 수락산 수리산 신금호 신논현 신대방 신도림 신목동 신반포 신방화 신설동 신연수 신용산 신이문 신중동 아차산 압구정 애오개 여의도 연신내 영등포 오류동 오목교 오목천 오산대 오이도 왕십리 외대앞 용마산 우장산 운길산 원인재 의정부 이태원 인덕원 인하대 임진강 장한평 정발산 제기동 제물포 천마산 청량리 충무로 충정로 킨텍스 퇴계원 학여울 한강진 한대앞 한양대 호구포 화랑대 가능 가양 가정 가좌 가평 간석 갈매 갈산 강남 강동 강매 강변 강북 강서 강일 강촌 개롱 개봉 개화 거여 검암 계산 계양 고덕 고색 고잔 고진 고촌 곡산 곤제 공덕 공릉 과천 관악 광교 광명 광진 교대 구래 구로 구룡 구리 구산 구성 구의 구일 국수 군자 군포 귤현 금곡 금릉 금정 금천 금촌 금호 기흥 길동 길음 남성 남영 내방 노들 노원 녹번 녹양 녹천 논현 능곡 다산 달미 달월 당곡 당산 당정 대곡 대림 대방 대청 대치 대화 대흥 덕계 덕소 덕정 도곡 도농 도봉 도심 도원 도화 독산 독정 동막 동백 동수 동암 동오 동작 동천 동춘 동탄 두정 둔전 등촌 뚝섬 마곡 마두 마들 마산 마석 마장 마전 마천 마포 만수 망우 망원 망포 매교 매봉 먹골 면목 명동 명일 명학 모란 목동 문래 문산 문정 미금 미사 미아 박촌 반월 반포 발곡 발산 방배 방이 방학 방화 배방 백마 백석 백운 범계 범골 별내 병점 보문 보산 보정 보평 복정 봉명 봉천 부개 부발 부천 부평 불광 사당 사릉 사리 사우 사평 산곡 산본 산성 삼가 삼동 삼성 삼송 삼양 삼전 상갈 상계 상도 상동 상봉 상수 상천 상현 새말 새절 샛강 서울 서원 서초 서현 석계 석남 석수 석촌 선릉 선부 선학 성남 성동 성복 성북 성수 성환 세류 세마 소사 솔샘 송내 송도 송산 송정 송탄 송파 수내 수색 수서 수원 수유 수진 숭의 시우 시청 신갈 신길 신내 신답 신당 신림 신사 신원 신정 신창 신천 신촌 신포 신풍 신현 신흥 쌍문 쌍용 아라 아산 아신 아현 안국 안산 안암 안양 암사 야당 야목 야탑 약수 양수 양원 양재 양정 양주 양천 양촌 양평 어룡 어정 어천 언주 여주 역곡 역삼 역촌 연수 연천 염창 영종 영통 오금 오남 오리 오빈 오산 옥수 온수 완정 왕길 용답 용두 용문 용산 운서 운양 운연 운정 운천 원당 원덕 원시 원종 원흥 월계 월곡 월곶 월롱 은평 응봉 응암 의왕 이대 이매 이수 이천 이촌 인천 일산 일원 임학 자양 작전 잠실 잠원 장기 장암 장지 전곡 정릉 정왕 정자 종각 종로 주안 주엽 죽전 중계 중곡 중동 중랑 중앙 중화 증미 증산 지석 지축 지평 지행 직산 진위 진접 창동 창신 천안 천왕 천호 철산 청구 청담 청명 청산 청평 초당 초월 초지 춘의 춘천 탄현 탑석 탕정 태평 파주 판교 팔당 평촌 평택 풍무 풍산 하계 학동 한남 한티 합정 행당 행신 혜화 홍제 화계 화곡 화서 화정 회기 회룡 회현 효자 흑석 흥선'.split(' ');
  const KO_INFIX=['행정복지센터','종합복지관','사회복지관','공영차고지','힐스테이트','디지털단지','월드컵파크','새마을금고','주민센터','복지센터','체육센터','문화센터','안전센터','치안센터',
    '어린이집','국민은행','하나은행','신한은행','우리은행','농협은행','근린공원','초등학교','고등학교','래미안','푸르지오','아이파크','롯데캐슬','e편한세상','이편한세상','편한세상','센트레빌',
    '두산위브','호반써밋','리버파크','복지관','경로당','파출소','주유소','보건소','세무서','백화점','터미널','박물관','주차장','하이츠','프라자','플라자','센트럴',
    '이마트','수영장','소극장','호텔','자동차','중고교','우체국','경찰서','소방서','도서관','아파트','중학교','대학교','사거리','삼거리','오거리','네거리','교차로','차고지'];
  const KO_TAIL=['정문','후문','동문','남문','북문','서문','동측','서측','남측','북측','방향','초교','입구','단지','시장','공원','병원','구청','시청','상가','센터','교회','성당','여고','여중','앞','역',
    '현대','우성','삼성','한신','극동','대림','삼익','벽산','신동아','한양','주공','쌍용','동아','럭키','진로','대우','코오롱','자이'];
  const KO_NO_SPLIT_AFTER_AREA=/^(역|동|구|시|군|읍|면|로|길|가|리|천|산|교|대|시장|공원|입구|사거리|삼거리|오거리|네거리)/;
  const KO_DATES={'4~19':'사일구','3~1':'삼일','5~18':'오일팔','6~25':'육이오','8~15':'팔일오'};
  const hangulCount=s=>(s.match(/[가-힣]/g)||[]).length;
  function koSplitInfix(tok){
    if(KO_INFIX.includes(tok))return [tok];
    for(const w of KO_INFIX){
      const i=tok.indexOf(w);
      if(i<0)continue;
      const a=tok.slice(0,i),b=tok.slice(i+w.length);
      if(a&&hangulCount(a)<2&&a!=='앞')continue;   // 구로남초등학교 -> 구로 남초등학교
      if(b==='역')continue;                         // 고속터미널역은 한 낱말
      return [...(a?koSplitInfix(a):[]),w,...(b?koSplitInfix(b):[])];
    }
    return [tok];
  }
  function koSplitTail(tok){
    if(KO_INFIX.includes(tok)||KO_TAIL.includes(tok))return [tok];
    const words=[];let rest=tok;
    for(let guard=0;guard<3;guard++){
      if(hangulCount(rest)<4)break;
      const w=KO_TAIL.find(t=>rest.endsWith(t)&&hangulCount(rest)-hangulCount(t)>=2);
      if(!w||w==='역')break;                        // OO역은 한 낱말
      words.unshift(w);rest=rest.slice(0,-w.length);
    }
    return [rest,...words];
  }
  function koSplitArea(tok){
    const a=KO_AREAS.find(x=>tok.startsWith(x));   // 가장 긴 지역명 (양천향교역은 양천+향교역이 아님)
    if(!a||tok.length-a.length<2)return [tok];
    const after=tok.slice(a.length);
    if(/^동[가-힣]{2,}/.test(after)&&!KO_NO_SPLIT_AFTER_AREA.test(after.slice(1)))return [a+'동',after.slice(1)];
    if(KO_NO_SPLIT_AFTER_AREA.test(after))return [tok];
    return [a,after];
  }
  function spaceLongKoreanName(part){
    // '어린이공원'은 붙이든 '금실 어린이공원'으로 띄우든 '어린, 이공원'으로 끊어 읽어서
    // '어린이 공원'으로 나눠 보낸다 (금실어린이공원 -> 금실 어린이 공원; 테스트에서 끊김 위치가 바로잡힘).
    part=part.replace(/(.)어린이공원/g,'$1 어린이 공원').replace(/^어린이공원/,'어린이 공원');
    let tail='',rest=part;
    const m=rest.match(/입니다[.!]?$/);if(m){tail=m[0];rest=rest.slice(0,-m[0].length);}
    rest=rest.replace(/e-편한세상/g,'e편한세상');
    const spaced=/\s/.test(rest);
    rest=rest.replace(/(^|[^\d])(4~19|3~1|5~18|6~25|8~15)(?!\d)/g,(m,p,d)=>p+KO_DATES[d]+' ').trim();   // 4.19 -> 사일구
    rest=rest.replace(/(\d)\s*[-~]\s*(?=\d)/g,'$1, ');                                                  // 8.9단지, 2-9단지 -> 8, 9단지
    if(hangulCount(rest)<5||spaced)return rest+tail;
    rest=rest.replace(/(제)?(\d+)(번출구|출구|단지|차|가동|동|가역|가|호선|번지|층|호|번|길|지구|블럭|공구|대학|관|교|거리|통)?/g,(m,j,d,u,off,all)=>{
      const area=j&&KO_AREAS.some(a=>a.endsWith('제')&&(all.slice(0,off)+'제').endsWith(a));          // 홍제2동 = 홍제 + 2동
      return (area?'제 ':' '+(j||''))+d+(/출구/.test(u||'')?'번 출구':(u||''))+' ';
    }).trim();
    rest=rest.replace(/^([A-Za-z]{2,})(?=[가-힣]{2})/,'$1 ');   // DMC래미안 -> DMC 래미안
    rest=rest.replace(/^([가-힣]) (?=\d)/,'$1');                 // 창2동은 붙여서
    let toks=rest.split(/\s+/);
    toks=toks.flatMap((t,i)=>i===0?koSplitArea(t):[t]);
    toks=toks.flatMap(t=>/^\d/.test(t)?[t]:koSplitInfix(t));
    toks=toks.flatMap(t=>/^\d/.test(t)?[t]:koSplitTail(t));
    toks=toks.flatMap(t=>/^[가-힣]{2,}앞$/.test(t)&&!KO_TAIL.includes(t.slice(0,-1))?[t.slice(0,-1),'앞']:[t]);
    toks=toks.filter(Boolean).reduce((o,t)=>(t==='역'&&o.length?(o[o.length-1]+=t):o.push(t),o),[]);
    return toks.join(' ').replace(/ ,/g,',')+tail;
  }
  // 정류소명을 AI에 보낼 꼴로: (가상) 같은 표시는 읽지 않고, 나머지 괄호는 따로 끊어 읽고,
  // 4.19는 '사일구'로, 8.9단지 / 2-9단지는 '팔, 구단지'처럼 쉼표로 끊는다 (띄어쓰기만 하면 잘못 읽었음)
  function koStopSayPrep(s){
    return String(s||'').replace(/\s*\((가상|중|임시|미정차|구|마을|주|광역버스)\)\s*/g,'')
      .replace(/\s*\(([^)]*)\)\s*/g,'.$1.').replace(/[.\s]+(?=입니다$)/,'').replace(/(\d)\.(?=\d)/g,'$1~').replace(/\s*,\s*/g,'.');
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
  function aiSynth(text,lang,source,voice){
    const textLang=/^en/i.test(lang||'')?'en':'ko';
    // '가양역1번출구.우성아파트' 의 점은 읽을 때 쉼표처럼 살짝 끊어 읽게
    let say=(textLang==='en'?speakableEnglish(text):koStopSayPrep(text)).replace(/\s*[.·]\s*/g,', ').replace(/(,\s*)+$/,'').trim();
    if(textLang==='ko')say=koreanizeNumbers(koreanizeLatin(say.split(', ').map(spaceLongKoreanName).join(', ')));
    if(!say||typeof fetch!=='function')return Promise.resolve(null);
    voice=textLang==='ko'&&/^[123]$/.test(String(voice||''))?String(voice):'';
    const k=textLang+'|'+voice+'|'+say;
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
        const qs=new URLSearchParams({text:say,text_lang:textLang,...AI_TTS_REF[textLang],text_split_method:'cut0',batch_size:'1',media_type:'wav',...(voice?{voice}:{})});
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
    // 아이폰: '노래랑 같이 듣기'(기본)면 애플뮤직과 섞어서(ambient, 무음 스위치엔 꺼짐),
    // 끄면 무음 스위치가 켜져 있어도 들리게(playback, 대신 다른 앱 노래는 멈춤). 설정은 bus-sound.js 패널.
    try{if(navigator.audioSession)navigator.audioSession.type=localStorage.getItem('ledMixMusic')!=='0'?'ambient':'playback';}catch(e){}
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
      // 1000%까지: 크게 올려도 찢어지지 않게 리미터를 거친다
      if(!ctx._guideLimiter){const l=ctx.createDynamicsCompressor();l.threshold.value=-6;l.knee.value=4;l.ratio.value=20;l.attack.value=.002;l.release.value=.2;l.connect(ctx.destination);ctx._guideLimiter=l;}
      src.connect(gain);gain.connect(ctx._guideLimiter);
      let settled=false,startedAt=0;
      const finish=ok=>{
        if(settled)return;settled=true;clearTimeout(timer);
        signal.removeEventListener('abort',abort);
        ctx.removeEventListener?.('statechange',stateChanged);
        src.onended=null;
        if(!ok){try{src.stop();}catch(e){}}
        try{window.busSound?.voice(false);}catch(e){}
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
      try{startedAt=performance.now();src.start();try{window.busSound?.voice(true);}catch(e){}}catch(e){finish(false);}
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
    await Promise.all([recordingManifestReady,audioSettingsReady]);
    if(category==='stops'&&/ \(1\)$/.test(key)&&skipStopEnglish(key))return {kind:'missing',category,key};
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
    const aiPromise=aiSynth(t.text,t.lang,t.source,t.voice),AI_WAIT_MS=15000;
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
      u.lang=seg.lang;u.volume=Math.min(1,guideVolume);u.rate=guideRate;
      const finish=ok=>{
        if(settled)return;settled=true;clearTimeout(timer);
        signal.removeEventListener('abort',cancel);
        u.onend=u.onerror=null;
        try{window.busSound?.voice(false);}catch(e){}
        if(!ok)window.speechSynthesis.cancel();
        resolve(ok);
      };
      const cancel=()=>finish(false);
      u.onend=()=>finish(true);u.onerror=cancel;
      signal.addEventListener('abort',cancel,{once:true});
      timer=setTimeout(cancel,Math.max(30000,seg.text.length*1000/Math.max(.1,guideRate)));
      try{window.busSound?.voice(true);window.speechSynthesis.speak(u);}catch(e){cancel();}
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
        a.playbackRate=rate;a.volume=Math.min(1,typeof guideVolume==='number'?guideVolume:1);a.currentTime=0;
      }catch(e){resolve(false);return;}
      let settled=false,timer;
      const ended=()=>finish(true),failed=()=>finish(false);
      const finish=ok=>{
        if(settled)return;settled=true;clearTimeout(timer);
        a.removeEventListener('ended',ended);a.removeEventListener('error',failed);
        signal.removeEventListener('abort',failed);
        try{window.busSound?.voice(false);}catch(e){}
        if(!ok)a.pause();
        resolve(ok);
      };
      a.addEventListener('ended',ended,{once:true});
      a.addEventListener('error',failed,{once:true});
      signal.addEventListener('abort',failed,{once:true});
      timer=setTimeout(failed,Math.max(5000,((Number.isFinite(a.duration)?a.duration/rate:30)+5)*1000));
      try{window.busSound?.voice(true);const p=a.play();if(p&&p.catch)p.catch(failed);}catch(e){failed();}
    });
  }

  async function playResolvedSequence(items,signal){
    // Keep phrase/name joins short, but breathe between complete sentences.
    const gapAfter=(seg,next)=>next?.immediate?0:(seg.category==='stops'||seg.key==='종점입니다')?SENTENCE_GAP_MS:SEGMENT_GAP_MS;
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
          run.push({buf:items[j].buf,gapAfter:joinable(items[j+1])?gapAfter(items[j],items[j+1]):0});
          j++;
        }
        const ok=await playBuffers(run,signal,typeof guideRate==='number'?guideRate:1);
        if(signal.aborted)return;
        if(!ok){
          for(let k=i;k<j;k++){
            await playAudioSegment(items[k],signal);
            if(signal.aborted)return;
            if(k+1<j)await pauseBetween(gapAfter(items[k],items[k+1]),signal);
          }
        }
        if(j<items.length)await pauseBetween(gapAfter(items[j-1],items[j]),signal);
        i=j;
        continue;
      }
      if(seg.kind==='tts')await sayTts(seg,signal);
      else await playAudioSegment(seg,signal);
      if(signal.aborted)return;
      // Wait for actual playback completion, including recorded/TTS transitions.
      if(i+1<items.length)await pauseBetween(gapAfter(seg,items[i+1]),signal);
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
    await audioSettingsReady;
    if(category==='stops'&&/ \(1\)$/.test(key)&&skipStopEnglish(key))return;
    try{
      if(await firstPlayable(pathsFor(category,key)))return;
      const t=await ttsInfo(category,key);
      const url=await aiSynth(t.text,t.lang,t.source,t.voice);
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
    setLedAudioSession();
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
    await audioSettingsReady;
    const stopKey=stop.audioName||stop.name;
    const skipEnglish=skipStopEnglish(stopKey)||skipStopEnglish(stop.name);
    const specs=next
      ? [['phrases','이번정류소'],['stops',stopKey],['phrases','다음정류소'],['stops',next.audioName||next.name]]
      : [['phrases','이번정류소'],['stops',stopKey]];
    const resolved=await Promise.all(specs.map(async s=>{
      try{return await resolveSegment(s[0],s[1],false,waitForAi);}
      catch(e){const t=await ttsInfo(s[0],s[1]);return {kind:'tts',text:t.text,lang:t.lang,category:s[0],key:s[1]};}
    }));
    if(!next){
      // 종점: no ads. A recorded English clip longer than a name has its ad/notice built in, so it is left out there;
      // the AI/TTS English (name only) stays and gets no extra after it (2026-11-20).
      if(!skipEnglish&&!stopEnglishIsAd(stopKey)){
        const englishStop=await resolveSegment('stops',stopKey+' (1)',false,waitForAi);
        const withAd=englishStop&&englishStop.kind==='audio'&&!englishStop.ai&&englishStop.buf&&englishStop.buf.duration>4.5;
        if(englishStop&&englishStop.kind!=='missing'&&!withAd)resolved.push(await resolveSegment('phrases_en','thisstopis'),englishStop);
      }
      resolved.push(await resolveSegment('phrases','종착',false,waitForAi));
      resolved.terminal=true;
      return resolved;
    }
    if(skipEnglish)return resolved;
    if(stopEnglishIsAd(stopKey)){       // the recorded ad straight after the Korean; nothing when it is missing
      const ad=await resolveSegment('stops',stopKey+' (1)',true);
      if(ad.kind==='audio')resolved.push(ad);
      return resolved;
    }
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
      if(forceStopEnglishTts(stopKey)||stopNameUsesTts||englishSeg.ai){
        resolved.push(await resolveSegment('phrases_en','thisstopis'),englishSeg);
      }
    }
    return resolved;
  }

  // Tells other tabs (via the "버스 방송 중 Apple Music 일시정지" browser
  // extension) that an announcement is playing, so music can pause and resume.
  let announceSignalOn=false;
  function announceSignal(on){
    if(announceSignalOn===on)return;
    announceSignalOn=on;
    try{window.postMessage({source:'led-bus',type:'announce',playing:on},location.origin);}catch(e){}
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
        if(!resolved.terminal)await appendEnglishTtsExtra(resolved);     // 종점: no ad after the English
        if(controller.signal.aborted)return;
        announceSignal(true);
        await playResolvedSequence(resolved,controller.signal);
      }finally{
        // A newer announcement replacing this one keeps the music paused.
        if(announcement===controller||announcement===null)announceSignal(false);
        if(announcement===controller)announcement=null;
      }
    };
  }catch(e){console.error('native gapless announcement override failed',e);}

  warmFixed();setInterval(warmUpcoming,1200);
})();
