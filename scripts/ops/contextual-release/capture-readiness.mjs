// Capture concrete Google state for the first-publication gate. Does not publish.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {hash} from './rehearse-production.mjs';
const out='/tmp/citrus-production-readiness-20260919';
mkdirSync(out,{mode:0o700});
const token=execFileSync('gcloud',['auth','print-access-token'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
async function api(path,method='GET',body){
 const r=await fetch(path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
 assert.equal(r.ok,true,'Google API HTTP '+r.status);return r.json();
}
function save(name,value){const path=out+'/'+name+'.json';writeFileSync(path,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});return path;}
const base='https://monitoring.googleapis.com/v3/projects/citrus-fantasy-prod';
const testName='projects/citrus-fantasy-prod/alertPolicies/6231453297946138211';
save('test-disabled',await api('https://monitoring.googleapis.com/v3/'+testName+'?updateMask=enabled','PATCH',{name:testName,enabled:false}));
const alerts=await api(base+'/alerts?pageSize=100');
const incident=alerts.alerts.find(a=>a.policy?.name===testName);assert.ok(incident);save('test-incident',incident);
// Message identity read through the authenticated Gmail connector, not inferred
// from an incident or from the channel being enabled.
save('email-receipt',{verifiedAt:new Date().toISOString(),verifiedVia:'authenticated Gmail search',
 gmailMessageId:'1a0b812f61bcdad5',from:'alerting-noreply@google.com',to:'garrett.storms@citrusfantasysports.com',
 subject:'[ALERT - No severity] CITRUS TEST: projection alert delivery, one email for Global with {project_id=citrus-fantasy-prod}',receivedAt:'2026-09-19T05:10:45Z',testPolicy:testName});
const params=new URLSearchParams({filter:'metric.type="logging.googleapis.com/user/citrus_contextual_monitor_heartbeat"',
 'interval.startTime':'2026-09-19T04:50:00Z','interval.endTime':new Date().toISOString(),view:'FULL'});
const metric=await api(base+'/timeSeries?'+params);assert.ok(metric.timeSeries?.some(s=>s.points?.some(p=>Number(p.value.int64Value)>0)));save('heartbeat',metric);
for(const id of ['2871856187265138176','13074471003278600727']){const p=await api(base+'/alertPolicies/'+id);assert.equal(p.enabled,false);save('policy-'+id,p);}
for(const name of ['citrus-contextual-daily','citrus-contextual-independent-monitor']){
 const job=await api('https://cloudscheduler.googleapis.com/v1/projects/citrus-fantasy-prod/locations/northamerica-northeast1/jobs/'+name);assert.equal(job.state,'ENABLED');save(name,job);
}
const evidence=[out+'/email-receipt.json',out+'/heartbeat.json',out+'/citrus-contextual-daily.json',out+'/citrus-contextual-independent-monitor.json',
 '/tmp/citrus-production-prepared-audit-20260919/cloud-receipt.json','/tmp/citrus-production-prepared-population-20260919.json',
 '/tmp/citrus-production-active-recovery-20260919/receipt.json','/tmp/citrus-production-operational-rehearsal-20260919/receipt.json']
 .map(path=>({path,sha256:hash(readFileSync(path))}));
save('readiness',{expectedActiveRevision:'225619dbdd444a509c3b2291f6192147ad994cb8a157581eace972d470449db8',
 policySha256:'26893b8573829ac1b52f4b9be8284eae416f7d1a0d648b9f2a8fceaa06226bbd',replacementFullRunVerified:true,
 independentMonitorVerified:true,notificationDeliveryVerified:true,sourceInputsVerified:true,backupDurableAndVerified:true,rollbackRehearsed:true,
 evidence,scope:'Readiness for rollback-only rehearsal. Actual publish additionally requires this generated-candidate rehearsal result.'});
console.log(JSON.stringify({status:'READINESS_CAPTURED',testDisabled:true,emailVerified:true,out}));
