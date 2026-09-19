import {captureEspnDraft} from './capture.mjs';
import {captureYahooDraft} from './yahoo-capture.mjs';
import {RECEIVER_ORIGIN,RECEIVER_PATH} from './config.mjs';
import {validateCompanionBundle} from './bundle.mjs';
import {captureLeagueSettings} from './league-capture.mjs';
const PREFIX='draft-bridge:',MAX_AGE=6*60*60*1000;
const busy=new Set(),starting=new Set(),revoked=new Set(),closedTabs=new Set();
const failure=message=>({ok:false,message});
async function removePair(key){revoked.add(key);await chrome.storage.session.remove(key);}
async function savePair(key,pair){if(revoked.has(key))return false;await chrome.storage.session.set({[key]:pair});return true;}
async function editPair(key,operation){
 if(busy.has(key))return failure('A source check or save is running. Retry in a moment.');
 busy.add(key);
 try{const current=(await chrome.storage.session.get(key))[key];if(!current||revoked.has(key))return failure('This sidebar was disconnected.');return await operation(current);}
 finally{busy.delete(key);}
}
function receiver(url){try{const u=new URL(url);return u.origin===RECEIVER_ORIGIN&&[RECEIVER_PATH,'/create-league'].includes(u.pathname);}catch{return false;}}
function panelSource(sender){
  try{const u=new URL(sender.url);if(sender.id!==chrome.runtime.id||u.protocol!=='chrome-extension:'||u.host!==chrome.runtime.id||u.pathname!=='/sidepanel.html'||!/^\d+$/.test(u.searchParams.get('source')??''))return null;
    return Number(u.searchParams.get('source'));}catch{return null;}
}
const identity=s=>s.platform+':'+(s.roomId??s.leagueId)+':'+s.season;
async function capture(tabId,previous,platform=previous?.platform??'espn'){
  const reader=platform==='yahoo'?captureYahooDraft:captureEspnDraft;
  const replies=await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},world:'ISOLATED',func:reader,args:[previous]});
  if(replies.length!==1||replies[0].frameId!==0)return failure('The main draft frame could not be verified.');
  return replies[0].result;
}
async function pull(key,pair){
  if(pair.snapshot.kind==='league-settings')return {ok:true,...pair};
  if(busy.has(key))return failure('A source check is already running.');
  if(Date.now()-pair.receivedAt<1000)return {ok:true,...pair};
  busy.add(key);
  try{
    const snapshot=await capture(pair.sourceTabId,pair.snapshot);
    if(!snapshot?.ok)return snapshot??failure('The source draft did not respond.');
    if(identity(snapshot)!==identity(pair.snapshot))return failure('The draft changed. Reconnect explicitly.');
    const current=(await chrome.storage.session.get(key))[key];
    if(!current)return failure('Disconnected during the source check.');
    const next={...current,snapshot,receivedAt:Date.now()};
    if(!await savePair(key,next))return failure('Disconnected during the source check.');
    return {ok:true,...next};
  }finally{busy.delete(key);}
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  const popup=sender.id===chrome.runtime.id&&sender.url===chrome.runtime.getURL('popup.html');
  const source=panelSource(sender);
  if(['START','READ_LEAGUE'].includes(message?.type)){
    if(!popup||!Number.isInteger(message.tabId)||!['espn','yahoo'].includes(message.platform??'espn'))return;
    if(starting.has(message.tabId)){respond(failure('This draft is already connecting.'));return;}
    starting.add(message.tabId);
    (async()=>{
      const entries=await chrome.storage.session.get(null);
      const previous=Object.entries(entries).find(([key,p])=>key.startsWith(PREFIX)&&p.sourceTabId===message.tabId&&Date.now()-p.createdAt<MAX_AGE);
      const replies=message.type==='READ_LEAGUE'?await chrome.scripting.executeScript({target:{tabId:message.tabId,frameIds:[0]},world:'ISOLATED',func:captureLeagueSettings}):null;
      const previousDraft=previous?.[1].snapshot.kind==='league-settings'?null:previous?.[1].snapshot??null;
      const snapshot=replies?(replies.length===1&&replies[0].frameId===0?replies[0].result:failure('Settings frame could not be verified.')):await capture(message.tabId,previousDraft,message.platform??'espn');
      if(!snapshot?.ok)return snapshot??failure('Could not read the draft room.');
      if(closedTabs.has(message.tabId))return failure('The source tab closed while connecting.');
      if(previous&&previous[1].snapshot.kind===snapshot.kind&&identity(previous[1].snapshot)===identity(snapshot)){
        return editPair(previous[0],async current=>await savePair(previous[0],{...current,snapshot,receivedAt:Date.now()})?{ok:true}:failure('Disconnected while reconnecting.'));
      }
      if(previous)return failure('Save your notebook, then disconnect this sidebar before changing drafts or reading league settings.');
      for(const [key,p] of Object.entries(entries))if(key.startsWith(PREFIX)&&(Date.now()-p.createdAt>MAX_AGE||p.sourceTabId===message.tabId))await removePair(key);
      const remaining=await chrome.storage.session.get(null);
      if(Object.keys(remaining).filter(k=>k.startsWith(PREFIX)).length>=20)return failure('Close unused draft connections first.');
      const key=PREFIX+crypto.randomUUID();
      // Connecting NEVER opens a tab or leaves the provider's draft.
      await chrome.storage.session.set({[key]:{sourceTabId:message.tabId,receiverTabId:null,createdAt:Date.now(),snapshot,receivedAt:Date.now()}});
      return {ok:true};
    })().then(respond).catch(()=>respond(failure('Could not connect. Reopen the source draft and retry.'))).finally(()=>starting.delete(message.tabId));
    return true;
  }
  if(source===null||!['PANEL_READ','PREPARE_KIT','PREPARE_IMPORT','SAVE_NOTE','DISCONNECT'].includes(message?.type))return;
  (async()=>{
    const entries=await chrome.storage.session.get(null);
    const found=Object.entries(entries).find(([key,p])=>key.startsWith(PREFIX)&&p.sourceTabId===source);
    if(!found)return failure('Connect this draft using the Citrus toolbar button.');
    const [key,pair]=found;
    if(message.type==='DISCONNECT'||Date.now()-pair.createdAt>MAX_AGE){await removePair(key);return failure('Disconnected. Your source draft has not changed.');}
    if(message.type==='PREPARE_KIT'||message.type==='PREPARE_IMPORT'){
      const importing=message.type==='PREPARE_IMPORT';
      if(importing!==(pair.snapshot.kind==='league-settings'))return failure('Open the matching setup from this sidebar.');
      const receiverPath=importing?'/create-league':RECEIVER_PATH;
      // Explicit one-time sign-in / purchased-kit handoff, never on connection.
      return editPair(key,async current=>{
        const tab=await chrome.tabs.create({url:`${RECEIVER_ORIGIN}${receiverPath}?tab=${importing?'create':'pricing'}#citrus-bridge=${chrome.runtime.id}.${key.slice(PREFIX.length)}`});
        return await savePair(key,{...current,receiverTabId:tab.id,receiverPath})?{ok:true}:failure('Disconnected during setup. Reconnect from the draft.');
      });
    }
    if(message.type==='SAVE_NOTE'){
      return editPair(key,async current=>{
      if(!current.bundle||current.bundle.file.kit.fingerprint!==message.fingerprint||!current.bundle.file.kit.players.some(p=>p.key===message.key)
        ||!message.patch||Object.keys(message.patch).some(k=>!['note','target'].includes(k))
        ||('note'in message.patch&&(typeof message.patch.note!=='string'||message.patch.note.length>500))
        ||('target'in message.patch&&typeof message.patch.target!=='boolean'))return failure('Invalid notebook update.');
        const rows=current.bundle.file.progress.rows,old=rows.find(r=>r.key===message.key);
        const next={key:message.key,drafted:false,target:false,note:'',...old,...message.patch};
        const updated={...current,bundle:{...current.bundle,file:{...current.bundle.file,progress:{...current.bundle.file.progress,rows:[...rows.filter(r=>r.key!==message.key),next]}}}};
        return await savePair(key,updated)?{ok:true}:failure('Disconnected before your note was saved.');
      });
    }
    return pull(key,pair);
  })().then(respond).catch(()=>respond(failure('The source is unavailable. Your last board and notes are retained.')));
  return true;
});
chrome.runtime.onMessageExternal.addListener((message,sender,respond)=>{
  if(!receiver(sender.url)||sender.frameId!==0||!sender.tab?.id||!['SNAPSHOT','LEAGUE_SETTINGS','INSTALL_KIT','DISCONNECT'].includes(message?.type)
    ||!/^[0-9a-f-]{36}$/.test(message?.nonce??''))return;
  const key=PREFIX+message.nonce;
  (async()=>{
    const pair=(await chrome.storage.session.get(key))[key];
    if(!pair||pair.receiverTabId!==sender.tab.id||new URL(sender.url).pathname!==(pair.receiverPath??RECEIVER_PATH))return failure('This tab has no handoff. Open setup from your Citrus sidebar.');
    if(Date.now()-pair.createdAt>MAX_AGE||message.type==='DISCONNECT'){await removePair(key);return failure('Connection expired. Reconnect from the draft.');}
    if(message.type==='INSTALL_KIT'){
      if(pair.snapshot.kind==='league-settings')return failure('A settings capture cannot be used as a draft connection.');
      const bundle=validateCompanionBundle(message.bundle);
      if(bundle.platform!==pair.snapshot.platform)return failure('This kit belongs to a different provider.');
      return editPair(key,async current=>{
        if(current.receiverTabId!==sender.tab.id)return failure('This setup was replaced. Reopen kit setup from the sidebar.');
        if(current.bundle)return failure('A board is already attached. Disconnect before replacing it; save your notes first.');
        return await savePair(key,{...current,bundle})?{ok:true}:failure('Disconnected before the board was attached.');
      });
    }
    if(message.type==='LEAGUE_SETTINGS')return pair.snapshot.kind==='league-settings'?{ok:true,settings:pair.snapshot}:failure('No league settings were captured.');
    const result=await pull(key,pair);
    return result.ok?{ok:true,snapshot:result.snapshot,receivedAt:result.receivedAt}:result;
  })().then(respond).catch(()=>respond(failure('Could not prepare this companion. Your existing board is unchanged.')));
  return true;
});
chrome.tabs.onRemoved.addListener(async tabId=>{
  closedTabs.add(tabId);
  const entries=await chrome.storage.session.get(null);
  for(const [key,p] of Object.entries(entries))if(key.startsWith(PREFIX)){
    if(p.sourceTabId===tabId)await removePair(key);
    // Keep a closed setup tab's binding inert. Chrome does not reuse tab IDs
    // during a session; avoiding a write here also avoids racing note saves.
  }
});
