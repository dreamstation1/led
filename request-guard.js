(function(){
  if(window.__requestGuardV40)return;
  window.__requestGuardV40=true;

  const realFetch=window.fetch.bind(window);
  const missUntil=new Map();
  const inflight=new Map();
  const MISS_TTL=6*60*60*1000;
  const RATE_TTL=15*1000;

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

    // Repository audio is stored as flat /audio/*.wav. Skip only known-dead candidates.
    if(/\.mp3(?:$|\?)/i.test(x.path)||/\/audio\/(?:phrases|phrases_en|stops)\//i.test(x.path)){
      return new Response('',{status:404,statusText:'Skipped nonexistent audio candidate'});
    }

    const until=missUntil.get(x.key)||0;
    if(until>Date.now()){
      const shortRate=(until-Date.now())<=RATE_TTL+1000;
      return new Response('',{status:shortRate?429:404,statusText:shortRate?'Short local retry delay':'Cached missing audio'});
    }

    if(inflight.has(x.key)){
      const r=await inflight.get(x.key);
      return r.clone();
    }

    const p=(async()=>{
      try{
        const r=await realFetch(input,init);
        // Important: never turn one 429 into a 10-minute global audio blackout.
        // Retry the specific file shortly, while true missing files stay cached longer.
        if(r.status===429)missUntil.set(x.key,Date.now()+RATE_TTL);
        else if(r.status===404||r.status===403)missUntil.set(x.key,Date.now()+MISS_TTL);
        else if(r.ok)missUntil.delete(x.key);
        return r;
      }finally{setTimeout(()=>inflight.delete(x.key),0);}
    })();

    inflight.set(x.key,p);
    const r=await p;
    return r.clone();
  };
})();