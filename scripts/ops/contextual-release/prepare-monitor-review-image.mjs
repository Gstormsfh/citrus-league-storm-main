// Build a monitor-only overlay. Does not deploy, publish, or renew any date.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {hash} from './rehearse-production.mjs';
const [policyPath,out]=process.argv.slice(2);assert.ok(policyPath&&out&&!existsSync(out));
const raw=readFileSync(policyPath);assert.equal(hash(raw),'26893b8573829ac1b52f4b9be8284eae416f7d1a0d648b9f2a8fceaa06226bbd');
const original=JSON.parse(raw), policy=structuredClone(original);
mkdirSync(resolve(out,'runtime'),{recursive:true,mode:0o700});
for(const name of ['run_contextual_monitor.py','review_deadlines.py']){
 const content=readFileSync(new URL('./runtime/'+name,import.meta.url));
 policy.methods_sha256['scripts/ops/'+name]=hash(content);
 writeFileSync(resolve(out,'runtime',name),content,{flag:'wx',mode:0o600});
}
policy.monitor_review_notice={prior_policy_sha256:hash(raw),hours_before:24,numerical_changes:false,dates_extended:false,
 scope:'Independent monitoring only; production worker image and policy remain unchanged.'};
for(const key of Object.keys(original).filter(k=>k!=='methods_sha256'))assert.deepEqual(policy[key],original[key]);
for(const [key,value]of Object.entries(original.methods_sha256))if(key!=='scripts/ops/run_contextual_monitor.py')assert.equal(policy.methods_sha256[key],value);
const text=JSON.stringify(policy,null,2)+'\n';
writeFileSync(resolve(out,'production-policy.json'),text,{flag:'wx',mode:0o600});
writeFileSync(resolve(out,'Dockerfile'),[
 'FROM northamerica-northeast1-docker.pkg.dev/citrus-fantasy-prod/citrus-projection-worker/contextual@sha256:901b96560c81a32429c3753d4c14f1e525f40cd5455da59e266b3498cae227c9',
 'COPY --chown=10001:10001 runtime/ /opt/citrus/scripts/ops/',
 'COPY --chown=10001:10001 production-policy.json /opt/citrus/release/production-policy.json',
 'ENTRYPOINT ["python", "scripts/ops/run_contextual_monitor.py"]',''].join('\n'),{flag:'wx',mode:0o600});
console.log(JSON.stringify({status:'PREPARED_MONITOR_ONLY',out,policySha256:hash(text),sourceRevision:policy.source_revision,
 reviewAfter:policy.review_after,workerChanged:false,numericalChanges:false}));
