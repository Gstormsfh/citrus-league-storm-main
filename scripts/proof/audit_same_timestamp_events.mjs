import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root='scripts/proof/results',dir=root+'/frozen-last-season-evaluation-20260907';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const h=JSON.parse(fs.readFileSync(dir+'/health.json')),raw=fs.readFileSync(dir+'/predictions.json');
assert.equal(hash(raw),h.files['predictions.json']);
const rows=JSON.parse(raw).filter(r=>r.timing_band==='same_clock'),cache=new Map(),result=[];
for(const r of rows){
 if(!cache.has(r.game_id)){
  const path=`${root}/historical-official-freeze-20260906/2025/pbp/${r.game_id}`;
  const body=fs.readFileSync(path+'.body.json'),receipt=JSON.parse(fs.readFileSync(path+'.receipt.json'));
  assert.equal(hash(body),receipt.body_sha256);cache.set(r.game_id,JSON.parse(body));
 }
 const game=cache.get(r.game_id),i=game.plays.findIndex(p=>p.eventId===r.event_id),current=game.plays[i],prior=game.plays[i-1];
 assert.equal(prior.typeCode,506);assert.equal(current.timeInPeriod,prior.timeInPeriod);
 assert.equal(current.periodDescriptor.number,prior.periodDescriptor.number);
 assert.equal(current.details.eventOwnerTeamId,prior.details.eventOwnerTeamId);
 const a=current.details,b=prior.details;
 const geometry=[a.xCoord,a.yCoord,b.xCoord,b.yCoord].every(Number.isFinite);
 const displacement=geometry?Math.hypot(a.xCoord-b.xCoord,a.yCoord-b.yCoord):null;
 const shooter=a.shootingPlayerId??a.scoringPlayerId??null,previousShooter=b.shootingPlayerId??b.scoringPlayerId??null;
 result.push({...r,prior_event_id:prior.eventId,current_event_type:current.typeCode,prior_sort_order:prior.sortOrder,current_sort_order:current.sortOrder,
  current_xy:[a.xCoord??null,a.yCoord??null],prior_xy:[b.xCoord??null,b.yCoord??null],displacement,
  same_location:geometry&&displacement===0,same_shooter:shooter!==null&&previousShooter!==null?shooter===previousShooter:null,
  shooter_id:shooter,prior_shooter_id:previousShooter});
}
const summarize=rr=>({events:rr.length,goals:rr.reduce((s,r)=>s+r.target,0),xg:rr.reduce((s,r)=>s+r.ensemble,0)});
const summary={all:summarize(result),same_location:summarize(result.filter(r=>r.same_location)),
 same_shooter:summarize(result.filter(r=>r.same_shooter===true)),different_shooter:summarize(result.filter(r=>r.same_shooter===false)),
 displacement_over_10ft:summarize(result.filter(r=>r.displacement>10)),by_type:Object.fromEntries([...new Set(result.map(r=>r.current_event_type))].map(t=>[t,summarize(result.filter(r=>r.current_event_type===t))]))};
fs.writeFileSync(root+'/same-timestamp-audit-20260907.json',JSON.stringify({summary,events:result,code_sha256:hash(fs.readFileSync(new URL(import.meta.url))),limitations:['Equal timestamps/locations/shooters do not prove duplication. No events or actuals removed.']},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(summary));
