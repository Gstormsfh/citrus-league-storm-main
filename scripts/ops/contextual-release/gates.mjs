// Pure operational gates. No publication, notification or forecast arithmetic.
import assert from 'node:assert/strict';
export const UPSTREAM=[19,20,22,32,33];
export const OLD_JOBS=[
 {jobid:31,schedule:'50 8 * * *',command:'select public.rebuild_ros_projections(public.get_projection_target_season());',active:true},
 {jobid:34,schedule:'5 9 * * *',command:'select public.rebuild_player_projected_stats(public.get_projection_target_season());',active:true}];
const stamp=x=>{const t=Date.parse(x);assert.ok(Number.isFinite(t),'Invalid timestamp');return t;};
export function checkDependencies(snapshot,now){
 const time=stamp(now),day=new Date(time);day.setUTCHours(9,10,0,0);
 if(time<day.getTime())day.setUTCDate(day.getUTCDate()-1);
 const cycle=day.toISOString().slice(0,10),results=[];
 for(const id of UPSTREAM){
  const job=snapshot.jobs.find(j=>j.jobid===id);assert.equal(job?.active,true,'Required upstream job disabled');
  const runs=snapshot.runs.filter(r=>r.jobid===id).sort((a,b)=>stamp(b.start_time)-stamp(a.start_time));
  const run=runs[0];assert.ok(run,'Missing upstream execution');
  assert.equal(run.status,'succeeded','Latest upstream execution not successful');
  assert.ok(run.start_time.slice(0,10)>=cycle,'Required cycle not completed');
  const start=stamp(run.start_time),end=stamp(run.end_time);
  assert.ok(start<=end&&end<=time&&time-end<=26*3600000,'Upstream clock/freshness invalid');
  results.push({jobid:id,runid:run.runid,completedAt:run.end_time});
 }
 return {cycle,results};
}
export function checkPolicy(policy,now){
 const date=new Date(stamp(now)).toISOString().slice(0,10);
 assert.equal(policy.project,'iezwazccqqrhrjupxzvf');
 assert.equal(policy.production_authorized,true);assert.equal(policy.scope,'preseason');
 assert.equal(policy.status,'approved');assert.match(policy.source_revision,/^[a-f0-9]{64}$/);
 assert.ok(policy.reviewed_at<=date&&date<policy.review_after,'Preseason policy expired');
 // Extending this boundary requires a separately reviewed policy implementation.
 assert.equal(policy.review_after,'2026-09-21','Unreviewed expiry extension');
}
export function checkCutover(snapshot,readiness,policy,now){
 checkPolicy(policy,now);checkDependencies(snapshot,now);
 assert.deepEqual(snapshot.jobs.filter(j=>[31,34].includes(j.jobid)).sort((a,b)=>a.jobid-b.jobid),OLD_JOBS,'Legacy cron drift');
 assert.equal(snapshot.draftBlockers,0);assert.equal(snapshot.active.revision,readiness.expectedActiveRevision);
 for(const key of ['replacementFullRunVerified','independentMonitorVerified','notificationDeliveryVerified',
  'sourceInputsVerified','backupDurableAndVerified','rollbackRehearsed'])assert.equal(readiness[key],true,key);
 assert.equal(readiness.policySha256,policy.sha256);assert.match(readiness.policySha256??'',/^[a-f0-9]{64}$/);
 return {ready:true,retainOldPublishedOutputsUntilAtomicCommit:true,pauseOnly:[31,34],sourceRevision:policy.source_revision};
}
export function assessMonitor(snapshot,latest,policy,now){
 try{
  checkPolicy(policy,now);const dependency=checkDependencies(snapshot,now);
  assert.equal(snapshot.jobs.filter(j=>[31,34].includes(j.jobid)).length,2,'Missing legacy cron state');
  assert.ok(snapshot.jobs.filter(j=>[31,34].includes(j.jobid)).every(j=>j.active===false),'Legacy writer remains enabled');
  assert.equal(snapshot.active.source_revision,policy.source_revision,'Wrong active source');
  assert.equal(snapshot.active.last_refresh_status,'success','Active refresh failed');
  const age=stamp(now)-stamp(snapshot.active.last_refresh_at);
  assert.ok(age>=0&&age<=26*3600000,'Stale active output');
  assert.equal(snapshot.outputVerified,true,'Independent output check failed');
  assert.ok(latest,'Missing worker execution');
  const elapsed=stamp(now)-stamp(latest.startedAt);assert.ok(elapsed>=0&&elapsed<=26*3600000,'Missing scheduled start');
  const deadline=stamp(dependency.cycle+'T09:45:00Z');
  if(stamp(now)>=deadline)assert.ok(latest.startedAt.slice(0,10)>=dependency.cycle,'Required worker cycle missing');
  if(latest.status==='running')assert.ok(elapsed<=35*60000,'Stuck worker');
  else{
   assert.equal(latest.status,'success','Latest worker failed');
   assert.equal(latest.journalVerified,true,'Missing immutable journal evidence');
   assert.equal(latest.revision,snapshot.active.revision,'Worker/database revision mismatch');
  }
  return {event:'contextual.independent.health',checked_at:now,healthy:true,phase:latest.status};
 }catch(e){return {event:'contextual.independent.health',checked_at:now,healthy:false,reason:e.message.split('\n')[0]};}
}
