import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const extensionId='a'.repeat(32),web='https://citrusfantasysports.com/draft-kit';
const bundle=()=>({version:1,platform:'espn',scoringVerified:false,file:{kind:'citrus-connected-desk',version:1,kit:{fingerprint:'a'.repeat(64),players:[{key:'canonical:8478402'}]},progress:{rows:[]}},mappings:[{key:'canonical:8478402',externalPlayerId:'42'}]});
let generation=0;
async function setup(){
 const listeners={},storage={},executions=[],tabs=[];
 let answer={ok:true,version:1,platform:'espn',picks:[],leagueId:'123',season:2026};
 globalThis.chrome={
  runtime:{id:extensionId,getURL:p=>`chrome-extension://${extensionId}/${p}`,onMessage:{addListener:f=>listeners.internal=f},onMessageExternal:{addListener:f=>listeners.external=f}},
  scripting:{executeScript:async request=>{executions.push(request);if(answer instanceof Error)throw answer;return [{frameId:0,result:answer}];}},
  tabs:{create:async request=>{tabs.push(request);return{id:21+tabs.length};},onRemoved:{addListener:f=>listeners.removed=f}},
  storage:{session:{get:async key=>structuredClone(key===null?{...storage}:{[key]:storage[key]}),set:async values=>Object.assign(storage,structuredClone(values)),remove:async key=>{delete storage[key];}}}
 };
 await import(`./worker.mjs?test=${generation++}`);
 const internalSender={id:extensionId,url:`chrome-extension://${extensionId}/popup.html`};
 const externalSender={url:web,frameId:0,tab:{id:22}};
 const call=async(type,message,sender)=>{
  let resolve,called=false,value;const promise=new Promise(r=>{resolve=r;});
  const accepted=listeners[type](message,sender,v=>{called=true;value=v;resolve(v);});
  const result=accepted===true?await promise:called?value:undefined;
  await Promise.resolve();return result;
 };
 const start=()=>call('internal',{type:'START',tabId:11},internalSender);
 const key=()=>Object.keys(storage)[0];
 const nonce=()=>key()?.replace('draft-bridge:','');
 const panelSender={id:extensionId,url:`chrome-extension://${extensionId}/sidepanel.html?source=11`};
 const pull=(sender=panelSender,type='SNAPSHOT')=>sender===panelSender?call('internal',{type:type==='SNAPSHOT'?'PANEL_READ':type},sender):call('external',{type,nonce:nonce()},sender);
 const panel=(type,extra={})=>call('internal',{type,...extra},panelSender);
 return {listeners,storage,executions,tabs,call,start,key,pull,panel,panelSender,internalSender,externalSender,setAnswer:v=>{answer=v;}};
}
test('only explicit extension popup can start a source pairing',async()=>{const t=await setup();assert.equal(await t.call('internal',{type:'START',tabId:11},{id:'bad',url:t.internalSender.url}),undefined);assert.equal(t.executions.length,0);assert.equal((await t.start()).ok,true);assert.deepEqual(t.executions[0].target,{tabId:11,frameIds:[0]});assert.equal(t.executions[0].world,'ISOLATED');assert.equal(t.tabs.length,0);});
test('failed source read never opens a destination',async()=>{const t=await setup();t.setAnswer({ok:false,message:'Missing history'});assert.equal((await t.start()).ok,false);assert.equal(t.tabs.length,0);assert.equal(Object.keys(t.storage).length,0);});
test('rejects other origins, other paths and embedded frames',async()=>{const t=await setup();await t.start();for(const sender of [{...t.externalSender,url:'https://evil.example/draft-kit'},{...t.externalSender,url:web+'/other'},{...t.externalSender,frameId:1}])assert.equal(await t.pull(sender),undefined);assert.equal(t.executions.length,1);});
test('trusted page cannot steal another tab’s pairing',async()=>{const t=await setup();await t.start();assert.equal((await t.pull({...t.externalSender,tab:{id:33}})).ok,false);assert.equal(t.executions.length,1);});
test('rate limited reads retain the original receipt time',async()=>{const t=await setup();await t.start();const receipt=t.storage[t.key()].receivedAt;const r=await t.pull();assert.equal(r.receivedAt,receipt);assert.equal(t.executions.length,1);});
test('fresh source read passes previous identity and replaces full snapshot',async()=>{const t=await setup();await t.start();const old=t.storage[t.key()].snapshot;t.storage[t.key()].receivedAt-=2000;t.setAnswer({...old,picks:[{overallPick:1}]});const r=await t.pull();assert.equal(r.snapshot.picks.length,1);assert.deepEqual(t.executions[1].args[0],old);});
test('partial capture does not overwrite the last good snapshot',async()=>{const t=await setup();await t.start();const key=t.key(),old=t.storage[key].snapshot;t.storage[key].receivedAt-=2000;t.setAnswer({ok:false,message:'Incomplete history'});assert.equal((await t.pull()).ok,false);assert.equal(t.storage[key].snapshot,old);});
test('closing source deletes pairing; closing setup keeps sidebar connected',async()=>{const t=await setup();await t.start();await t.panel('PREPARE_KIT');await t.listeners.removed(22);assert.equal(Object.keys(t.storage).length,1);assert.equal((await t.pull()).ok,true);await t.listeners.removed(11);assert.equal(Object.keys(t.storage).length,0);});
test('disconnect and expiry remove pairing without another capture',async()=>{let t=await setup();await t.start();await t.panel('DISCONNECT');assert.equal(Object.keys(t.storage).length,0);t=await setup();await t.start();t.storage[t.key()].createdAt-=7*60*60*1000;assert.equal((await t.pull()).ok,false);assert.equal(Object.keys(t.storage).length,0);assert.equal(t.executions.length,1);});
test('exception details never expose provider or browser internals',async()=>{const t=await setup();await t.start();t.storage[t.key()].receivedAt-=2000;t.setAnswer(new Error('private browser details'));const r=await t.pull();assert.equal(r.ok,false);assert.doesNotMatch(r.message,/private browser/);});
test('production manifest has no persistent host, cookie or network permissions',async()=>{const manifest=JSON.parse(await readFile(new URL('./manifest.json',import.meta.url),'utf8'));assert.deepEqual(manifest.permissions,['activeTab','scripting','storage','sidePanel']);assert.equal(manifest.host_permissions,undefined);assert.equal(manifest.content_scripts,undefined);assert.deepEqual(manifest.externally_connectable.matches,[web+'*','https://citrusfantasysports.com/create-league*']);assert.match(manifest.content_security_policy.extension_pages,/connect-src 'none'/);});
test('Yahoo uses its own reader for initial and subsequent captures',async()=>{const t=await setup();t.setAnswer({ok:true,platform:'yahoo',roomId:'123',picks:[]});const r=await t.call('internal',{type:'START',tabId:11,platform:'yahoo'},t.internalSender);assert.equal(r.ok,true);assert.equal(t.executions[0].func.name,'captureYahooDraft');t.storage[t.key()].receivedAt-=2000;await t.pull();assert.equal(t.executions[1].func.name,'captureYahooDraft');});
test('unsupported platform cannot start an extension capture',async()=>{const t=await setup();assert.equal(await t.call('internal',{type:'START',tabId:11,platform:'unknown'},t.internalSender),undefined);assert.equal(t.executions.length,0);});
test('ESPN and Yahoo pairings coexist without sharing state or disconnects',async()=>{const t=await setup();t.setAnswer({ok:true,platform:'espn',leagueId:'111',picks:[]});await t.start();t.setAnswer({ok:true,platform:'yahoo',roomId:'222',picks:[{externalPlayerId:'555'}]});await t.call('internal',{type:'START',tabId:12,platform:'yahoo'},t.internalSender);const pairs=Object.entries(t.storage);assert.equal(pairs.length,2);const espn=pairs.find(([,p])=>p.sourceTabId===11),yahoo=pairs.find(([,p])=>p.sourceTabId===12);assert.notEqual(espn[0],yahoo[0]);assert.equal(espn[1].snapshot.platform,'espn');assert.equal(yahoo[1].snapshot.platform,'yahoo');const r=await t.call('internal',{type:'PANEL_READ'},{id:extensionId,url:`chrome-extension://${extensionId}/sidepanel.html?source=12`});assert.equal(r.snapshot.roomId,'222');await t.listeners.removed(11);assert.equal(Object.keys(t.storage).length,1);assert.equal(t.storage[yahoo[0]].snapshot.picks.length,1);});
test('kit handoff requires the exact paired tab and path and cannot replace an attached notebook',async()=>{
 const t=await setup();await t.start();await t.panel('PREPARE_KIT');
 const install=sender=>t.call('external',{type:'INSTALL_KIT',nonce:t.key().slice('draft-bridge:'.length),bundle:bundle()},sender);
 assert.equal((await install({...t.externalSender,url:'https://citrusfantasysports.com/create-league'})).ok,false);
 assert.equal((await install({...t.externalSender,tab:{id:99}})).ok,false);
 assert.equal((await install(t.externalSender)).ok,true);assert.equal((await install(t.externalSender)).ok,false);
});
test('notes persist across source updates and invalid edits cannot change picks',async()=>{
 const t=await setup();await t.start();t.storage[t.key()].bundle=bundle();
 assert.equal((await t.panel('SAVE_NOTE',{key:'canonical:8478402',fingerprint:'a'.repeat(64),patch:{note:'Target for next round',target:true}})).ok,true);
 assert.equal((await t.panel('SAVE_NOTE',{key:'canonical:8478402',fingerprint:'a'.repeat(64),patch:{drafted:true}})).ok,false);
 t.storage[t.key()].receivedAt-=2000;await t.pull();assert.equal(t.storage[t.key()].bundle.file.progress.rows[0].note,'Target for next round');
 assert.equal(t.storage[t.key()].bundle.file.progress.rows[0].drafted,false);
});
test('an attached board cannot be discarded by switching the popup into league import',async()=>{
 const t=await setup();await t.start();t.storage[t.key()].bundle=bundle();const key=t.key();
 t.setAnswer({ok:true,kind:'league-settings',platform:'espn',leagueId:'123',season:2026});
 const r=await t.call('internal',{type:'READ_LEAGUE',tabId:11},t.internalSender);assert.equal(r.ok,false);assert.equal(t.key(),key);assert.ok(t.storage[key].bundle);
});
test('settings handoff uses create-league only and never creates or edits a provider league',async()=>{
 const t=await setup();t.setAnswer({ok:true,kind:'league-settings',platform:'espn',leagueId:'123',season:2026});
 await t.call('internal',{type:'READ_LEAGUE',tabId:11},t.internalSender);assert.equal(t.tabs.length,0);assert.equal(t.executions[0].func.name,'captureLeagueSettings');
 assert.equal((await t.panel('PREPARE_KIT')).ok,false);assert.equal((await t.panel('PREPARE_IMPORT')).ok,true);assert.match(t.tabs[0].url,/\/create-league\?tab=create/);
 const sender={...t.externalSender,url:'https://citrusfantasysports.com/create-league'};
 const r=await t.call('external',{type:'LEAGUE_SETTINGS',nonce:t.key().slice('draft-bridge:'.length)},sender);assert.equal(r.settings.leagueId,'123');
});
test('setup and notebook saves serialize without overwriting notes or receiver binding',async()=>{
 const t=await setup();await t.start();t.storage[t.key()].bundle=bundle();
 let unblock,entered;const barrier=new Promise(r=>unblock=r),started=new Promise(r=>entered=r);
 chrome.tabs.create=async()=>{entered();await barrier;return{id:22};};
 const setupPending=t.panel('PREPARE_KIT');await started;
 const edit={key:'canonical:8478402',fingerprint:'a'.repeat(64),patch:{note:'Keep this note'}};
 assert.equal((await t.panel('SAVE_NOTE',edit)).ok,false);unblock();assert.equal((await setupPending).ok,true);
 assert.equal((await t.panel('SAVE_NOTE',edit)).ok,true);assert.equal(t.storage[t.key()].receiverTabId,22);assert.equal(t.storage[t.key()].bundle.file.progress.rows[0].note,'Keep this note');
});
test('disconnect during setup cannot resurrect the saved pairing',async()=>{
 const t=await setup();await t.start();let unblock,entered;const barrier=new Promise(r=>unblock=r),started=new Promise(r=>entered=r);
 chrome.tabs.create=async()=>{entered();await barrier;return{id:22};};const pending=t.panel('PREPARE_KIT');await started;
 await t.panel('DISCONNECT');unblock();assert.equal((await pending).ok,false);assert.equal(Object.keys(t.storage).length,0);
});
test('closing source while its first capture is pending never creates an orphan pairing',async()=>{
 const t=await setup();let unblock,entered;const barrier=new Promise(r=>unblock=r),started=new Promise(r=>entered=r);
 chrome.scripting.executeScript=async()=>{entered();await barrier;return[{frameId:0,result:{ok:true,platform:'espn',leagueId:'123',season:2026,picks:[]}}];};
 const pending=t.start();await started;await t.listeners.removed(11);unblock();assert.equal((await pending).ok,false);assert.equal(Object.keys(t.storage).length,0);
});
