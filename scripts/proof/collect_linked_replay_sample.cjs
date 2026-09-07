// Small, repeatable sample using only replay URLs already in archived NHL PBP.
const fs=require('fs'),crypto=require('crypto'),{chromium}=require('playwright');
const base=process.cwd()+'/scripts/proof/results',out=base+'/linked-replay-pilot-20260907';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const save=(n,v)=>fs.writeFileSync(out+'/'+n,JSON.stringify(v),{flag:'wx'});
(async()=>{
 fs.mkdirSync(out);const dir=base+'/historical-official-freeze-20260906/2025/pbp';
 const files=fs.readdirSync(dir).filter(f=>f.endsWith('.body.json')).sort();
 const selected=[files[0],files[Math.floor(files.length/2)],files.at(-1)].map(f=>{
  const body=fs.readFileSync(dir+'/'+f),g=JSON.parse(body),event=g.plays.find(p=>p.pptReplayUrl);
  if(!event)throw Error('Predeclared game has no linked replay');
  return {game:g.id,event:event.eventId,replay_url:event.pptReplayUrl,archive_body_sha256:hash(body),
   goal_details:event.details,roster:g.rosterSpots,homeTeamDefendingSide:event.homeTeamDefendingSide,homeTeamId:g.homeTeam.id};
 });
 save('declaration.json',{selection:'First, middle and last archived game filename; first linked event each',
  selected: selected.map(({roster,goal_details,...r})=>r),scope:'Retrospective source validation, not xG fitting',production_changed:false});
 const renderer='https://wsr.nhle.com/static/js/7580.64c1debe7450fc2d3c2f.bundle.js';
 const r=await fetch(renderer);if(!r.ok)throw Error('Renderer unavailable');const body=await r.text();
 if(!body.includes('Math.floor(Y.current/100)')||!body.includes('r:1===e.id?12:X'))throw Error('Renderer convention changed');
 fs.writeFileSync(out+'/renderer.js',body,{flag:'wx'});save('renderer-receipt.json',{url:renderer,sha256:hash(body),frame_interval_seconds:.1,puck_actor_id:1,
  coordinate_units:'NHL renderer units; not declared physical feet',frame_timing:'Renderer playback convention, not precision of PBP game clock'});
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const item of selected){const p=await browser.newPage();try{
  const response=p.waitForResponse(r=>r.url()===item.replay_url&&r.status()===200,{timeout:30000});
  await p.goto(`https://www.nhl.com/ppt-replay/goal/${item.game}/${item.event}`,{waitUntil:'domcontentloaded',timeout:30000});
  const r=await response,b=await r.body(),frames=JSON.parse(b);if(!Array.isArray(frames))throw Error('Unexpected schema');
  const file=`${item.game}-${item.event}.json`;fs.writeFileSync(out+'/'+file,b,{flag:'wx'});
  save(file+'.receipt.json',{...item,frames:frames.length,sha256:hash(b),retrieved_at:new Date().toISOString(),status:r.status()});
  console.log({game:item.game,event:item.event,frames:frames.length});
 }finally{await p.close();}}}finally{await browser.close();}
 save('health.json',{status:'complete-linked-replay-pilot',publishable:false,files:Object.fromEntries(fs.readdirSync(out).map(f=>[f,hash(fs.readFileSync(out+'/'+f))]))});
})().catch(e=>{console.error(e.message);process.exitCode=1;});
