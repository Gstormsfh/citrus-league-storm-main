// Resume the one authorized delivery test after checking whether policy
// propagation missed its initial event. Never create another policy/recipient.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync,existsSync} from 'node:fs';
const out='/tmp/citrus-production-one-test-email-20260919';
const receipt=out+'/propagation-recheck.json';
assert.equal(existsSync(receipt),false,'This recovery is single-use');
const token=execFileSync('gcloud',['auth','print-access-token'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
async function api(url,method='GET',body){
 const r=await fetch(url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
 assert.equal(r.ok,true,'Google API HTTP '+r.status);return r.json();
}
const project='projects/citrus-fantasy-prod',name=project+'/alertPolicies/6231453297946138211';
const base='https://monitoring.googleapis.com/v3/';
const policy=await api(base+name),alerts=await api(base+project+'/alerts?pageSize=100');
assert.equal(alerts.nextPageToken,undefined,'Inspect all incidents before proceeding');
assert.equal(alerts.alerts?.some(a=>a.policy?.name===name),false,'Existing incident: do not emit again');
assert.equal(policy.enabled,true);
assert.deepEqual(policy.notificationChannels,[project+'/notificationChannels/17961179598089416027']);
assert.equal(policy.alertStrategy.notificationRateLimit.period,'86400s');
assert.ok(Date.now()-Date.parse(policy.mutationRecord.mutateTime)>600000,'Wait for propagation');
const testId='citrus-contextual-release-20260919-one-email';
assert.equal(policy.conditions[0].conditionMatchedLog.filter,'logName="'+project+'/logs/citrus-contextual-release-test" AND jsonPayload.test_id="'+testId+'"');
writeFileSync(receipt,JSON.stringify({at:new Date().toISOString(),policy:name,existingIncident:false,rateLimitSeconds:86400,reason:'Initial event produced no incident after policy propagation; same policy enforces at most one notification in 24 hours.'},null,2),{flag:'wx',mode:0o600});
await api('https://logging.googleapis.com/v2/entries:write','POST',{logName:project+'/logs/citrus-contextual-release-test',resource:{type:'global',labels:{project_id:'citrus-fantasy-prod'}},entries:[{insertId:testId+'-propagated',severity:'INFO',jsonPayload:{test_id:testId,message:'Authorised one-time operations email delivery test. No customer impact. Policy propagation recheck.'}}]});
console.log(JSON.stringify({eventSubmitted:true,deliveryConfirmed:false,newPolicy:false,newRecipients:false}));
