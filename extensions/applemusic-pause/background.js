// Relay the bus site's announcement state to every open Apple Music tab.
chrome.runtime.onMessage.addListener(msg=>{
  if(!msg||msg.type!=='led-announce')return;
  chrome.tabs.query({url:'https://music.apple.com/*'},tabs=>{
    for(const t of tabs)chrome.tabs.sendMessage(t.id,msg).catch(()=>{});
  });
});
