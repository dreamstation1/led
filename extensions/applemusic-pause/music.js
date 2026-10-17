// Apple Music tab (isolated world): hand the message to the page script,
// which can reach the MusicKit player.
chrome.runtime.onMessage.addListener(msg=>{
  if(msg&&msg.type==='led-announce')window.postMessage({source:'led-bus-ext',playing:!!msg.playing},location.origin);
});
