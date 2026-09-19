import {captureEspnDraft} from './capture.mjs';
import {captureYahooDraft} from './yahoo-capture.mjs';
import {RECEIVER_ORIGIN,RECEIVER_PATH} from './config.mjs';
const PREFIX='draft-bridge:',MAX_AGE=6*60*60*1000;
const busy=new Set(), starting=new Set();
const failure=message=>({ok:false,message});
function receiver(url){try{const u=new URL(url);return u.origin===RECEIVER_ORIGIN&&u.pathname===RECEIVER_PATH;}catch{return false;}}
async function capture(tabId,previous,platform=previous?.platform??'espn'){
  const reader=platform==='yahoo'?captureYahooDraft:captureEspnDraft;
  const replies=await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},world:'ISOLATED',func:reader,args:[previous]});
  if(replies.length!==1||replies[0].frameId!==0)return failure('The main draft frame could not be verified.');
  return replies[0].result;
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id||sender.url!==chrome.runtime.getURL('popup.html')||message?.type!=='START'||!Number.isInteger(message.tabId)||!['espn','yahoo'].includes(message.platform??'espn'))return;
  if(starting.has(message.tabId)){respond(failure('This draft is already connecting.'));return;}
  starting.add(message.tabId);
  (async()=>{
    // Keep at most one pairing per source. Remove expired entries opportunistically.
    const entries=await chrome.storage.session.get(null);
    for(const [key,value] of Object.entries(entries))if(key.startsWith(PREFIX)&&(Date.now()-value.createdAt>MAX_AGE||value.sourceTabId===message.tabId))await chrome.storage.session.remove(key);
    const remaining=await chrome.storage.session.get(null);
    if(Object.keys(remaining).filter(k=>k.startsWith(PREFIX)).length>=20)return failure('Close unused draft connections before opening another.');
    const snapshot=await capture(message.tabId,null,message.platform??'espn');
    if(!snapshot?.ok)return snapshot??failure('Could not read the draft room.');
    const nonce=crypto.randomUUID(),key=PREFIX+nonce;
    // Only normalized displayed data is held in this extension’s memory store.
    const tab=await chrome.tabs.create({url:`${RECEIVER_ORIGIN}${RECEIVER_PATH}?tab=pricing#citrus-bridge=${chrome.runtime.id}.${nonce}`});
    await chrome.storage.session.set({[key]:{sourceTabId:message.tabId,receiverTabId:tab.id,createdAt:Date.now(),snapshot,receivedAt:Date.now()}});
    return {ok:true};
  })().then(respond).catch(()=>respond(failure('Could not connect. Reopen the source draft and retry.'))).finally(()=>starting.delete(message.tabId));
  return true;
});
chrome.runtime.onMessageExternal.addListener((message,sender,respond)=>{
  if(!receiver(sender.url)||sender.frameId!==0||!sender.tab?.id||!['SNAPSHOT','DISCONNECT'].includes(message?.type)
    ||!/^[0-9a-f-]{36}$/.test(message?.nonce??''))return;
  const key=PREFIX+message.nonce;
  (async()=>{
    const pair=(await chrome.storage.session.get(key))[key];
    if(!pair||pair.receiverTabId!==sender.tab.id)return failure('No connection for this tab. Connect from the ESPN draft again.');
    if(message.type==='DISCONNECT'||Date.now()-pair.createdAt>MAX_AGE){await chrome.storage.session.remove(key);return failure('Disconnected. Reconnect from the ESPN draft when ready.');}
    if(busy.has(key))return failure('A source check is already running.');
    // Rate-limit each pairing without treating an old receipt as fresh.
    if(Date.now()-pair.receivedAt<1000)return {ok:true,snapshot:pair.snapshot,receivedAt:pair.receivedAt};
    busy.add(key);
    try{
      const snapshot=await capture(pair.sourceTabId,pair.snapshot);
      if(!snapshot?.ok)return snapshot??failure('The source draft did not respond.');
      const current=(await chrome.storage.session.get(key))[key];
      if(!current||current.receiverTabId!==sender.tab.id)return failure('Disconnected during the source check.');
      const receivedAt=Date.now();
      await chrome.storage.session.set({[key]:{...current,snapshot,receivedAt}});
      return {ok:true,snapshot,receivedAt};
    }finally{busy.delete(key);}
  })().then(respond).catch(()=>respond(failure('The source tab is unavailable. Previous picks have not been cleared.')));
  return true;
});
chrome.tabs.onRemoved.addListener(async tabId=>{
  const entries=await chrome.storage.session.get(null);
  for(const [key,value] of Object.entries(entries))if(key.startsWith(PREFIX)&&(value.sourceTabId===tabId||value.receiverTabId===tabId))await chrome.storage.session.remove(key);
});
