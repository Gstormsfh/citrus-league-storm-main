// Existing email only. Requires a real healthy updated-monitor heartbeat.
// Never writes a test log or sends a test notification.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {reviewDuePolicy} from './monitoring.mjs';
const [out]=process.argv.slice(2);assert.ok(out&&!existsSync(out));
const logs=JSON.parse(execFileSync('gcloud',['logging','read',
 'resource.type="cloud_run_job" AND resource.labels.job_name="citrus-contextual-monitor" AND jsonPayload.event="contextual.independent.health" AND jsonPayload.review_notice_hours=24',
 '--project=citrus-fantasy-prod','--limit=1','--format=json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(logs.length,1);const event=logs[0].jsonPayload;
assert.equal(event.healthy,true);assert.equal(event.review_due,false);assert.deepEqual(event.review_items,[]);
assert.equal(event.phase,'published');assert.ok(Date.now()-Date.parse(logs[0].timestamp)<360000);
const token=execFileSync('gcloud',['auth','print-access-token'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
async function api(url,method='GET',body){
 const r=await fetch(url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
 assert.ok(r.ok,'Monitoring API HTTP '+r.status);return r.json();
}
const endpoint='https://monitoring.googleapis.com/v3/projects/citrus-fantasy-prod/alertPolicies';
const proposal=reviewDuePolicy(), all=[];let page;
do{const result=await api(endpoint+(page?'?pageToken='+encodeURIComponent(page):''));all.push(...result.alertPolicies??[]);page=result.nextPageToken;}while(page);
const matches=all.filter(p=>p.displayName===proposal.displayName);assert.ok(matches.length<=1,'Duplicate review notice policies');
mkdirSync(out,{mode:0o700});
function save(name,value){writeFileSync(out+'/'+name+'.json',JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});}
save('intent',{at:new Date().toISOString(),proposal,prior:matches,heartbeat:logs[0],testNotification:false});
const policy=matches[0]??await api(endpoint,'POST',proposal);
assert.deepEqual(policy.notificationChannels,proposal.notificationChannels,'Unexpected notification recipients');
assert.deepEqual(policy.conditions.map(c=>c.conditionMatchedLog),proposal.conditions.map(c=>c.conditionMatchedLog),'Unexpected condition');
save('created-or-existing',policy);
await api('https://monitoring.googleapis.com/v3/'+policy.name+'?updateMask=enabled','PATCH',{name:policy.name,enabled:true});
const actual=await api('https://monitoring.googleapis.com/v3/'+policy.name);assert.equal(actual.enabled,true);
save('enabled',actual);
save('receipt',{status:'ENABLED',at:new Date().toISOString(),policy:actual.name,revision:event.revision,healthy:true,
 reviewDue:false,existingOpsEmailOnly:true,testNotification:false,numericalChanges:false,datesExtended:false});
console.log(JSON.stringify({status:'ENABLED',policy:actual.name,out,testNotification:false}));
