(function(){
  if(window.__requestGuardV39)return;
  window.__requestGuardV39=true;

  const realFetch=window.fetch.bind(window);
  const missUntil=new Map();
  const inflight=new Map();
  const MISS_TTL=6*60*60*1000;
  let pagesCooldownUntil=0;

  function info(input){
    try{
      const u=new URL(typeof input==='string'?input:input.url,location.href);
      if(u.origin!==location.origin||!/\/audio\//i.test(u.pathname))return null;
      return {key:u.href,path:decodeURIComponent(u.pathname)};
    }catch(e){return null;}
  }

  window.fetch=async function(input,init){
    const x=info(input);
    if(!x)return realFetch(input,init);

    // The repository stores announcement audio as flat /audio/*.wav files.
    // Never hit GitHub Pages for old MP3/category-folder candidates.
    if(/\.mp3(?:$|\?)/i.test(x.path)||/\/audio\/(?:phrases|phrases_en|stops)\//i.test(x.path)){
      return new Response('',{status:404,statusText:'Skipped nonexistent audio candidate'});
    }
    if(pagesCooldownUntil>Date.now())return new Response('',{status:429,statusText:'Local Pages cooldown'});
    if((missUntil.get(x.key)||0)>Date.now())return new Response('',{status:404,statusText:'Cached missing audio'});

    if(inflight.has(x.key)){const r=await inflight.get(x.key);return r.clone();}
    const p=(async()=>{
      try{
        const r=await realFetch(input,init);
        if(r.status===429){pagesCooldownUntil=Date.now()+10*60*1000;missUntil.set(x.key,Date.now()+MISS_TTL);}
        else if(r.status===404||r.status===403)missUntil.set(x.key,Date.now()+MISS_TTL);
        return r;
      }finally{setTimeout(()=>inflight.delete(x.key),0);}
    })();
    inflight.set(x.key,p);
    const r=await p;return r.clone();
  };
})();