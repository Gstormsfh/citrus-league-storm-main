// Additive review; imports frozen independent arithmetic, never model binaries.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {auditCard} from './review_method_challengers.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const run='scripts/proof/results/official-event-memory-20260906-1803';
const output=path.resolve(process.argv[2]??'');
assert.equal(path.dirname(output),path.join(root,'scripts/proof/results'));
assert(path.basename(output).startsWith('event-memory-review-'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const checked={};
function safe(p){
  p=path.resolve(root,p);assert(p.startsWith(root+path.sep));
  for(let q=p;q!==path.dirname(root);q=path.dirname(q))assert(!fs.lstatSync(q).isSymbolicLink());
  assert(fs.statSync(p).isFile());return p;
}
function read(p,expected){
  p=safe(p);const bytes=fs.readFileSync(p),sha=hash(bytes);
  if(expected!==undefined)assert.equal(sha,expected);
  if(checked[p])assert.equal(sha,checked[p]);checked[p]=sha;
  return JSON.parse(bytes);
}
function verifyMap(map){for(const [p,sha] of Object.entries(map)){
  const bytes=fs.readFileSync(safe(p));assert.equal(hash(bytes),sha);checked[path.resolve(root,p)]=sha;
}}
function save(n,v){fs.writeFileSync(path.join(output,n),JSON.stringify(v)+'\n',{flag:'wx'});}
fs.mkdirSync(output);
try{
  const health=read(run+'/health.json');assert.equal(health.status,'complete-event-memory-development-not-accepted');
  assert.equal(health.publishable,false);assert(!fs.existsSync(path.join(root,run,'failure.json')));
  verifyMap(Object.fromEntries(Object.entries(health.files).map(([p,h])=>[run+'/'+p,h])));
  verifyMap(read(run+'/declaration.json').code_and_reference_sha256);
  verifyMap(read(run+'/source-replay.json').checked);verifyMap(read(run+'/consumed-file-sha256.json'));
  const reports={};
  for(const fold of ['fold1','fold2']){
    const rows=read(run+'/'+fold+'/predictions.json'),card=read(run+'/'+fold+'/scorecard.json');
    const prior=read('scripts/proof/results/official-calibration-shape-experiment-20260906/'+fold+'/predictions.json');
    const key=r=>JSON.stringify([r.game_id,r.event_id]),old=new Map(prior.map(r=>[key(r),r]));
    assert.equal(old.size,prior.length);assert.deepEqual(rows.map(key).sort(),[...old.keys()].sort());
    for(const r of rows){const b=old.get(key(r));assert.equal(r.target,b.target);assert.deepEqual(r.groups,b.groups);
      assert.equal(r.predictions.frozen_monotone_group,b.predictions.monotone_logit_group);}
    const report=auditCard(rows,card);save(fold+'.json',report);
    reports[fold]={events:report.events,point_comparisons:report.point_comparisons,maximum_error:report.maximum_absolute_error,
      overall:report.overall,primary_guard_passed:['brier','log_loss_clipped'].every(m=>
        report.overall.memory_monotone_group[m]<=report.overall.frozen_monotone_group[m])};
  }
  for(const [p,h] of Object.entries(checked))assert.equal(hash(fs.readFileSync(safe(p))),h);
  save('checked-file-sha256.json',checked);
  save('review.json',{status:'independent-point-review-complete',reports,checked_files:Object.keys(checked).length,
    publishable:false,limitations:['Fixed-fit point arithmetic and local bytes only; no bootstrap, refit, prospective or peer-superiority proof.']});
  console.log(JSON.stringify({checked_files:Object.keys(checked).length,folds:Object.fromEntries(Object.entries(reports).map(([f,r])=>[f,{events:r.events,maximum_error:r.maximum_error,primary_guard_passed:r.primary_guard_passed}]))}));
}catch(error){save('failure.json',{error:String(error),publishable:false});throw error;}
