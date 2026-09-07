// Independent saved-point and forward-membership reviewer; never refits.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {auditCard} from './review_method_challengers.mjs';
import {evidenceReader,inventory} from './review_forward_shooter_movement.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const SOURCE='scripts/proof/results/official-forward-shooter-movement-20260906-retry1';
const SOURCE_SHA='829119131d856969b5278d1b14d1a711c19b4a5a404b6b932ee40cf29af9fe22';
const PLAN='docs/analytics-calibration-stability-plan-20260906.json';
const PLAN_SHA='9c9d2751ae71dc94a40207260368d0228aefd616184a0f32abb4441fa8fa9b54';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
export function manifestFingerprint(value){
  const encode=v=>{if(typeof v==='string'||v===null||typeof v==='boolean')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(encode).join(',')+']';assert(v&&typeof v==='object','Manifest permits only string-keyed objects, lists and scalar strings/flags');return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+encode(v[k])).join(',')+'}';};
  // Source manifest contains only ASCII paths/digests and inventories, no floats.
  const encoded=encode(value);assert(/^[\x00-\x7f]*$/.test(encoded));return hash(encoded);
}
function key(r){assert(Number.isSafeInteger(r.game_id)&&r.game_id>0);assert(Number.isSafeInteger(r.event_id)&&r.event_id>=0);return JSON.stringify([r.game_id,r.event_id]);}
export function indexed(rows){assert(Array.isArray(rows)&&rows.length);const map=new Map(),games=new Map();for(const r of rows){const k=key(r);assert(!map.has(k),'Duplicate event');map.set(k,r);assert(typeof r.game_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(r.game_date));assert.equal(new Date(r.game_date+'T00:00:00Z').toISOString().slice(0,10),r.game_date);if(games.has(r.game_id))assert.equal(games.get(r.game_id),r.game_date);games.set(r.game_id,r.game_date);}return map;}
export function verifyEarlierOnly(fit,evaluation){
  indexed(fit);indexed(evaluation);const fitGames=new Set(fit.map(r=>r.game_id));assert(evaluation.every(r=>!fitGames.has(r.game_id)));
  assert(fit.map(r=>r.game_date).sort().at(-1)<evaluation.map(r=>r.game_date).sort()[0],'Fit must precede complete evaluation block');
}
export function guard(losses){for(const n of ['fixed','expanding'])for(const m of ['brier','log_loss_clipped'])assert(Number.isFinite(losses[n][m]));return ['brier','log_loss_clipped'].every(m=>losses.expanding[m]<=losses.fixed[m]);}
export function membership(rows){
  indexed(rows);const days=rows.map(r=>r.game_date).sort(),keys=rows.map(r=>[r.game_id,r.event_id]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  return {events:rows.length,games:new Set(rows.map(r=>r.game_id)).size,start:days[0],end:days.at(-1),keys_sha256:hash(JSON.stringify(keys))};
}
export function plannedBlocks(records,cutoff,blocks){
  indexed(records);assert(Array.isArray(blocks)&&blocks.length);const later=records.filter(r=>r.game_date>=cutoff),months=[...new Set(later.map(r=>r.game_date.slice(0,7)))].sort();
  assert.deepEqual(blocks.map(b=>b.month),months);
  return blocks.map(b=>{const test=records.filter(r=>r.game_date>=cutoff&&r.game_date.slice(0,7)===b.month);const first=test.map(r=>r.game_date).sort()[0],train=records.filter(r=>r.game_date<first);
    assert.deepEqual(membership(train),b.train);assert.deepEqual(membership(test),b.test);verifyEarlierOnly(train,test);assert(train.length>=100&&new Set(train.map(r=>r.game_id)).size>=30);assert.deepEqual([...new Set(train.map(r=>r.target))].sort(),[0,1]);return {month:b.month,train,test};});
}
export function verifyInputs(inputs,expected,training){
  const actual=indexed(inputs),old=indexed(expected);assert.deepEqual([...actual.keys()].sort(),[...old.keys()].sort());
  for(const [k,r] of actual){assert.deepEqual(Object.keys(r).sort(),['game_id','event_id','game_date','raw_probability','context',...(training?['target']:[])].sort());assert.equal(r.game_date,old.get(k).game_date);if(training)assert.equal(r.target,old.get(k).target);assert(typeof r.raw_probability==='number'&&Number.isFinite(r.raw_probability)&&r.raw_probability>0&&r.raw_probability<1);assert(r.context&&typeof r.context==='object');}
}
export function review(run,output){
  run=path.resolve(run);output=path.resolve(output);const parent=path.join(ROOT,'scripts/proof/results');assert.equal(path.dirname(run),parent);assert(path.basename(run).startsWith('official-calibration-stability-'));assert.equal(path.dirname(output),parent);assert(path.basename(output).startsWith('calibration-stability-review-'));
  const {checked,safe,bytes,read,mapping,recheck}=evidenceReader();safe(run,false);safe(parent,false);assert(!fs.existsSync(output));fs.mkdirSync(output);
  const files={},reports={};const save=(name,v)=>{const b=JSON.stringify(v)+'\n';fs.writeFileSync(path.join(output,name),b,{flag:'wx'});files[name]=hash(b);};
  function bind(dir,h){assert.equal(h.publishable,false);assert.deepEqual(inventory(dir).map(p=>path.relative(dir,p)).sort(),[...Object.keys(h.files),'health.json'].sort());for(const [p,sha] of Object.entries(h.files)){assert(!path.isAbsolute(p)&&!p.split('/').includes('..'));bytes(path.join(dir,p),sha);}}
  const losses=card=>Object.fromEntries(['fixed','expanding'].map(n=>[n,Object.fromEntries(['brier','log_loss_clipped'].map(m=>[m,card.overall.models[n].metrics[m].value]))]));
  try{
    for(const n of ['review_calibration_stability.mjs','test_review_calibration_stability.mjs','review_forward_shooter_movement.mjs','review_method_challengers.mjs'])bytes(path.join(ROOT,'scripts/proof',n));
    const h=read(path.join(run,'health.json'));assert.equal(h.status,'complete-calibration-stability-development-not-accepted');bind(run,h);
    const d=read(path.join(run,'declaration.json')),plan=read(path.join(ROOT,PLAN),PLAN_SHA);assert.equal(d.plan_sha256,PLAN_SHA);assert.deepEqual(d.plan,plan);assert.equal(d.publishable,false);assert.equal(plan.publishable,false);assert.equal(plan.automatic_acceptance,false);assert.equal(plan.untouched_test_claim,false);assert.deepEqual(plan.outputs,['fixed','expanding']);assert.equal(plan.primary,'expanding');assert.equal(plan.source.directory,SOURCE);assert.equal(plan.source.health_sha256,SOURCE_SHA);
    mapping(d.code_and_reference_sha256);mapping(read(path.join(run,'consumed-file-sha256.json')));const source=read(path.join(run,'source-reuse.json'));assert.equal(manifestFingerprint(source),d.source_manifest_sha256);mapping(source.checked);
    for(const [dir,names] of Object.entries(source.inventories)){const folder=safe(dir,false);assert.deepEqual(inventory(folder).map(p=>path.relative(folder,p)).sort(),[...names].sort());}
    const sourceDir=path.join(ROOT,SOURCE),sh=read(path.join(sourceDir,'health.json'),SOURCE_SHA);bind(sourceDir,sh);
    const groupPath='scripts/proof/results/official-development-features-20260906/groups.jsonl';assert(source.checked[groupPath]);const groups=new Map();for(const line of bytes(groupPath,source.checked[groupPath]).toString().trim().split('\n')){const r=JSON.parse(line),k=key(r);assert(!groups.has(k));groups.set(k,r.groups);}
    const result=read(path.join(run,'result.json'));
    for(const fold of ['fold1','fold2']){
      const p=n=>path.join(run,fold,n),prior=n=>read(path.join(sourceDir,fold,n),sh.files[fold+'/'+n]);
      const records=prior('calibration-identity-inputs.json'),old=indexed(records),blocks=plannedBlocks(records,plan.cutoffs[fold],plan.blocks[fold]),initial=read(p('initial-map.json'));
      assert.deepEqual(initial,prior('calibrators.json').conditional_shape);assert.deepEqual(initial.settings,plan.conditional_settings);assert.deepEqual(read(p('model.json')),prior('model.json'));assert.deepEqual(read(p('model.json')).design.schema,plan.schema);
      const monthly=read(p('monthly.json'));assert.deepEqual(Object.keys(monthly).sort(),blocks.map(b=>b.month));let merged=[],comparisons=0,maxError=0;const featureSeen=new Map();
      for(let i=0;i<blocks.length;i++){
        const block=blocks[i],bp=n=>p(block.month+'/'+n),fit=read(bp('fit-receipt.json')),train=read(bp('train-inputs.json')),test=read(bp('test-inputs.json'));
        assert.deepEqual(fit.block,plan.blocks[fold][i]);assert.equal(fit.refitted,i!==0);assert.equal(fit.publishable,false);bytes(bp('train-inputs.json'),fit.train_inputs_sha256);bytes(bp('test-inputs.json'),fit.test_inputs_sha256);verifyInputs(train,block.train,true);verifyInputs(test,block.test,false);
        for(const r of [...train,...test]){const k=key(r),v={raw_probability:r.raw_probability,context:r.context};if(featureSeen.has(k))assert.deepEqual(v,featureSeen.get(k));featureSeen.set(k,v);}
        const map=read(bp('map.json'));assert.equal(map.publishable,false);assert.deepEqual(map.settings,plan.conditional_settings);if(i===0)assert.deepEqual(map,initial);
        const rows=read(bp('predictions.json'));assert.deepEqual(rows.map(key).sort(),block.test.map(key).sort());
        for(const r of rows){assert.equal(r.target,old.get(key(r)).target);assert.deepEqual(r.groups,groups.get(key(r)));assert.deepEqual(Object.keys(r.predictions).sort(),['expanding','fixed']);assert.equal(r.predictions.fixed,old.get(key(r)).probability);for(const v of Object.values(r.predictions))assert(Number.isFinite(v)&&v>0&&v<1);if(i===0)assert.equal(r.predictions.fixed,r.predictions.expanding);}
        const card=read(bp('scorecard.json'));assert.deepEqual(card.config,plan.scorecard);const audit=auditCard(rows,card);save(fold+'-'+block.month+'-points.json',audit);comparisons+=audit.point_comparisons;maxError=Math.max(maxError,audit.maximum_absolute_error);
        assert.deepEqual(monthly[block.month],{events:rows.length,games:block.test.length?new Set(block.test.map(r=>r.game_id)).size:0,support:rows.length<100||new Set(block.test.map(r=>r.game_id)).size<30?'sparse':'supported_exploratory',refitted:i!==0,losses:losses(card)});merged.push(...rows);
      }
      merged.sort((a,b)=>a.game_id-b.game_id||a.event_id-b.event_id);assert.deepEqual(read(p('predictions.json')),merged);
      const card=read(p('scorecard.json'));assert.deepEqual(card.config,plan.scorecard);const audit=auditCard(merged,card);save(fold+'-aggregate-points.json',audit);comparisons+=audit.point_comparisons;maxError=Math.max(maxError,audit.maximum_absolute_error);
      const pass=guard(audit.overall),summary=read(p('summary.json'));assert.deepEqual(summary,{events:merged.length,losses:losses(card),primary_guard_passed:pass});assert.deepEqual(result.folds[fold],summary);reports[fold]={events:merged.length,blocks:blocks.length,point_comparisons:comparisons,maximum_absolute_error:maxError,primary_guard_passed:pass,losses:losses(card)};
    }
    assert.equal(result.primary_guard_passed,Object.values(reports).every(r=>r.primary_guard_passed));for(const n of ['publishable','model_accepted','production_changed','outer_validation_used_for_fit_score_selection'])assert.equal(result[n],false);
    recheck();save('checked-file-sha256.json',checked);save('review.json',{publishable:false,reports,checked_files:Object.keys(checked).length,limitations:['Saved point metrics, source membership and metadata only; no refitting, bootstrap or AUC/AP recomputation.','Raw prediction and context reconstruction belongs to separate source replay, not independently reproduced here.','Adaptive development; not an untouched result or automatic acceptance.']});for(const [n,sha] of Object.entries(files))assert.equal(hash(fs.readFileSync(path.join(output,n))),sha);save('health.json',{status:'complete-independent-calibration-stability-point-review',publishable:false,files:{...files}});return reports;
  }catch(error){save('failure.json',{error:String(error),publishable:false});throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(review(process.argv[2],process.argv[3])));
