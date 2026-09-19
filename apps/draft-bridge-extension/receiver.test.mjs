import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const html=await readFile(new URL('./receiver.html',import.meta.url),'utf8');
const code=await readFile(new URL('./receiver.mjs',import.meta.url),'utf8');
const fragment='#citrus-bridge='+'a'.repeat(32)+'.12345678-1234-1234-1234-123456789abc';
const good=()=>({ok:true,receivedAt:Date.now(),snapshot:{ok:true,version:1,platform:'espn',leagueId:'123',season:2026,title:'Practice',status:'in_progress',totalRounds:1,teams:[{id:'1',name:'Test team'}],picks:[{overallPick:1,name:'Real player',externalPlayerId:'999',externalTeamId:'1'}],rules:{scoring:[{group:'skater',label:'Goals',weight:2}]}}});
async function setup(response=good(),hash=fragment){
 const dom=new JSDOM(html,{url:'http://127.0.0.1:8776/draft-kit'+hash,runScripts:'outside-only'});
 const w=dom.window;let interval,callback,answer=response;const requests=[];
 w.setInterval=fn=>{interval=fn;};
 w.setTimeout=()=>1;w.clearTimeout=()=>{};
 w.chrome={runtime:{sendMessage:(id,msg,cb)=>{requests.push({id,msg});callback=cb;if(answer!==null)cb(answer);}}};
 w.eval(code);await Promise.resolve();await Promise.resolve();
 return{w,requests,get:id=>w.document.getElementById(id),set:v=>{answer=v;},tick:async()=>{interval();await Promise.resolve();await Promise.resolve();},reply:v=>callback(v)};
}
test('missing pairing is honestly disconnected, with no extension requests',async()=>{const t=await setup(good(),'');assert.match(t.get('detail').textContent,/installed Citrus preview/);assert.equal(t.requests.length,0);});
test('confirmed picks render and HTML in names stays inert text',async()=>{const r=good();r.snapshot.picks[0].name='<img src=x onerror=alert(1)>';const t=await setup(r);assert.equal(t.get('state').textContent,'Connected to ESPN');assert.equal(t.get('count').textContent,'1');assert.equal(t.get('picks').querySelector('img'),null);assert.match(t.get('picks').textContent,/<img/);});
test('failed update keeps prior picks and visibly pauses the source',async()=>{const t=await setup();t.set({ok:false,message:'Incomplete history'});await t.tick();assert.equal(t.get('state').textContent,'Updates paused');assert.equal(t.get('count').textContent,'1');assert.match(t.get('picks').textContent,/Real player/);});
test('stale snapshots cannot overwrite the current draft',async()=>{const t=await setup();const stale=good();stale.receivedAt-=10000;stale.snapshot.picks=[];t.set(stale);await t.tick();assert.equal(t.get('count').textContent,'1');assert.equal(t.get('state').textContent,'Updates paused');});
test('a source identity change requires explicit reconnect',async()=>{const t=await setup();const next=good();next.snapshot.leagueId='456';t.set(next);await t.tick();assert.match(t.get('detail').textContent,/league changed/);assert.match(t.get('identity').textContent,/123/);});
test('disconnect prevents late replies and further polling',async()=>{const t=await setup(null);t.get('disconnect').click();const before=t.requests.length;t.reply(good());await Promise.resolve();await t.tick();assert.equal(t.requests.length,before);assert.equal(t.get('state').textContent,'Disconnected');assert.equal(t.get('count').textContent,'0');assert.equal(t.w.location.hash,'');});
test('Yahoo visibly distinguishes room observations and unmapped category values',async()=>{const r=good();Object.assign(r.snapshot,{platform:'yahoo',roomId:'555',leagueId:null,season:null,teamCount:8,teams:[],rules:{scoringType:'Head-to-Head',scoring:[{group:'source',label:'Goals',sourceValue:0,weight:null}]}});r.snapshot.picks[0].ownerLabel='Team label';const t=await setup(r);assert.equal(t.get('state').textContent,'Connected to Yahoo');assert.match(t.get('identity').textContent,/mapping unverified/);assert.match(t.get('picks').textContent,/Team label/);assert.match(t.get('scoring').textContent,/not mapped to points/);});
