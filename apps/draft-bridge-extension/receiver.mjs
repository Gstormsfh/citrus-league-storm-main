const match=/^#citrus-bridge=([a-p]{32})\.([0-9a-f-]{36})$/.exec(location.hash);
const el=id=>document.getElementById(id);
let stopped=false,pending=false,lastReceipt=0,identity=null;
function state(label,detail,stale=true){el('state').textContent=label;el('detail').textContent=detail;document.querySelector('.status').dataset.stale=String(stale);}
function send(type){return new Promise((resolve,reject)=>{
 if(!match||!globalThis.chrome?.runtime?.sendMessage){reject(new Error('Open this review from the installed Citrus preview extension.'));return;}
 const timer=setTimeout(()=>reject(new Error('The source check timed out. Previous picks are retained.')),5000);
 chrome.runtime.sendMessage(match[1],{type,nonce:match[2]},response=>{
  clearTimeout(timer);
  if(chrome.runtime.lastError)reject(new Error('Connection unavailable. Reconnect from the ESPN draft room.'));
  else resolve(response);
 });
});}
function rows(target,values){const fragment=document.createDocumentFragment();for(const row of values){const tr=document.createElement('tr');for(const value of row){const td=document.createElement('td');td.textContent=String(value);tr.append(td);}fragment.append(tr);}el(target).replaceChildren(fragment);}
async function poll(){
 if(stopped||pending)return;pending=true;
 try{
  const result=await send('SNAPSHOT');if(stopped)return;
  if(!result?.ok)throw new Error(result?.message??'Source not ready. Previous picks are retained.');
  const s=result.snapshot,now=Date.now();
  if(!s?.ok||s.version!==1||s.platform!=='espn'||!Array.isArray(s.picks)||s.picks.length>3200||!Number.isFinite(result.receivedAt)||result.receivedAt>now+1000||now-result.receivedAt>6000)throw new Error('The source snapshot is stale or invalid. Previous picks are retained.');
  const key=`${s.platform}:${s.leagueId}:${s.season}`;
  if(identity&&identity!==key)throw new Error('The source league changed. Reconnect explicitly.');
  identity=key;lastReceipt=result.receivedAt;
  el('count').textContent=String(s.picks.length);el('draft-state').textContent=s.status==='in_progress'?'In progress':s.status==='paused'?'Paused':'Finished';
  el('checked').textContent=new Date(lastReceipt).toLocaleTimeString();el('league').textContent=s.title;
  el('identity').textContent=`ESPN league ${s.leagueId} · ${s.teams.length} teams · ${s.totalRounds} rounds`;
  rows('picks',[...s.picks].reverse().map(p=>[p.overallPick,p.name,s.teams.find(t=>t.id===p.externalTeamId)?.name??'Unknown',p.externalPlayerId]));
  rows('scoring',s.rules.scoring.map(r=>[r.group,r.label,r.weight]));
  state('Connected to ESPN',s.status==='finished'?'Draft complete. The full confirmed history is retained.':'Following confirmed picks. Keep the source draft tab open.',false);
 }catch(error){if(!stopped)state('Updates paused',error.message);}
 finally{pending=false;}
}
el('disconnect').addEventListener('click',()=>{stopped=true;void send('DISCONNECT').catch(()=>{});history.replaceState(null,'',location.pathname);el('disconnect').disabled=true;state('Disconnected','Previous picks remain visible for review. No more source checks will run.');});
setInterval(()=>{if(!stopped&&lastReceipt&&Date.now()-lastReceipt>6000)state('Updates paused','No fresh source check. Previous picks are retained.');void poll();},2000);
void poll();
