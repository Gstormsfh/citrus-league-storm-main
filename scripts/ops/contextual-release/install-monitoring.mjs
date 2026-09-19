import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {monitoringProposal,channels} from './monitoring.mjs';
const [mode,out]=process.argv.slice(2);assert.ok(['disabled','one-test-email'].includes(mode));
assert.ok(out&&!existsSync(out),'New private receipt directory required');
mkdirSync(out,{recursive:true,mode:0o700});
const token=execFileSync('gcloud',['auth','print-access-token'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
async function api(url,method='GET',body){
 const response=await fetch(url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('Google API HTTP '+response.status);
 return response.status===204?{}:await response.json();
}
function save(name,value){writeFileSync(out+'/'+name+'.json',JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});}
const endpoint='https://monitoring.googleapis.com/v3/projects/citrus-fantasy-prod/alertPolicies';
try{
 if(mode==='disabled'){
  const proposal=monitoringProposal();
  const metric=await api('https://logging.googleapis.com/v2/projects/citrus-fantasy-prod/metrics','POST',proposal.metric);
  save('metric',metric);
  const created=[];for(const policy of proposal.policies){assert.equal(policy.enabled,false);created.push(await api(endpoint,'POST',policy));save('policy-'+created.length,created.at(-1));}
  console.log(JSON.stringify({status:'INSTALLED_DISABLED',metric:metric.name,policies:created.map(p=>p.name),notificationsSent:false}));
 }else{
  const email=await api('https://monitoring.googleapis.com/v3/'+channels[0]);
  assert.equal(email.type,'email');assert.equal(email.enabled,true);
  const testId='citrus-contextual-release-20260919-one-email';
  const policy=await api(endpoint,'POST',{displayName:'CITRUS TEST: projection alert delivery, one email',enabled:false,combiner:'OR',
   notificationChannels:[channels[0]],alertStrategy:{notificationRateLimit:{period:'86400s'},autoClose:'86400s'},
   documentation:{mimeType:'text/markdown',content:'**Authorised one-time Citrus operations test.**\n\nThis verifies the existing email route before the contextual forecast release. No customer data, no customer charge, and no production outage is involved. Test ID: '+testId},
   conditions:[{displayName:'User-authorised single test event',conditionMatchedLog:{filter:'logName="projects/citrus-fantasy-prod/logs/citrus-contextual-release-test" AND jsonPayload.test_id="'+testId+'"'}}]});
  save('test-policy',policy);
  await api('https://monitoring.googleapis.com/v3/'+policy.name+'?updateMask=enabled','PATCH',{name:policy.name,enabled:true});
  save('test-armed',{at:new Date().toISOString(),testId,policy:policy.name,channel:channels[0]});
  // Save intent before the single write. Never blindly retry after uncertainty.
  save('test-event-intent',{testId,at:new Date().toISOString()});
  await api('https://logging.googleapis.com/v2/entries:write','POST',{logName:'projects/citrus-fantasy-prod/logs/citrus-contextual-release-test',
   resource:{type:'global',labels:{project_id:'citrus-fantasy-prod'}},entries:[{insertId:testId,severity:'INFO',
    jsonPayload:{test_id:testId,message:'Authorised one-time operations email delivery test. No customer impact.'}}]});
  save('test-event-submitted',{at:new Date().toISOString(),testId,policy:policy.name});
  console.log(JSON.stringify({status:'ONE_TEST_EVENT_SUBMITTED',policy:policy.name,testId,emailChannelOnly:true,deliveryConfirmed:false}));
 }
}catch(e){console.error(JSON.stringify({status:'STOPPED_NO_AUTOMATIC_RETRY',type:e.name,message:/^Google API HTTP [0-9]+$/.test(e.message)?e.message:undefined}));process.exitCode=1;}
