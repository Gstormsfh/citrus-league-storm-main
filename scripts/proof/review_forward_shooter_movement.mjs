// Independent saved point review. No fitting, model deserialization or bootstrap replay.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {auditCard} from './review_method_challengers.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const OUTPUTS=['new_neutral','global_control','shooter','frozen_conditional_shape'];
const CONTROLS=OUTPUTS.filter(x=>x!=='shooter');
const PLAN_SHA='144abff89374538279c0dde29ee737708c92e27a6c833c4c0dec94bfcfaa9cae';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const key=r=>JSON.stringify([r.game_id,r.event_id]);
export function inventory(directory){return fs.readdirSync(directory,{withFileTypes:true}).flatMap(e=>{assert(!e.isSymbolicLink());assert(e.isFile()||e.isDirectory());const p=path.join(directory,e.name);return e.isDirectory()?inventory(p):[p];});}
export function evidenceReader(root=ROOT){
  const checked={};
  function safe(p,file=true){assert(!p.split(path.sep).includes('..'));p=path.resolve(root,p);assert(p.startsWith(root+path.sep));for(let q=p;q!==path.dirname(root);q=path.dirname(q))assert(!fs.lstatSync(q).isSymbolicLink(),'Evidence symlink');if(file)assert(fs.statSync(p).isFile());return p;}
  function bytes(p,expected){p=safe(p);const raw=fs.readFileSync(p),sha=hash(raw);if(expected!==undefined){assert(/^[a-f0-9]{64}$/.test(expected));assert.equal(sha,expected,'Evidence drift');}if(checked[p])assert.equal(sha,checked[p]);checked[p]=sha;return raw;}
  const read=(p,expected)=>JSON.parse(bytes(p,expected));
  function mapping(map){assert(map&&typeof map==='object'&&!Array.isArray(map));for(const [p,sha] of Object.entries(map))bytes(p,sha);}
  function recheck(){for(const [p,sha] of Object.entries(checked))bytes(p,sha);}
  return {checked,safe,bytes,read,mapping,recheck};
}
export function guard(losses){
  for(const name of OUTPUTS)for(const m of ['brier','log_loss_clipped'])assert(Number.isFinite(losses[name][m]));
  return CONTROLS.every(c=>['brier','log_loss_clipped'].every(m=>losses.shooter[m]<=losses[c][m]));
}
export function verifyRows(rows,prior){
  assert(rows.length&&prior.length);const old=new Map(prior.map(r=>[key(r),r]));assert.equal(old.size,prior.length);
  assert.deepEqual(rows.map(key).sort(),[...old.keys()].sort());
  for(const r of rows){assert(Number.isSafeInteger(r.game_id)&&r.game_id>0);assert(Number.isSafeInteger(r.event_id)&&r.event_id>=0);assert(r.target===0||r.target===1);
    const o=old.get(key(r));assert.equal(r.target,o.target);assert.deepEqual(r.groups,o.groups);assert.equal(r.predictions.frozen_conditional_shape,o.predictions.conditional_shape);
    assert.deepEqual(Object.keys(r.predictions).sort(),[...OUTPUTS].sort());for(const p of Object.values(r.predictions))assert(typeof p==='number'&&Number.isFinite(p)&&p>0&&p<1);
  }
}
export function verifyChronology(stages){
  assert.equal(stages.length,4);
  for(const s of stages){assert(Number.isSafeInteger(s.events)&&s.events>0);assert(Number.isSafeInteger(s.games)&&s.games>0&&s.games<=s.events);assert(/^\d{4}-\d{2}-\d{2}$/.test(s.start));assert(/^\d{4}-\d{2}-\d{2}$/.test(s.end));assert(s.start<=s.end);}
  for(let i=1;i<stages.length;i++)assert(stages[i-1].end<stages[i].start,'Strict forward date stages');
}
export function verifyIdentity(model,mode,stage,plan,validationGames){
  assert.equal(model.mode,mode);assert.equal(model.publishable,false);assert.equal(model.historical_as_of_verified,false);assert.deepEqual(model.settings,plan.identity_settings);
  assert.equal(model.fit_start,stage.start);assert.equal(model.fit_end,stage.end);assert.equal(model.fit_events,stage.events);
  assert.equal(model.fit_game_ids.length,stage.games);assert.equal(new Set(model.fit_game_ids).size,stage.games);
  assert(model.fit_game_ids.every(g=>Number.isSafeInteger(g)&&g>0&&!validationGames.has(g)));
  assert.deepEqual(Object.keys(model.effects),mode==='shooter'?['shooter']:[]);
  assert.equal(model.optimizer.success,true);assert(model.optimizer.max_projected_gradient<=plan.identity_settings.gradient_tolerance);
  assert.equal(model.optimizer.method,plan.identity_numerics.method);
  for(const effect of Object.values(model.effects)){const seen=new Set();for(const r of effect){assert(Number.isSafeInteger(r.player_id)&&r.player_id>0&&!seen.has(r.player_id));seen.add(r.player_id);assert(Number.isSafeInteger(r.fit_events)&&r.fit_events>0);assert(Number.isFinite(r.logit_effect)&&Math.abs(r.logit_effect)<=plan.identity_settings.coefficient_bound);}}
}
export function verifySplit(calibration,later,validation,split,expected,stages){
  verifyChronology(stages);
  const dates=new Map(),seen=new Set();for(const r of calibration){assert(Number.isSafeInteger(r.game_id)&&r.game_id>0);assert(Number.isSafeInteger(r.event_id)&&r.event_id>=0);assert(!seen.has(key(r)));seen.add(key(r));assert(/^\d{4}-\d{2}-\d{2}$/.test(r.game_date));if(dates.has(r.game_id))assert.equal(dates.get(r.game_id),r.game_date);dates.set(r.game_id,r.game_date);}
  const games=[...dates].sort((a,b)=>a[1].localeCompare(b[1])||a[0]-b[0]);assert(games.length>=2);const cutoff=games[Math.floor(games.length/2)][1];assert.equal(split.cutoff_date,cutoff);assert.equal(cutoff,expected.cutoff_date);
  const ordered=[...calibration].sort((a,b)=>a.game_date.localeCompare(b.game_date)||a.game_id-b.game_id||a.event_id-b.event_id);
  const earlier=ordered.filter(r=>r.game_date<cutoff),last=ordered.filter(r=>r.game_date>=cutoff);assert(earlier.length&&last.length);assert.deepEqual(later,last);
  for(const [i,name,rows] of [[1,'earlier_map',earlier],[2,'later_identity',last]]){
    const part={events:rows.length,games:new Set(rows.map(r=>r.game_id)).size,start:rows[0].game_date,end:rows.at(-1).game_date,event_keys_sha256:hash(JSON.stringify(rows.map(r=>[r.game_id,r.event_id])))};
    assert.deepEqual(part,expected[name]);assert.deepEqual(split[name],{...part,game_ids:[...new Set(rows.map(r=>r.game_id))].sort((a,b)=>a-b)});
    const {event_keys_sha256,...window}=part;assert.deepEqual(stages[i],window);
  }
  const valGames=new Set();for(const r of validation){assert(!dates.has(r.game_id));assert(r.game_date>stages[2].end);valGames.add(r.game_id);}
  assert.equal(validation.length,stages[3].events);assert.equal(valGames.size,stages[3].games);
  assert.equal([...validation].map(r=>r.game_date).sort()[0],stages[3].start);assert.equal([...validation].map(r=>r.game_date).sort().at(-1),stages[3].end);
  return valGames;
}
export function review(run,output){
  run=path.resolve(run);output=path.resolve(output);const parent=path.join(ROOT,'scripts/proof/results');
  assert.equal(path.dirname(run),parent);assert(path.basename(run).startsWith('official-forward-shooter-movement-'));assert.equal(path.dirname(output),parent);assert(path.basename(output).startsWith('forward-shooter-movement-review-'));
  const {checked,safe,bytes,read,mapping,recheck}=evidenceReader();safe(run,false);safe(parent,false);assert(!fs.existsSync(output));fs.mkdirSync(output);
  const files={},reports={};const save=(name,value)=>{const body=JSON.stringify(value)+'\n';fs.writeFileSync(path.join(output,name),body,{flag:'wx'});files[name]=hash(body);};
  try{
    for(const name of ['review_forward_shooter_movement.mjs','test_review_forward_shooter_movement.mjs','review_method_challengers.mjs'])bytes(path.join(ROOT,'scripts/proof',name));
    const health=read(path.join(run,'health.json'));assert.equal(health.status,'complete-forward-shooter-movement-development-not-accepted');assert.equal(health.publishable,false);assert.deepEqual(health.completed_folds,['fold1','fold2']);
    assert.deepEqual(inventory(run).map(p=>path.relative(run,p)).sort(),[...Object.keys(health.files),'health.json'].sort());
    for(const [p,sha] of Object.entries(health.files)){assert(!path.isAbsolute(p)&&!p.split('/').includes('..'));bytes(path.join(run,p),sha);}
    const declaration=read(path.join(run,'declaration.json')),plan=declaration.plan;
    assert.equal(declaration.plan_sha256,PLAN_SHA);assert.deepEqual(read(path.join(ROOT,'docs/analytics-forward-shooter-movement-plan-20260906.json'),PLAN_SHA),plan);
    assert.equal(plan.primary,'shooter');assert.deepEqual(plan.outputs,OUTPUTS);assert.deepEqual(plan.controls,CONTROLS);for(const k of ['publishable','automatic_acceptance','historical_as_of_verified','untouched_test_claim'])assert.equal(plan[k],false);
    mapping(declaration.code_and_reference_sha256);mapping(read(path.join(run,'consumed-file-sha256.json')));
    const source=read(path.join(run,'source-reuse.json'));mapping(source.checked);assert.equal(source.cache_key,declaration.cache_key);
    for(const [folder,names] of Object.entries(source.inventories)){const dir=safe(folder,false);assert.deepEqual(inventory(dir).map(p=>path.relative(dir,p)).sort(),[...names].sort());}
    const oldDir=path.join(ROOT,plan.source.movement_directory),oldHealth=read(path.join(oldDir,'health.json'),plan.source.movement_health_sha256);
    const identityDir=path.join(ROOT,plan.source.identity_directory),identityHealth=read(path.join(identityDir,'health.json'),plan.source.identity_health_sha256);
    const result=read(path.join(run,'result.json'));
    for(const fold of ['fold1','fold2']){
      const p=name=>path.join(run,fold,name),rows=read(p('predictions.json')),old=read(path.join(oldDir,fold,'predictions.json'),oldHealth.files[fold+'/predictions.json']);verifyRows(rows,old);
      const model=read(p('model.json'));assert.deepEqual(model,read(path.join(oldDir,fold,'model.json'),oldHealth.files[fold+'/model.json']));assert.deepEqual(model.design.schema,plan.schema);
      const fit=read(p('fit-receipt.json'));assert.deepEqual(fit.schema,plan.schema);assert.equal(fit.raw_model_refitted,false);assert.equal(fit.design,'three_stage_forward_holdout_not_pooled_crossfit');assert.equal(fit.frozen_conditional_comparator_uses_more_map_fit_data,true);
      const cal=read(p('calibration-identity-inputs.json')),later=read(p('identity-fit-inputs.json')),validation=read(p('validation-identity-inputs.json'));
      const vg=verifySplit(cal,later,validation,read(p('split.json')),plan.expected_splits[fold],fit.stages);
      for(const [s,records] of [['calibration',cal],['validation',validation]]){
        const prior=read(path.join(identityDir,fold,s+'-identity-inputs.json'),identityHealth.files[fold+'/'+s+'-identity-inputs.json']);
        const strip=r=>{const {probability,...rest}=r;return rest;};assert.deepEqual(records.map(strip),prior.map(strip));
      }
      const valIndex=new Map(validation.map(r=>[key(r),r]));assert.equal(valIndex.size,rows.length);for(const r of rows){const v=valIndex.get(key(r));assert(v);assert.equal(r.target,v.target);assert.equal(r.predictions.new_neutral,v.probability);}
      const maps=read(p('calibrators.json'));assert.deepEqual(Object.keys(maps),['conditional_shape']);assert.equal(maps.conditional_shape.publishable,false);assert.deepEqual(maps.conditional_shape.settings,plan.conditional_settings);
      for(const mode of ['global_control','shooter']){const m=read(p(mode+'-model.json'));verifyIdentity(m,mode,fit.stages[2],plan,vg);assert.deepEqual(m.fit_game_ids,read(p('split.json')).later_identity.game_ids);}
      const card=read(p('scorecard.json'));assert.deepEqual(card.config,plan.scorecard);const audit=auditCard(rows,card);save(fold+'-points.json',audit);
      const summary=read(p('summary.json')),pass=guard(audit.overall),losses=Object.fromEntries(OUTPUTS.map(n=>[n,Object.fromEntries(['brier','log_loss_clipped'].map(m=>[m,card.overall.models[n].metrics[m].value]))]));
      assert.deepEqual(summary.losses,losses);assert.equal(summary.primary_guard_passed,pass);assert.equal(summary.events,rows.length);assert.deepEqual(result.folds[fold],summary);
      reports[fold]={events:rows.length,primary_guard_passed:pass,overall:audit.overall,point_comparisons:audit.point_comparisons,maximum_absolute_error:audit.maximum_absolute_error};
    }
    assert.equal(result.primary_guard_passed,Object.values(reports).every(r=>r.primary_guard_passed));for(const k of ['publishable','model_accepted','neutral_xg_replaced','production_changed','fpar_accepted'])assert.equal(result[k],false);
    recheck();save('checked-file-sha256.json',checked);save('review.json',{publishable:false,reports,checked_files:Object.keys(checked).length,limitations:['Point metrics, saved membership and metadata verified; no refitting, independent bootstrap or AUC/AP recomputation.','Raw source role joins and map fitting provenance are covered by separate runner/source review, not rederived here.','Adaptive three-stage forward development, not pooled cross-fitting, untouched test or acceptance.']});
    for(const [name,sha] of Object.entries(files))assert.equal(hash(fs.readFileSync(path.join(output,name))),sha);
    save('health.json',{status:'complete-independent-forward-shooter-point-review',publishable:false,files:{...files}});return reports;
  }catch(error){save('failure.json',{error:String(error),publishable:false});throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(review(process.argv[2],process.argv[3])));
