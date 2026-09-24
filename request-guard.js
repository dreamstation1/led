(function(){
  if(window.__requestGuardV38)return;
  window.__requestGuardV38=true;

  const realFetch=window.fetch.bind(window);
  const missUntil=new Map();
  const inflight=new Map();
  const MISS_TTL=30*60*1000;

  function keyOf(input){
    try{
      const u=new URL(typeof input==='string'?input:input.url,location.href);
      return u.origin===location.origin && /\/audio\//i.test(u.pathname) ? u.href : null;
    }catch(e){return null;}
  }

  window.fetch=async function(input,init){
    const key=keyOf(input);
    if(!key)return realFetch(input,init);

    const until=missUntil.get(key)||0;
    if(until>Date.now())return new Response('',{status:404,statusText:'Cached missing audio'});
    if(inflight.has(key)){
      const r=await inflight.get(key);
      return r.clone();
    }

    const p=(async()=>{
      try{
        const r=await realFetch(input,init);
        if(!r.ok && (r.status===404||r.status===403||r.status===429))missUntil.set(key,Date.now()+MISS_TTL);
        return r;
      }finally{setTimeout(()=>inflight.delete(key),0);}
    })();
    inflight.set(key,p);
    const r=await p;
    return r.clone();
  };
})();