// Independent no-fit transfer audit. Scalar JSON calibration only, not raw-model replay.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {auditCard} from './review_method_challengers.mjs';
import {evidenceReader,inventory} from './review_forward_shooter_movement.mjs';
import {indexed,membership,verifyEarlierOnly,verifyInputs,manifestFingerprint,guard} from './review_calibration_stability.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const PLAN='docs/analytics-calibration-transfer-plan-20260906.json';
const PLAN_SHA='f60544d9eb9ce69fb0c6041947d9c7bde401864cc69371e35f88f7622f909f6e';
const FIELDS=['shot_type','prior_sog_same_team','strength'];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const key=r=>JSON.stringify([r.game_id,r.event_id]);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const probability=p=>assert(finite(p)&&p>0&&p<1,'Finite interior probability required');
export function scalarPrediction(model,p,context){
  probability(p);assert.equal(model.contract,'citrus-conditional-calibration-shape-v1');assert.equal(model.publishable,false);
  assert.deepEqual(Object.keys(context).sort(),[...FIELDS].sort());for(const v of Object.values(context))assert(v===null||typeof v==='string');
  const s=model.settings;assert(finite(s.epsilon)&&s.epsilon>0&&s.epsilon<.5);probability(s.reference_probability);
  assert(Array.isArray(s.knots)&&s.knots.length>=2);s.knots.forEach(probability);assert(s.knots.every((v,i)=>i===0||v>s.knots[i-1]));
  const width=s.knots.length-1,checkSlopes=a=>{assert(Array.isArray(a)&&a.length===width);assert(a.every(v=>finite(v)&&v>=0));};
  checkSlopes(model.shared_slopes);assert(Array.isArray(model.states)&&new Set(model.states).size===model.states.length);assert(model.states.every(v=>[null,'0','1'].includes(v)));
  assert.equal(model.context_slopes.length,model.states.length);model.context_slopes.forEach(checkSlopes);assert(finite(model.intercept));
  assert.deepEqual(Object.keys(model.vocabulary).sort(),[...FIELDS].sort());let size=0;for(const f of FIELDS){const v=model.vocabulary[f];assert(Array.isArray(v)&&v.length&&new Set(v).size===v.length);assert(v.every(x=>x===null||typeof x==='string'));size+=v.length;}
  assert(Array.isArray(model.offsets)&&model.offsets.length===size&&model.offsets.every(finite));
  const logit=x=>Math.log(x)-Math.log1p(-x),knots=s.knots.map(logit),reference=logit(s.reference_probability),x=logit(Math.min(1-s.epsilon,Math.max(s.epsilon,p)));
  const index=model.states.indexOf(context.prior_sog_same_team),slopes=index<0?model.shared_slopes:model.context_slopes[index];let z=model.intercept;
  for(let i=0;i<width;i++){const d=knots[i+1]-knots[i],basis=Math.min(d,Math.max(0,x-knots[i]))-Math.min(d,Math.max(0,reference-knots[i]));z+=slopes[i]*basis;}
  let offset=0;for(const f of FIELDS){const v=model.vocabulary[f],j=v.indexOf(context[f]);if(j>=0)z+=model.offsets[offset+j];offset+=v.length;}
  assert(Number.isFinite(z));const result=z>=0?1/(1+Math.exp(-z)):Math.exp(z)/(1+Math.exp(z));return Math.min(1-s.epsilon,Math.max(s.epsilon,result));
}
export function transferBlocks(calibration,validation,declared){
  indexed([...calibration,...validation]);verifyEarlierOnly(calibration,validation);for(const r of [...calibration,...validation])assert(r.target===0||r.target===1);
  const months=[...new Set(validation.map(r=>r.game_date.slice(0,7)))].sort();assert.deepEqual(declared.map(b=>b.month),months);
  return declared.map(b=>{const test=validation.filter(r=>r.game_date.slice(0,7)===b.month),first=test.map(r=>r.game_date).sort()[0],train=[...calibration,...validation.filter(r=>r.game_date<first)];verifyEarlierOnly(train,test);assert.deepEqual(membership(train),b.train);assert.deepEqual(membership(test),b.test);assert.deepEqual([...new Set(train.map(r=>r.target))].sort(),[0,1]);return {month:b.month,train,test};});
}
export function preservedInputs(inputs,expected,training){
  verifyInputs(inputs,expected,training);const old=indexed(expected);for(const r of inputs){const prior=old.get(key(r));assert.equal(r.raw_probability,prior.raw_probability);assert.deepEqual(r.context,prior.context);}
}
export function verifyPredictions(rows,test,initial,map,first,frozen){
  const inputs=indexed(test);assert.equal(rows.length,inputs.size);const seen=new Set();let error=0;
  for(const r of rows){const k=key(r);assert(!seen.has(k));seen.add(k);assert(inputs.has(k));const source=inputs.get(k);assert.equal(r.target,source.target);assert.deepEqual(r.groups,source.groups);assert.deepEqual(Object.keys(r.predictions).sort(),['expanding','fixed']);
    assert.equal(r.predictions.fixed,frozen.get(k));for(const [name,m] of [['fixed',initial],['expanding',map]]){probability(r.predictions[name]);const e=Math.abs(r.predictions[name]-scalarPrediction(m,source.raw_probability,source.context));assert(e<=1e-12,'Scalar map replay exceeds declared tolerance');error=Math.max(error,e);}if(first)assert.equal(r.predictions.fixed,r.predictions.expanding);
  }return error;
}
export function bindInventory(reader,dir,health){
  assert.equal(health.publishable,false);assert(health.files&&typeof health.files==='object');assert.deepEqual(inventory(dir).map(p=>path.relative(dir,p)).sort(),[...Object.keys(health.files),'health.json'].sort());
  for(const [p,sha] of Object.entries(health.files)){assert(p&&!path.isAbsolute(p)&&!p.split('/').some(x=>['..','.',''].includes(x)));reader.bytes(path.join(dir,p),sha);}
}
export function review(run,output){
  run=path.resolve(run);output=path.resolve(output);const parent=path.join(ROOT,'scripts/proof/results');assert.equal(path.dirname(run),parent);assert(path.basename(run).startsWith('official-calibration-transfer-'));assert.equal(path.dirname(output),parent);assert(path.basename(output).startsWith('calibration-transfer-review-'));
  const reader=evidenceReader(),{checked,safe,bytes,read,mapping,recheck}=reader;safe(run,false);safe(parent,false);assert(!fs.existsSync(output));fs.mkdirSync(output);
  const files={},reports={},save=(name,value)=>{const b=JSON.stringify(value)+'\n';fs.writeFileSync(path.join(output,name),b,{flag:'wx'});files[name]=hash(b);};
  const losses=card=>Object.fromEntries(['fixed','expanding'].map(n=>[n,Object.fromEntries(['brier','log_loss_clipped'].map(m=>[m,card.overall.models[n].metrics[m].value]))]));
  try{
    for(const n of ['review_calibration_transfer.mjs','test_review_calibration_transfer.mjs','review_calibration_stability.mjs','review_forward_shooter_movement.mjs','review_method_challengers.mjs'])bytes(path.join(ROOT,'scripts/proof',n));
    const health=read(path.join(run,'health.json'));assert.equal(health.status,'complete-calibration-transfer-development-not-accepted');bindInventory(reader,run,health);
    const plan=read(PLAN,PLAN_SHA),d=read(path.join(run,'declaration.json'));assert.equal(d.plan_sha256,PLAN_SHA);assert.deepEqual(d.plan,plan);assert.equal(d.publishable,false);assert.equal(plan.publishable,false);assert.equal(plan.automatic_acceptance,false);assert.equal(plan.untouched_test_claim,false);assert.deepEqual(plan.outputs,['fixed','expanding']);assert.equal(plan.primary,'expanding');
    mapping(d.code_and_reference_sha256);mapping(plan.membership_source_sha256);mapping(read(path.join(run,'consumed-file-sha256.json')));const source=read(path.join(run,'source-reuse.json'));assert.equal(manifestFingerprint(source),d.source_manifest_sha256);mapping(source.checked);
    for(const [dir,names] of Object.entries(source.inventories)){const folder=safe(dir,false);assert.deepEqual(inventory(folder).map(p=>path.relative(folder,p)).sort(),[...names].sort());}
    const sourceDir=path.join(ROOT,plan.source.directory),sourceHealth=read(path.join(sourceDir,'health.json'),plan.source.health_sha256);bindInventory(reader,sourceDir,sourceHealth);
    const proofDir=path.join(ROOT,plan.bounded_proof.directory),proofHealth=read(path.join(proofDir,'health.json'),plan.bounded_proof.health_sha256);bindInventory(reader,proofDir,proofHealth);
    const result=read(path.join(run,'result.json'));
    for(const fold of ['fold1','fold2']){
      const p=n=>path.join(run,fold,n),prior=n=>read(path.join(sourceDir,fold,n),sourceHealth.files[fold+'/'+n]);
      const calibration=read(p('source-calibration.json')),validation=read(p('source-validation.json'));assert.deepEqual(membership(calibration),plan.cohorts[fold].calibration);assert.deepEqual(membership(validation),plan.cohorts[fold].validation);
      // Independently bind labels and dates to the predeclared, earlier certified identity export.
      for(const [name,records] of [['calibration',calibration],['validation',validation]]){const candidates=Object.keys(plan.membership_source_sha256).filter(n=>n.endsWith('/'+fold+'/'+name+'-identity-inputs.json'));assert.equal(candidates.length,1);const old=indexed(read(candidates[0],plan.membership_source_sha256[candidates[0]])),actual=indexed(records);assert.deepEqual([...actual.keys()].sort(),[...old.keys()].sort());for(const [k,r] of actual){assert.equal(r.target,old.get(k).target);assert.equal(r.game_date,old.get(k).game_date);probability(r.raw_probability);}}
      const blocks=transferBlocks(calibration,validation,plan.blocks[fold]),initial=read(p('initial-map.json'));assert.deepEqual(initial,prior('calibrators.json').conditional_shape);assert.deepEqual(initial.settings,plan.conditional_settings);assert.deepEqual(read(p('model.json')),prior('model.json'));assert.deepEqual(read(p('model.json')).design.schema,plan.schema);
      const oldPredictions=prior('predictions.json'),frozen=new Map(),oldGroups=new Map(),oldRaw=new Map();for(const r of oldPredictions){const k=key(r);assert(!frozen.has(k));frozen.set(k,r.predictions.conditional_shape);oldGroups.set(k,r.groups);oldRaw.set(k,r.predictions.movement_raw);}assert.equal(frozen.size,validation.length);for(const r of validation){assert(frozen.has(key(r)));assert.deepEqual(r.groups,oldGroups.get(key(r)));assert.equal(r.raw_probability,oldRaw.get(key(r)),'Frozen validation raw probability must remain exact');}
      const monthly=read(p('monthly.json'));assert.deepEqual(Object.keys(monthly).sort(),blocks.map(b=>b.month));let merged=[],comparisons=0,maxError=0,maxScalarError=0;
      for(let i=0;i<blocks.length;i++){
        const block=blocks[i],bp=n=>p(block.month+'/'+n),fit=read(bp('fit-receipt.json')),train=read(bp('train-inputs.json')),test=read(bp('test-inputs.json'));assert.deepEqual(fit.block,plan.blocks[fold][i]);assert.equal(fit.refitted,i!==0);assert.equal(fit.publishable,false);bytes(bp('train-inputs.json'),fit.train_inputs_sha256);bytes(bp('test-inputs.json'),fit.test_inputs_sha256);preservedInputs(train,block.train,true);preservedInputs(test,block.test,false);
        const map=read(bp('map.json'));assert.deepEqual(map.settings,plan.conditional_settings);assert.equal(map.publishable,false);if(i===0)assert.deepEqual(map,initial);
        const rows=read(bp('predictions.json'));maxScalarError=Math.max(maxScalarError,verifyPredictions(rows,block.test,initial,map,i===0,frozen));const card=read(bp('scorecard.json'));assert.deepEqual(card.config,plan.scorecard);const audit=auditCard(rows,card);save(fold+'-'+block.month+'-points.json',audit);comparisons+=audit.point_comparisons;maxError=Math.max(maxError,audit.maximum_absolute_error);
        assert(finite(fit.fit_wall_seconds)&&fit.fit_wall_seconds>=0);if(i===0)assert.equal(fit.fit_wall_seconds,0);
        const games=new Set(block.test.map(r=>r.game_id)).size;assert.deepEqual(monthly[block.month],{events:rows.length,games,support:rows.length<100||games<30?'sparse':'supported_exploratory',refitted:i!==0,fit_wall_seconds:fit.fit_wall_seconds,losses:losses(card)});merged.push(...rows);
      }
      merged.sort((a,b)=>a.game_id-b.game_id||a.event_id-b.event_id);assert.deepEqual(read(p('predictions.json')),merged);const card=read(p('scorecard.json'));assert.deepEqual(card.config,plan.scorecard);const audit=auditCard(merged,card);save(fold+'-aggregate-points.json',audit);comparisons+=audit.point_comparisons;maxError=Math.max(maxError,audit.maximum_absolute_error);
      const passed=guard(audit.overall),summary=read(p('summary.json'));assert.deepEqual(summary,{events:merged.length,losses:losses(card),primary_guard_passed:passed});assert.deepEqual(result.folds[fold],summary);reports[fold]={events:merged.length,blocks:blocks.length,point_comparisons:comparisons,maximum_absolute_error:maxError,maximum_scalar_prediction_error:maxScalarError,scalar_tolerance:1e-12,primary_guard_passed:passed,losses:losses(card)};
    }
    assert.equal(result.primary_guard_passed,Object.values(reports).every(r=>r.primary_guard_passed));for(const n of ['publishable','model_accepted','production_changed','historical_as_of_verified'])assert.equal(result[n],false);assert.equal(result.earlier_outer_labels_used_for_later_maps,true);assert.deepEqual(result.limitations,plan.limitations);
    recheck();save('checked-file-sha256.json',checked);save('review.json',{publishable:false,reports,checked_files:Object.keys(checked).length,limitations:['No refitting, optimization certification, bootstrap or AUC/AP recomputation.','Raw probabilities and contexts preserved against consumed source snapshots; no independent raw tree or event-body feature reconstruction.','Monthly fit membership excludes current/future labels; historical availability and fitting code behavior are not established by saved membership alone.','Adaptive retrospective transfer; no untouched test or automatic acceptance.']});for(const [n,sha] of Object.entries(files))assert.equal(hash(fs.readFileSync(path.join(output,n))),sha);save('health.json',{status:'complete-independent-calibration-transfer-point-review',publishable:false,files:{...files}});return reports;
  }catch(error){save('failure.json',{error:String(error),publishable:false});throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(review(process.argv[2],process.argv[3])));
