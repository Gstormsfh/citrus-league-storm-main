// Independent saved-artifact scalar and point review; no fitting or bootstrap.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {auditCard} from './review_method_challengers.mjs';
import {evidenceReader,inventory} from './review_forward_shooter_movement.mjs';
import {indexed,membership} from './review_calibration_stability.mjs';
import {scalarPrediction as originalScalar,transferBlocks,bindInventory} from './review_calibration_transfer.mjs';
import {lines} from './review_timing_eras.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const PLAN='docs/analytics-timing-ridge10-plan-20260906.md',PLAN_SHA='9153733a6251fb85726ae577d5a150f7e7bc713a000d82df5a89edff29c8a635';
const OLD_PLAN='docs/analytics-calibration-transfer-plan-20260906.json',OLD_SHA='f60544d9eb9ce69fb0c6041947d9c7bde401864cc69371e35f88f7622f909f6e';
const SOURCE='scripts/proof/results/official-calibration-transfer-20260906-full',SOURCE_SHA='6cf9060710823e8a251518a6c5383cf56fc6b53ecaca89b6d6e45db536e4e44b';
const TIMING='scripts/proof/results/timing-era-audit-20260906-full',TIMING_SHA='a34674802dcdbc52d875c738d2a5278a40535dcd6484e2495a998d8b642bd499';
const TIMING_REVIEW='scripts/proof/results/timing-era-review-20260906-full',TIMING_REVIEW_SHA='8c07fe4a099ceaf0e265116141c5d473dd6c6d3f09f2d5749cdde8a79394e077';
const CONTROL='scripts/proof/results/official-timing-candidate-20260906-full',CONTROL_SHA='f035ec542fc02d7b91f9ec3f66cd8218c3746bb095f47dc31ace7ebc89e49ed9';
const FIELDS=['shot_type','prior_sog_same_team','strength'];
export const BANDS=['same_clock','up_to_1s','over_1_under_3s','from_3_to_10s'];
const NAMES=['fixed','expanding','timing100','timing'],METRICS=['brier','log_loss_clipped'];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const probability=p=>assert(finite(p)&&p>0&&p<1,'Finite interior probability');
export function key(r){assert(Number.isSafeInteger(r.game_id)&&r.game_id>0&&r.game_id<1e10);assert(Number.isSafeInteger(r.event_id)&&r.event_id>=0&&r.event_id<1e9);return JSON.stringify([r.game_id,r.event_id]);}
export function band(state,gap){assert([null,'0','1'].includes(state));assert(gap===null||finite(gap)&&gap>=0,'Explicit finite gap');if(state!=='1')return null;assert(gap!==null,'State-one gap required');return gap===0?BANDS[0]:gap<=1?BANDS[1]:gap<3?BANDS[2]:gap<=10?BANDS[3]:null;}
function recordedBand(gap){return gap===null?'no_same_period_predecessor':gap===0?'same_clock':gap<=1?'up_to_1s':gap<3?'over_1_under_3s':gap<=10?'from_3_to_10s':'over_10s';}
export function scalarPrediction(model,p,c,gap){
 assert.equal(model.contract,'citrus-timing-conditional-calibration-ridge10-v1');assert.equal(model.timing_ridge,10);assert.equal(model.publishable,false);
 const categories=model.timing_categories;assert(Array.isArray(categories)&&new Set(categories).size===categories.length);assert.deepEqual(categories,BANDS.filter(b=>categories.includes(b)));assert(Array.isArray(model.timing_offsets)&&model.timing_offsets.length===categories.length&&model.timing_offsets.every(finite));
 // Validate the original parameter schema, but never apply timing to its clipped output.
 originalScalar({...model,contract:'citrus-conditional-calibration-shape-v1'},p,c);
 const s=model.settings,logit=x=>Math.log(x)-Math.log1p(-x),knots=s.knots.map(logit),reference=logit(s.reference_probability),x=logit(Math.max(s.epsilon,Math.min(1-s.epsilon,p)));
 const at=model.states.indexOf(c.prior_sog_same_team),slopes=at<0?model.shared_slopes:model.context_slopes[at];let z=model.intercept;
 for(let i=0;i<slopes.length;i++){const width=knots[i+1]-knots[i];z+=slopes[i]*(Math.min(width,Math.max(0,x-knots[i]))-Math.min(width,Math.max(0,reference-knots[i])));}
 let offset=0;for(const f of FIELDS){const v=model.vocabulary[f],j=v.indexOf(c[f]);if(j>=0)z+=model.offsets[offset+j];offset+=v.length;}
 const j=categories.indexOf(band(c.prior_sog_same_team,gap));if(j>=0)z+=model.timing_offsets[j];assert(Number.isFinite(z));const result=z>=0?1/(1+Math.exp(-z)):Math.exp(z)/(1+Math.exp(z));return Math.max(s.epsilon,Math.min(1-s.epsilon,result));
}
export function preserveInputs(inputs,expected,training,timing){
 const actual=indexed(inputs),old=indexed(expected);assert.deepEqual([...actual.keys()].sort(),[...old.keys()].sort());
 for(const [k,r]of actual){const source=old.get(k),t=timing.get(k);assert(t,'Timing source required');assert.deepEqual(Object.keys(r).sort(),['game_id','event_id','game_date','raw_probability','context','gap_seconds','gap_band',...(training?['target']:[])].sort());assert.equal(r.game_date,source.game_date);assert.equal(r.raw_probability,source.raw_probability);probability(r.raw_probability);assert.deepEqual(r.context,source.context);if(training)assert.equal(r.target,source.target);assert.equal(t.target,source.target);assert.equal(t.month,r.game_date.slice(0,7));assert.equal(t.state,r.context.prior_sog_same_team);assert.equal(r.gap_seconds,t.gap_seconds);assert.equal(r.gap_band,t.gap_band);band(t.state,t.gap_seconds);assert.equal(r.gap_band,recordedBand(r.gap_seconds));}
}
export function verifyPredictions(rows,test,model,frozen){
 const inputs=indexed(test);assert.equal(rows.length,inputs.size);const seen=new Set();let maxError=0;
 for(const r of rows){const k=key(r);assert(!seen.has(k)&&inputs.has(k),'Exact unique predictions');seen.add(k);const x=inputs.get(k),prior=frozen.get(k);assert(prior);assert.equal(r.target,x.target);assert.equal(r.target,prior.target);assert.deepEqual(r.groups,prior.groups);assert.equal(Object.keys(r.groups).length,8,'Preserve original eight groups');assert.deepEqual(Object.keys(r.predictions).sort(),[...NAMES].sort());for(const n of NAMES)probability(r.predictions[n]);for(const n of ['fixed','expanding','timing100'])assert.equal(r.predictions[n],prior.predictions[n],'Frozen control drift');const error=Math.abs(r.predictions.timing-scalarPrediction(model,x.raw_probability,x.context,x.gap_seconds));assert(error<=1e-12,'Scalar prediction drift');maxError=Math.max(maxError,error);}
 return maxError;
}
export function guard(losses){for(const n of ['timing','timing100'])for(const m of METRICS)assert(finite(losses[n][m])&&losses[n][m]>=0);return METRICS.every(m=>losses.timing[m]<=losses.timing100[m]);}
export function trainVocabulary(model,train){
 const sort=a=>[...new Set(a)].sort((a,b)=>a===null?-1:b===null?1:a<b?-1:a>b?1:0);
 for(const f of FIELDS)assert.deepEqual(model.vocabulary[f],sort(train.map(r=>r.context[f])));
 assert.deepEqual(model.states,[null,'0','1'].filter(s=>train.some(r=>r.context.prior_sog_same_team===s)));
 const seen=new Set(train.map(r=>band(r.context.prior_sog_same_team,r.gap_seconds)));assert.deepEqual(model.timing_categories,BANDS.filter(b=>seen.has(b)));
}
export async function review(run,output){
 run=path.resolve(run);output=path.resolve(output);const parent=path.join(ROOT,'scripts/proof/results');assert.equal(path.dirname(run),parent);assert(path.basename(run).startsWith('official-timing-ridge10-'));assert.equal(path.dirname(output),parent);assert(path.basename(output).startsWith('timing-ridge10-review-'));
 const reader=evidenceReader(),{checked,safe,bytes,read,mapping,recheck}=reader;safe(run,false);safe(parent,false);assert(!fs.existsSync(output));fs.mkdirSync(output);const files={},reports={};
 const save=(n,v)=>{const b=JSON.stringify(v)+'\n';fs.writeFileSync(path.join(output,n),b,{flag:'wx'});files[n]=hash(b);};
 const losses=card=>Object.fromEntries(NAMES.map(n=>[n,Object.fromEntries(METRICS.map(m=>[m,card.overall.models[n].metrics[m].value]))]));
 try{
 const checker={};for(const n of ['review_timing_ridge10.mjs','test_review_timing_ridge10.mjs','review_calibration_transfer.mjs','review_calibration_stability.mjs','review_forward_shooter_movement.mjs','review_method_challengers.mjs','review_timing_eras.mjs']){const p=path.join(ROOT,'scripts/proof',n);checker[n]=hash(bytes(p));}
 const health=read(path.join(run,'health.json'));assert.equal(health.status,'complete-timing-ridge10-development-not-accepted');bindInventory(reader,run,health);const sourceHealthSHA=hash(bytes(path.join(run,'health.json')));
 bytes(PLAN,PLAN_SHA);const plan=read(OLD_PLAN,OLD_SHA),d=read(path.join(run,'declaration.json'));assert.equal(d.plan_sha256,PLAN_SHA);assert.equal(d.source_health_sha256,SOURCE_SHA);assert.equal(d.timing_health_sha256,TIMING_SHA);for(const n of ['publishable','historical_as_of_verified','untouched_test'])assert.equal(d[n],false);mapping(d.checked_sha256);mapping(read(path.join(run,'consumed-file-sha256.json')));
 assert.equal(d.control_health_sha256,CONTROL_SHA);const ch=read(path.join(ROOT,CONTROL,'health.json'),CONTROL_SHA);assert.equal(ch.status,'complete-timing-candidate-development-not-accepted');bindInventory(reader,path.join(ROOT,CONTROL),ch);
 const bound=[[path.join(ROOT,CONTROL),ch]];for(const [name,pin,status]of [[SOURCE,SOURCE_SHA,'complete-calibration-transfer-development-not-accepted'],[TIMING,TIMING_SHA,'complete-timing-era-no-fit-audit'],[TIMING_REVIEW,TIMING_REVIEW_SHA,'complete-independent-timing-era-review']]){const folder=path.join(ROOT,name),h=read(path.join(folder,'health.json'),pin);assert.equal(h.status,status);bindInventory(reader,folder,h);bound.push([folder,h]);}
 mapping(read(path.join(ROOT,SOURCE,'consumed-file-sha256.json')));mapping(read(path.join(ROOT,TIMING,'checked-file-sha256.json')));
 const timing=new Map();for await(const r of lines(path.join(ROOT,TIMING,'rows.jsonl'))){const k=key(r);assert(!timing.has(k)&&r.season>=2019&&r.season<=2023);timing.set(k,{target:r.target,month:r.month,state:r.state,gap_seconds:r.gap_seconds,gap_band:r.gap_band});}
 const result=read(path.join(run,'result.json'));
 for(const fold of ['fold1','fold2']){
  const src=n=>read(path.join(ROOT,SOURCE,fold,n)),p=n=>path.join(run,fold,n);const calibration=src('source-calibration.json'),validation=src('source-validation.json');for(const [s,r]of [['calibration',calibration],['validation',validation]])assert.deepEqual(membership(r),plan.cohorts[fold][s]);
  const baseline=src('predictions.json'),frozen=new Map();for(const r of baseline){const k=key(r);assert(!frozen.has(k));frozen.set(k,r);}assert.equal(frozen.size,validation.length);
  const controls=read(path.join(ROOT,CONTROL,fold,'predictions.json'));assert.equal(controls.length,frozen.size);const seenControls=new Set();for(const c of controls){const k=key(c);assert(!seenControls.has(k)&&frozen.has(k));seenControls.add(k);const old=frozen.get(k);assert.equal(c.target,old.target);assert.deepEqual(c.groups,old.groups);for(const n of ['fixed','expanding'])assert.equal(c.predictions[n],old.predictions[n]);old.predictions.timing100=c.predictions.timing;}
  const blocks=transferBlocks(calibration,validation,plan.blocks[fold]),monthly=read(p('monthly.json'));assert.deepEqual(Object.keys(monthly).sort(),blocks.map(b=>b.month));let merged=[],comparisons=0,maxError=0,maxScalarError=0;
  const audit=(rows,card)=>{assert.deepEqual(card.config,plan.scorecard);const a=auditCard(rows,card);comparisons+=a.point_comparisons;maxError=Math.max(maxError,a.maximum_absolute_error);return a;};
  const diagnostic=rows=>rows.map(r=>{const t=timing.get(key(r));return {...r,groups:{state_and_recorded_gap:(t.state===null?'None':t.state)+'|'+t.gap_band}};});
  for(let i=0;i<blocks.length;i++){
   const b=blocks[i],bp=n=>p(b.month+'/'+n),fit=read(bp('fit-receipt.json')),train=read(bp('train-inputs.json')),test=read(bp('test-inputs.json'));assert.deepEqual(fit.block,plan.blocks[fold][i]);assert.equal(fit.publishable,false);assert(finite(fit.fit_wall_seconds)&&fit.fit_wall_seconds>=0);bytes(bp('train-inputs.json'),fit.train_sha256);bytes(bp('test-inputs.json'),fit.test_sha256);preserveInputs(train,b.train,true,timing);preserveInputs(test,b.test,false,timing);
   const model=read(bp('map.json'));assert.deepEqual(model.settings,plan.conditional_settings);trainVocabulary(model,train);const expected=b.test.map(r=>({...r,gap_seconds:timing.get(key(r)).gap_seconds}));const rows=read(bp('predictions.json'));maxScalarError=Math.max(maxScalarError,verifyPredictions(rows,expected,model,frozen));for(const n of ['scalar_max_error','reverse_max_error','sampled_singleton_max_error'])assert(finite(fit[n])&&fit[n]>=0&&fit[n]<=1e-12);
   const card=read(bp('scorecard.json'));save(fold+'-'+b.month+'-points.json',audit(rows,card));audit(diagnostic(rows),read(bp('timing-scorecard.json')));const games=new Set(rows.map(r=>r.game_id)).size;assert.deepEqual(monthly[b.month],{events:rows.length,games,losses:losses(card),fit_wall_seconds:fit.fit_wall_seconds,support:rows.length<100||games<30?'sparse':'supported_exploratory'});merged.push(...rows);
  }
  merged.sort((a,b)=>a.game_id-b.game_id||a.event_id-b.event_id);assert.deepEqual(read(p('predictions.json')),merged);const card=read(p('scorecard.json')),a=audit(merged,card);save(fold+'-aggregate-points.json',a);audit(diagnostic(merged),read(p('timing-scorecard.json')));const point=losses(card),passed=guard(a.overall);assert.deepEqual(read(p('summary.json')),{events:merged.length,losses:point,primary_guard_passed:passed});assert.deepEqual(result.folds[fold],read(p('summary.json')));const old=src('summary.json');for(const n of ['fixed','expanding'])for(const m of METRICS)assert(Math.abs(point[n][m]-old.losses[n][m])<=1e-12);const controlSummary=read(path.join(ROOT,CONTROL,fold,'summary.json'));for(const m of METRICS)assert(Math.abs(point.timing100[m]-controlSummary.losses.timing[m])<=1e-12);reports[fold]={events:merged.length,blocks:blocks.length,point_comparisons:comparisons,maximum_point_error:maxError,maximum_scalar_error:maxScalarError,losses:point,primary_guard_passed:passed};
 }
 assert.equal(result.primary_guard_passed,Object.values(reports).every(r=>r.primary_guard_passed));for(const n of ['publishable','model_accepted','production_changed','historical_as_of_verified'])assert.equal(result[n],false);
 recheck();bindInventory(reader,run,health);for(const [folder,h]of bound)bindInventory(reader,folder,h);save('checked-file-sha256.json',checked);save('review.json',{source_health_sha256:sourceHealthSHA,checker_sha256:checker,reports,publishable:false,fits:false,limitations:['Every saved test prediction scalar-replayed; original eight groups and frozen controls preserved.','Exact earlier-only saved fit memberships checked; no refitting, optimizer proof or bootstrap recomputation.','Raw/context snapshots and timing audit joined; no independent raw-tree or full event-body reconstruction.','Adaptive retrospective development, not untouched evaluation or production acceptance.']});for(const [n,h]of Object.entries(files))assert.equal(hash(fs.readFileSync(path.join(output,n))),h);save('health.json',{status:'complete-independent-timing-ridge10-review',publishable:false,files:{...files}});return reports;
 }catch(e){save('failure.json',{error:String(e),publishable:false,files:{...files}});throw e;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const a=process.argv.slice(2);assert(a.length===4&&a[0]==='--run'&&a[2]==='--output');await review(a[1],a[3]);}
