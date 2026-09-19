/** Yahoo DOM observation only. Room IDs are NOT Yahoo API league keys.
 * Owner labels are not silently converted into team IDs. This preview must
 * resolve league identity/scoring separately before driving a paid Draft Desk.
 */
export function captureYahooDraft(previous=null,doc=document,href=location.href){
 const fail=(code,message)=>({ok:false,code,message});
 const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
 const positive=v=>/^[1-9]\d{0,11}$/.test(String(v));
 let url;try{url=new URL(href);}catch{return fail('wrong_page','Open a Yahoo hockey draft room.');}
 const path=/^\/draftclient\/hockey\/([1-9]\d{0,11})\/([1-9]\d{0,11})\/?$/.exec(url.pathname);
 if(url.origin!=='https://hockey.fantasysports.yahoo.com'||!path)return fail('wrong_page','Open the actual Yahoo hockey draft room, not its waiting room.');
 const roomId=path[1],viewerTeamId=path[2];
 if(previous&&(previous.platform!=='yahoo'||previous.roomId!==roomId||previous.viewerTeamId!==viewerTeamId))return fail('changed_room','The Yahoo room changed. Connect it explicitly.');
 const root=doc.querySelector('#main-0-DraftClientBootstrap-Proxy');
 if(!root)return fail('loading','Waiting for Yahoo’s hockey draft to render.');
 const texts=[...root.querySelectorAll('span')].filter(e=>!e.querySelector('span')).map(e=>clean(e.textContent));
 if(!texts.includes('Yahoo Fantasy Hockey Draft'))return fail('loading','The Yahoo hockey draft heading is not present.');
 const counters=texts.map(t=>/^(?:Your Turn|.+?'s Pick).*Round (\d+), Pick (\d+)$/.exec(t)).filter(Boolean);
 const finished=texts.includes('Draft Complete');
 if(!finished&&counters.length!==1)return fail('clock','The current Yahoo pick counter is not available. Previous picks are retained.');
 const roster=texts.map(t=>/^YOUR TEAM \(\d+\/(\d+)\)$/.exec(t)).filter(Boolean);
 const totalRounds=roster.length===1?Number(roster[0][1]):previous?.totalRounds;
 if(!Number.isInteger(totalRounds)||totalRounds<1||totalRounds>100)return fail('rounds','The draft roster size is not available.');
 if(previous&&previous.totalRounds!==totalRounds)return fail('rounds_changed','The Yahoo draft size changed. Reconnect explicitly.');
 const tables=[...root.querySelectorAll('table')].filter(t=>[...t.querySelectorAll('thead th')].map(e=>clean(e.textContent)).join('|')==='Pick|Player|Team');
 if(tables.length!==1)return fail('need_results','Open Yahoo Results → Round by Round to read the complete pick history.');
 const picks=[];let displayedRound=null;
 for(const row of tables[0].querySelectorAll('tbody tr')){
  const cells=[...row.querySelectorAll('td')];
  if(!cells.length){const r=/^Round (\d+)$/.exec(clean(row.textContent));if(!r)return fail('layout','The Yahoo history layout changed.');displayedRound=Number(r[1]);continue;}
  const players=cells[1]?.querySelectorAll('.ys-player[data-id]');
  const id=players?.length===1?players[0].getAttribute('data-id'):null;
  const name=players?.length===1?clean(players[0].querySelector('img[title]')?.getAttribute('title')):'';
  const ownerLabel=clean(cells[2]?.textContent),slot=clean(cells[0]?.textContent);
  if(cells.length!==3||!positive(id)||!positive(slot)||!name||name.length>120||!ownerLabel||ownerLabel.length>128||!displayedRound||displayedRound>totalRounds)return fail('pick_identity','A Yahoo pick is missing a reliable identity, owner or round.');
  picks.push({externalPlayerId:id,externalTeamId:ownerLabel==='Your Team'?viewerTeamId:null,ownerLabel,overallPick:Number(slot),round:displayedRound,name});
 }
 picks.sort((a,b)=>a.overallPick-b.overallPick);
 const firstRound=picks.filter(p=>p.round===1);
 // A completed first round establishes the number of seats; do not infer it
 // from partial owner coverage while that round is still drafting.
 const teamCount=Number(counters[0]?.[1])>1||picks.some(p=>p.round>1)||finished?firstRound.length:null;
 if(teamCount!==null&&(teamCount<2||teamCount>32||new Set(firstRound.map(p=>p.ownerLabel)).size!==teamCount))return fail('teams','Yahoo’s first-round ownership is incomplete or ambiguous.');
 const currentPick=finished&&teamCount?teamCount*totalRounds+1:Number(counters[0]?.[2]);
 if(!currentPick||picks.length!==currentPick-1||picks.some((p,i)=>p.overallPick!==i+1)
  ||new Set(picks.map(p=>p.externalPlayerId)).size!==picks.length
  ||(teamCount&&picks.some(p=>p.round!==Math.ceil(p.overallPick/teamCount))))return fail('incomplete','The Yahoo history does not match its pick counter. Previous picks are retained.');
 let rules=previous?.rules??{scoringType:'Unverified',roster:[],scoring:[]};
 const dialog=[...doc.querySelectorAll('dialog[open]')].find(d=>clean(d.querySelector('h1')?.textContent)==='League Settings');
 if(dialog){
  const typeLabel=[...dialog.querySelectorAll('span')].find(e=>clean(e.textContent)==='Scoring Type');
  const scoringType=clean(typeLabel?.nextElementSibling?.textContent);
  const values=[...dialog.querySelectorAll('div')].flatMap(e=>{
   const spans=[...e.children];if(spans.length!==2||spans.some(s=>s.tagName!=='SPAN'))return [];
   const label=clean(spans[0].textContent),raw=clean(spans[1].textContent);
   if(!/^.+ - .+$/.test(label))return [];
   return [{group:'source',label,sourceValue:raw===''?NaN:Number(raw),weight:null}];
  });
  if(!scoringType||!values.length||values.length>60||values.some(v=>!Number.isFinite(v.sourceValue))||new Set(values.map(v=>v.label)).size!==values.length)return fail('rules','Yahoo’s displayed scoring could not be read reliably.');
  const next={scoringType,roster:[],scoring:values};
  if(rules.scoringType!=='Unverified'&&JSON.stringify([rules.scoringType,rules.scoring.map(v=>[v.label,v.sourceValue])])!==JSON.stringify([next.scoringType,next.scoring.map(v=>[v.label,v.sourceValue])]))return fail('rules_changed','Yahoo’s scoring changed. Reconnect explicitly.');
  rules=next;
 }
 return {ok:true,version:1,platform:'yahoo',transport:'rendered-draft-room',roomId,viewerTeamId,
  leagueId:null,season:null,contextVerified:false,title:`Yahoo hockey draft room ${roomId}`,
  status:finished?'finished':'in_progress',currentPick,totalRounds,teamCount,teams:[],rules,picks};
}
