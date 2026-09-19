// Served only by preview.mjs on loopback. Not packaged in the extension.
const pairing=/^#citrus-bridge=([a-p]{32})\.([0-9a-f-]{36})$/.exec(location.hash);
const el=id=>document.getElementById(id);let candidate=null;
function send(type,extra={}){return new Promise((resolve,reject)=>{
 if(!pairing||!globalThis.chrome?.runtime?.sendMessage){reject(Error('Open setup from the local Citrus extension sidebar.'));return;}
 const timeout=setTimeout(()=>reject(Error('The extension did not respond.')),8000);
 chrome.runtime.sendMessage(pairing[1],{type,nonce:pairing[2],...extra},result=>{clearTimeout(timeout);chrome.runtime.lastError?reject(Error('Reopen setup from the sidebar.')):resolve(result);});
});}
if(location.pathname==='/create-league'){el('prepare').textContent='Review captured league settings';el('explanation').textContent='Local read-only capture check. The production Create League form handles reviewed settings. This page creates no league and imports no rosters or history.';}
el('prepare').addEventListener('click',async()=>{
 el('prepare').disabled=true;el('status').textContent='Reading your paired sidebar…';
 try{
  if(location.pathname==='/create-league'){
   const r=await send('LEAGUE_SETTINGS');if(!r?.ok)throw Error(r?.message??'No captured settings.');
   el('status').textContent=`Captured ${r.settings.name}: ${r.settings.teamCount} teams, ${r.settings.roster.length} roster settings, ${r.settings.scoring.length} scoring categories. No league was created.`;return;
  }
  const source=await send('SNAPSHOT');if(!source?.ok||!['espn','yahoo'].includes(source.snapshot?.platform))throw Error(source?.message??'No valid source draft.');
  const response=await fetch(`/qa-${source.snapshot.platform}.json`);if(!response.ok)throw Error('Restart the local preview with a reviewed kit, editorial directory, observed identities and canonical directory.');
  const data=await response.json();if(!data.developmentOnly)throw Error('Not a development fixture.');candidate=data.bundle;
  el('review').hidden=false;el('title').textContent=source.snapshot.title;el('coverage').textContent=`${data.coverage.included} of ${data.coverage.total} reviewed-kit players in this local test. Their forecast values are unchanged.`;
  el('omitted').textContent='Not included in this test: '+(data.coverage.omitted.join(', ')||'none');el('status').textContent='Ready for an explicit test attachment. This does not unlock any paid website access.';
 }catch(e){el('status').textContent=e.message;}finally{el('prepare').disabled=false;}
});
el('attach').addEventListener('click',async()=>{
 if(!candidate)return;el('attach').disabled=true;
 try{const r=await send('INSTALL_KIT',{bundle:candidate});if(!r?.ok)throw Error(r?.message??'Could not attach.');el('status').textContent='QA tools attached. Return to your provider draft tab and use the Citrus sidebar. Draft only in the provider room.';}
 catch(e){el('status').textContent=e.message;el('attach').disabled=false;}
});
