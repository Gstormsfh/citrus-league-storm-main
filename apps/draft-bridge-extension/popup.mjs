const button=document.querySelector('#connect'),leagueButton=document.querySelector('#league'),status=document.querySelector('#status');
let source;
button.disabled=true;
leagueButton.disabled=true;
try {
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  const url=new URL(tab?.url??'');
  const platform=url.origin==='https://fantasy.espn.com'?'espn':url.origin==='https://hockey.fantasysports.yahoo.com'?'yahoo':null;
  if(!platform)throw Error('Open an ESPN or Yahoo hockey draft room.');
  source={tabId:tab.id,platform};
  // Configure before the click so open() retains the explicit user gesture.
  await chrome.sidePanel.setOptions({tabId:tab.id,path:`sidepanel.html?source=${tab.id}`,enabled:true});
  button.disabled=false;
  leagueButton.disabled=false;
} catch(error) {status.textContent=error.message;}
button.addEventListener('click',async()=>{
  if(!source)return;
  button.disabled=true;status.textContent='Opening your companion beside the draft…';
  try{
    const opened=chrome.sidePanel.open({tabId:source.tabId});
    const connected=chrome.runtime.sendMessage({type:'START',...source});
    await opened;
    const result=await connected;
    status.textContent=result?.ok?'Connected in the sidebar. Your draft stays on screen.':result?.message??'Could not connect this draft.';
  }catch{status.textContent='Could not open the sidebar. Reopen this extension and retry.';}
  finally{button.disabled=false;}
});
leagueButton.addEventListener('click',async()=>{
  if(!source)return;leagueButton.disabled=true;
  try{
    const opened=chrome.sidePanel.open({tabId:source.tabId});
    const reading=chrome.runtime.sendMessage({type:'READ_LEAGUE',...source});
    await opened;const result=await reading;
    status.textContent=result?.ok?'Settings are ready for review in the sidebar. Nothing has been created.':result?.message??'Could not read league settings.';
  }catch{status.textContent='Open the league Settings page and try again.';}finally{leagueButton.disabled=false;}
});
