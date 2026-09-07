// Bounded public-source check. No credentials, endpoint enumeration or model writes.
const fs=require('fs'),crypto=require('crypto');
const out='scripts/proof/results/replay-nongoal-coverage-20260907';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const save=(n,v)=>fs.writeFileSync(`${out}/${n}`,JSON.stringify(v,null,2),{flag:'wx'});
const paths=(v,p='',s=new Set())=>{if(Array.isArray(v)){for(const x of v)paths(x,p+'[]',s);}else if(v&&typeof v==='object'){for(const [k,x] of Object.entries(v)){s.add(p+'.'+k);paths(x,p+'.'+k,s);}}return s;};
async function get(url,name){try{const r=await fetch(url,{signal:AbortSignal.timeout(20000)}),b=await r.text();fs.writeFileSync(`${out}/${name}.body`,b,{flag:'wx'});let json;try{json=JSON.parse(b);}catch{}const receipt={url,status:r.status,sha256:sha(b),retrieved_at:new Date().toISOString(),keys:json&&typeof json==='object'?Object.keys(json):[],bytes:Buffer.byteLength(b)};save(name+'.receipt.json',receipt);return {json,receipt};}catch(e){const receipt={url,error:e.message};save(name+'.receipt.json',receipt);return{receipt};}}
(async()=>{fs.mkdirSync(out);const games=[2025020001,2025020698,2025030416];
save('declaration.json',{games,selection:'Same three pilot games; first archived goal, saved shot, missed shot and blocked shot each',scope:'Public replay metadata availability and fresh PBP schema; no inference from 404 to universal absence'});
const result=[];
for(const game of games){const archive=JSON.parse(fs.readFileSync(`scripts/proof/results/historical-official-freeze-20260906/2025/pbp/${game}.body.json`));
const live=await get(`https://api-web.nhle.com/v1/gamecenter/${game}/play-by-play`,`${game}-pbp`);
const fresh=live.json,oldPaths=paths(archive);const row={game,pbp:live.receipt,new_paths:fresh?[...paths(fresh)].filter(p=>!oldPaths.has(p)):null,types:fresh?[...new Set(fresh.plays?.map(p=>p.typeDescKey))]:null,events:[]};
for(const type of ['goal','shot-on-goal','missed-shot','blocked-shot']){const e=archive.plays.find(p=>p.typeDescKey===type);if(!e)continue;const r=await get(`https://api-web.nhle.com/v1/ppt-replay/${game}/${e.eventId}`,`${game}-${e.eventId}-metadata`);row.events.push({type,event_id:e.eventId,archived_replay_url:e.pptReplayUrl??null,...r.receipt,metadata:r.json});}
result.push(row);console.log(JSON.stringify({game,new_paths:row.new_paths,events:row.events.map(e=>({type:e.type,status:e.status,keys:e.keys,bytes:e.bytes}))}));}
save('summary.json',{results:result,production_changed:false,scope:'Bounded sample; no proof of universal API absence'});
})().catch(e=>{console.error(e);process.exitCode=1;});
