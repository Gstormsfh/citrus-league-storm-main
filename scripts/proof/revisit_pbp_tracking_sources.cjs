// Source investigation only. No model fitting, production writes or access bypass.
const fs=require('fs'),crypto=require('crypto'),{chromium}=require('playwright');
const root=process.cwd(),base=root+'/scripts/proof/results';
const out=base+'/pbp-tracking-source-revisit-20260907';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const save=(n,v)=>fs.writeFileSync(out+'/'+n,JSON.stringify(v),{flag:'wx'});
(async()=>{
 fs.mkdirSync(out);
 const dir=base+'/historical-official-freeze-20260906/2025/pbp';
 const types={},linked={},detailKeys={},pins={};let games=0,events=0;
 for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.body.json'))){
  const b=fs.readFileSync(dir+'/'+f),raw=JSON.parse(b);pins[f]=hash(b);games++;
  for(const p of raw.plays??[]){events++;types[p.typeDescKey]=(types[p.typeDescKey]??0)+1;
   if(p.pptReplayUrl)linked[p.typeDescKey]=(linked[p.typeDescKey]??0)+1;
   for(const k of Object.keys(p.details??{}))if(/pass|assist|receiv|possess|track/i.test(k))detailKeys[k]=(detailKeys[k]??0)+1;
  }
 }
 save('coverage.json',{games,events,types,replay_links_by_event:linked,pass_related_detail_fields:detailKeys});save('archive-sha256.json',pins);
 const pageUrl='https://www.nhl.com/ppt-replay/goal/2025020001/258';
 const replayUrl='https://wsr.nhle.com/sprites/20252026/2025020001/ev258.json';
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage();const pending=page.waitForResponse(r=>r.url()===replayUrl&&r.status()===200,{timeout:30000});
  await page.goto(pageUrl,{waitUntil:'domcontentloaded',timeout:30000});
  const response=await pending,body=await response.body(),frames=JSON.parse(body);
  if(!Array.isArray(frames)||!frames.length||!frames.every(f=>f.onIce&&Number.isFinite(f.timeStamp)))throw Error('Unexpected replay schema');
  fs.writeFileSync(out+'/sample-replay.body.json',body,{flag:'wx'});
  const actorIds=[...new Set(frames.flatMap(f=>Object.values(f.onIce).map(a=>String(a.playerId))))];
  const deltas=[...new Set(frames.slice(1).map((f,i)=>f.timeStamp-frames[i].timeStamp))].sort((a,b)=>a-b);
  save('sample-receipt.json',{source_page:pageUrl,replay_url:replayUrl,status:response.status(),sha256:hash(body),
   frames:frames.length,first_timestamp:frames[0].timeStamp,last_timestamp:frames.at(-1).timeStamp,
   raw_timestamp_deltas:deltas,actor_player_ids:actorIds,actor_fields:Object.keys(Object.values(frames[0].onIce)[0]),
   coordinate_units:'not yet verified; do not interpret raw positions as feet',timestamp_units:'not yet independently verified',
   retrieval:'Normal public NHL Goal Visualizer page loaded its own replay resource',production_changed:false});
  save('health.json',{status:'complete-source-revisit',publishable:false,files:Object.fromEntries(fs.readdirSync(out).map(f=>[f,hash(fs.readFileSync(out+'/'+f))]))});
  console.log({games,events,linked,frames:frames.length,rawTimestampDeltas:deltas,actorIds});
 }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
