import test from 'node:test';
import assert from 'node:assert/strict';
import {UPSTREAM,OLD_JOBS,checkDependencies,checkCutover,assessMonitor} from './gates.mjs';
const now='2026-09-19T10:00:00Z';
function fixture(){
 const policy={project:'iezwazccqqrhrjupxzvf',production_authorized:true,scope:'preseason',status:'approved',source_revision:'a'.repeat(64),reviewed_at:'2026-09-18',review_after:'2026-09-21',sha256:'b'.repeat(64)};
 const snapshot={jobs:[...UPSTREAM.map(jobid=>({jobid,active:true})),...structuredClone(OLD_JOBS)],
  runs:UPSTREAM.map(jobid=>({jobid,runid:jobid,status:'succeeded',start_time:'2026-09-19T08:58:00Z',end_time:'2026-09-19T08:58:02Z'})),draftBlockers:0,
  active:{revision:'c'.repeat(64),source_revision:policy.source_revision,last_refresh_at:'2026-09-19T09:40:00Z',last_refresh_status:'success'},outputVerified:true};
 const ready={expectedActiveRevision:snapshot.active.revision,policySha256:policy.sha256,
  ...Object.fromEntries(['replacementFullRunVerified','independentMonitorVerified','notificationDeliveryVerified','sourceInputsVerified','backupDurableAndVerified','rollbackRehearsed'].map(k=>[k,true]))};
 const latest={status:'success',startedAt:'2026-09-19T09:10:00Z',journalVerified:true,revision:snapshot.active.revision};
 return {policy,snapshot,ready,latest};
}
test('completed dependencies and all explicit gates permit a cutover proposal',()=>{
 const f=fixture();assert.equal(checkCutover(f.snapshot,f.ready,f.policy,now).ready,true);
 for(const j of f.snapshot.jobs)if([31,34].includes(j.jobid))j.active=false;
 assert.equal(assessMonitor(f.snapshot,f.latest,f.policy,now).healthy,true);
});
for(const fault of ['missing','newer-failed','running','old-cycle','future-end','disabled'])test('dependency gate rejects '+fault,()=>{
 const f=fixture();
 if(fault==='missing')f.snapshot.runs.shift();
 if(fault==='newer-failed')f.snapshot.runs.push({...f.snapshot.runs[0],status:'failed',start_time:'2026-09-19T09:00:00Z'});
 if(fault==='running'){f.snapshot.runs[0].status='running';f.snapshot.runs[0].end_time=null;}
 if(fault==='old-cycle')f.snapshot.runs[0].start_time='2026-09-18T08:58:00Z';
 if(fault==='future-end')f.snapshot.runs[0].end_time='2026-09-19T11:00:00Z';
 if(fault==='disabled')f.snapshot.jobs[0].active=false;
 assert.throws(()=>checkDependencies(f.snapshot,now));
});
test('before the daily deadline, the preceding completed cycle is eligible',()=>{
 const f=fixture();for(const r of f.snapshot.runs){r.start_time='2026-09-18T08:58:00Z';r.end_time='2026-09-18T08:58:02Z';}
 assert.equal(checkDependencies(f.snapshot,'2026-09-19T04:00:00Z').cycle,'2026-09-18');
});
for(const key of ['notificationDeliveryVerified','independentMonitorVerified','backupDurableAndVerified','rollbackRehearsed','sourceInputsVerified'])test('cutover refuses unverified '+key,()=>{
 const f=fixture();f.ready[key]=false;assert.throws(()=>checkCutover(f.snapshot,f.ready,f.policy,now));
});
for(const fault of ['expired','extended','staging-policy','cron-drift','draft','changed-parent'])test('cutover rejects '+fault,()=>{
 const f=fixture();let time=now;
 if(fault==='expired')time='2026-09-21T00:00:00Z';
 if(fault==='extended')f.policy.review_after='2026-10-01';
 if(fault==='staging-policy')f.policy.production_authorized=false;
 if(fault==='cron-drift')f.snapshot.jobs.at(-1).schedule='* * * * *';
 if(fault==='draft')f.snapshot.draftBlockers=1;
 if(fault==='changed-parent')f.snapshot.active.revision='d'.repeat(64);
 assert.throws(()=>checkCutover(f.snapshot,f.ready,f.policy,time));
});
for(const fault of ['failed','stuck','no-worker','stale','bad-output','mismatch','missing-journal','missing-cycle','legacy-enabled'])test('independent monitor detects '+fault,()=>{
 const f=fixture();
 for(const j of f.snapshot.jobs)if([31,34].includes(j.jobid))j.active=false;
 if(fault==='failed')f.latest.status='failed';
 if(fault==='stuck'){f.latest.status='running';f.latest.startedAt='2026-09-19T09:00:00Z';}
 if(fault==='no-worker')f.latest=null;
 if(fault==='stale')f.snapshot.active.last_refresh_at='2026-09-17T09:40:00Z';
 if(fault==='bad-output')f.snapshot.outputVerified=false;
 if(fault==='mismatch')f.latest.revision='d'.repeat(64);
 if(fault==='missing-journal')f.latest.journalVerified=false;
 if(fault==='missing-cycle')f.latest.startedAt='2026-09-18T09:10:00Z';
 if(fault==='legacy-enabled')f.snapshot.jobs.find(j=>j.jobid===31).active=true;
 assert.equal(assessMonitor(f.snapshot,f.latest,f.policy,now).healthy,false);
});
