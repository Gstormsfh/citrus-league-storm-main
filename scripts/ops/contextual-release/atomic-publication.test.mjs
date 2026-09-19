import test from 'node:test';
import assert from 'node:assert/strict';
import {atomicPublish} from './atomic-publication.mjs';
import {OLD_JOBS,UPSTREAM} from './gates.mjs';
const now='2026-09-19T10:00:00Z';
function fixture(fault){
 const calls=[];const policy={project:'iezwazccqqrhrjupxzvf',production_authorized:true,scope:'preseason',status:'approved',
  source_revision:'a'.repeat(64),reviewed_at:'2026-09-18',review_after:'2026-09-21',sha256:'b'.repeat(64)};
 const readiness={expectedActiveRevision:'c'.repeat(64),policySha256:policy.sha256,
  ...Object.fromEntries(['replacementFullRunVerified','independentMonitorVerified','notificationDeliveryVerified','sourceInputsVerified','backupDurableAndVerified','rollbackRehearsed'].map(k=>[k,true]))};
 const snapshot={jobs:[...UPSTREAM.map(jobid=>({jobid,active:true})),...structuredClone(OLD_JOBS)],
  runs:UPSTREAM.map(jobid=>({jobid,status:'succeeded',start_time:'2026-09-19T08:58:00Z',end_time:'2026-09-19T08:58:01Z'})),
  active:{revision:readiness.expectedActiveRevision},draftBlockers:fault==='draft'?1:0};
 const common={daily_rows:84,distinct_revisions:1,matching_output_players:true,daily_ros_revision_matches:true,active_revision_matches:true,maximum_daily_ros_count_error:0};
 const health={skaters:{...common,skaters:1,all_contextual:true,all_uncertainty:true,all_required_daily_stats_present:true,
  all_required_ros_stats_present:true,optional_plus_minus_coverage_matches:true,maximum_gp_error:0},
  goalies:{...common,goalies:1,all_required_daily_stats:true,all_required_ros_stats:true,maximum_daily_ros_starts_error:0}};
 const db={query:async(sql,params)=>{
  calls.push({sql,params});
  if(sql==='COMMIT'&&fault==='commit-ack')throw Error('connection lost');
  if(sql.includes('canonical_contextual_dependencies()'))return {rows:[{value:snapshot}]};
  if(sql.includes("payload#>>'{p_candidate,parent_revision}'"))return {rows:[{parent:readiness.expectedActiveRevision,source:policy.source_revision,refreshed:now}]};
  if(sql==='SELECT payload::text exact FROM recovery_bundle')return {rows:[{exact:'{"decimal":0.123456789012345678901234}'}]};
  if(sql.includes("SELECT canonical_complete_contextual_refresh(payload"))return {rows:[{result:{status:fault==='completion'?'failed':'success'}}]};
  if(sql.includes('SELECT canonical_contextual_output_health()')){if(fault==='output')health.skaters.all_contextual=false;return {rows:[{value:health}]};}
  if(sql.includes('count(*)::int n FROM draft_freeze_blockers'))return {rows:[{n:0}]};
  return {rows:[]};
 }};
 const backup=async(stage,raw,sha)=>{calls.push({backup:stage,raw});if(fault===stage)throw Error('storage unavailable');return {verifiedSha256:sha};};
 return {calls,db,args:{exactRequest:'{"exact":0.123456789012345678901234}',policy,readiness,backup,clock:()=>now}};
}
test('publication commits only after two verified immutable backups and cron pause',async()=>{
 const f=fixture();const result=await atomicPublish(f.db,{...f.args,commit:true});assert.equal(result.status,'published');
 const events=f.calls.map(c=>c.backup??c.sql);
 assert.ok(events.indexOf('before')<events.findIndex(s=>s.startsWith('SELECT canonical_complete_contextual_refresh')));
 assert.ok(events.indexOf('recovery')<events.indexOf('COMMIT'));assert.equal(events.at(-1),'COMMIT');
 assert.equal(f.calls.find(c=>c.sql?.startsWith('INSERT INTO publication_request')).params[0],f.args.exactRequest);
 assert.ok(events.some(s=>s.includes('cron.alter_job(jobid,active:=false)')));
});
test('lost commit acknowledgement is explicitly uncertain, never reported as safe rollback',async()=>{
 const f=fixture('commit-ack');await assert.rejects(atomicPublish(f.db,{...f.args,commit:true}),e=>e.code==='COMMIT_UNCERTAIN');
 assert.ok(f.calls.some(c=>c.backup==='recovery'));
});
test('default mode never commits',async()=>{
 const f=fixture();assert.equal((await atomicPublish(f.db,f.args)).status,'rehearsed');
 assert.equal(f.calls.at(-1).sql,'ROLLBACK');assert.ok(!f.calls.some(c=>c.sql==='COMMIT'));
});
for(const fault of ['draft','before','completion','output','recovery'])test('atomic failure rolls everything back: '+fault,async()=>{
 const f=fixture(fault);await assert.rejects(atomicPublish(f.db,{...f.args,commit:true}));
 assert.equal(f.calls.at(-1).sql,'ROLLBACK');assert.ok(!f.calls.some(c=>c.sql==='COMMIT'));
 if(fault==='before'||fault==='draft')assert.ok(!f.calls.some(c=>c.sql?.startsWith('SELECT canonical_complete_contextual_refresh')));
});
