// Bus site tab: forward "announcement playing / finished" to the extension.
window.addEventListener('message',e=>{
  if(e.source!==window||!e.data||e.data.source!=='led-bus'||e.data.type!=='announce')return;
  try{chrome.runtime.sendMessage({type:'led-announce',playing:!!e.data.playing});}catch(_){}
});
