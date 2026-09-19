// Arm only existing forecast alert policies after a fresh affirmative heartbeat.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {channels} from './monitoring.mjs';
const out='/tmp/citrus-production-monitoring-enabled-20260919';mkdirSync(out,{mode:0o700});
const token=execFileSync('gcloud',['auth','print-access-token'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
async function api(url,method='GET',body){const r=await fetch(url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});assert.equal(r.ok,true,'Google HTTP '+r.status);return r.json();}
function save(name,value){writeFileSync(out+'/'+name+'.json',JSON.stringify(value,null,2),{flag:'wx',mode:0o600});}
const logs=await api('https://logging.googleapis.com/v2/entries:list','POST',{
 resourceNames:['projects/citrus-fantasy-prod'],orderBy:'timestamp desc',pageSize:1,
 filter:'resource.type="cloud_run_job" AND resource.labels.job_name="citrus-contextual-monitor" AND jsonPayload.event="contextual.independent.health"'});
const entry=logs.entries?.[0];assert.equal(entry?.jsonPayload?.healthy,true);
assert.equal(entry.jsonPayload.revision,'c5afa098a549236a7913f815f87e40eca7289d7937258013041cb92f8d1d8e19');
assert.ok(Date.now()-Date.parse(entry.timestamp)<300000);save('healthy-heartbeat',entry);
for(const id of ['2871856187265138176','13074471003278600727']){
 const url='https://monitoring.googleapis.com/v3/projects/citrus-fantasy-prod/alertPolicies/'+id;
 const before=await api(url);assert.equal(before.enabled,false);assert.deepEqual(before.notificationChannels,channels);
 save(id+'-before',before);const after=await api(url+'?updateMask=enabled','PATCH',{name:before.name,enabled:true});
 assert.equal(after.enabled,true);save(id+'-enabled',after);
}
console.log(JSON.stringify({status:'ENABLED_AFTER_HEALTHY_PUBLICATION',recipientChanges:false,out}));
