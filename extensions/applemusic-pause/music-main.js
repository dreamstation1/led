// Apple Music tab (page world): pause while a bus announcement plays and
// resume afterwards - but only if it was playing and we were the ones who
// paused it, so music the user stopped stays stopped.
(function(){
  let pausedByBus=false,resumeTimer=null;
  const kit=()=>{try{return window.MusicKit&&window.MusicKit.getInstance();}catch(e){return null;}};
  const media=()=>[...document.querySelectorAll('audio,video')];
  function playing(){
    const k=kit();
    if(k&&typeof k.isPlaying==='boolean')return k.isPlaying;
    return media().some(m=>!m.paused&&!m.ended);
  }
  function pause(){
    if(!playing())return;
    pausedByBus=true;
    const k=kit();
    try{if(k)k.pause();else media().forEach(m=>m.pause());}catch(e){media().forEach(m=>m.pause());}
  }
  function resume(){
    if(!pausedByBus)return;
    pausedByBus=false;
    const k=kit();
    const quiet=p=>{if(p&&p.catch)p.catch(()=>{});};
    try{quiet(k?k.play():media()[0]&&media()[0].play());}catch(e){quiet(media()[0]&&media()[0].play());}
  }
  window.addEventListener('message',e=>{
    if(e.source!==window||!e.data||e.data.source!=='led-bus-ext')return;
    clearTimeout(resumeTimer);
    // short gap so back-to-back announcements don't make the music blip
    if(e.data.playing)pause();else resumeTimer=setTimeout(resume,700);
  });
})();
