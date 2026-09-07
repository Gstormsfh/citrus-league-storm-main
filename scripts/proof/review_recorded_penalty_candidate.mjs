// Independent saved point metrics and evidence delivery; no fitting or binaries.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {auditCard} from './review_method_challengers.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const PRIMARY='recorded_penalty_conditional_shape';
const CONTROLS=['frozen_conditional_shape','frozen_monotone_group'];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const key=r=>JSON.stringify([r.game_id,r.event_id]);

export function guarded(losses){
  return CONTROLS.every(c=>['brier','log_loss_clipped'].every(m=>{
    assert(Number.isFinite(losses[PRIMARY][m])&&Number.isFinite(losses[c][m]));
    return losses[PRIMARY][m]<=losses[c][m];
  }));
}

export function verifySchema(model,receipt,plan){
  const base=plan.features.base_schema;
  assert.equal(base.names.length,47);assert.equal(base.categorical_names.length,2);
  const expected={...base,version:plan.features.candidate_schema_version,
    names:[...base.names,...plan.features.append_numeric.map(r=>r.name)],
    categorical_names:[...base.categorical_names,...plan.features.append_categorical.map(r=>r.name)]};
  assert.equal(expected.names.length,51);assert.equal(expected.categorical_names.length,6);
  assert.deepEqual(model.design.schema,expected);assert.deepEqual(receipt.schema,expected);
  assert.deepEqual(model.design.numeric_names,expected.names);
  assert.deepEqual(model.design.categorical_names,expected.categorical_names);
  assert.deepEqual(receipt.config.views.enhanced_numeric_names,expected.names);
  assert.deepEqual(receipt.config.views.enhanced_categorical_names,expected.categorical_names);
}

export function verifyRows(rows,diagnostics,prior,plan){
  const old=new Map(prior.map(r=>[key(r),r])), diag=new Map(diagnostics.map(r=>[key(r),r]));
  assert.equal(old.size,prior.length);assert.equal(diag.size,diagnostics.length);
  assert.deepEqual(rows.map(key).sort(),[...old.keys()].sort());
  assert.deepEqual(rows.map(key).sort(),[...diag.keys()].sort());
  for(const row of rows){
    const baseline=old.get(key(row)),d=diag.get(key(row));
    assert.equal(row.target,baseline.target);assert.deepEqual(row.groups,baseline.groups);
    assert.equal(row.predictions.frozen_conditional_shape,baseline.predictions.conditional_shape);
    assert.equal(row.predictions.frozen_monotone_group,baseline.predictions.frozen_monotone_group);
    assert.equal(d.target,row.target);assert.deepEqual(d.predictions,row.predictions);
    assert.deepEqual(Object.keys(row.predictions).sort(),[PRIMARY,...CONTROLS,'recorded_penalty_raw'].sort());
    assert.deepEqual(Object.keys(d.groups).sort(),plan.features.append_categorical.map(r=>r.name).sort());
    for(const field of plan.features.append_categorical){
      const value=d.groups[field.name];
      if(field.allowed)assert(field.allowed.includes(value));
      else {
        assert(typeof value==='string');
        if(value.startsWith('unavailable:'))assert(plan.features.unavailable_reasons.includes(value.slice('unavailable:'.length)));
        else assert(/^recorded:type_(known|missing):duration_(known|missing)$/.test(value));
      }
    }
  }
}

export function inventory(directory){
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    assert(!entry.isSymbolicLink(),'Evidence symlink forbidden');
    const p=path.join(directory,entry.name);
    assert(entry.isDirectory()||entry.isFile(),'Regular evidence required');
    return entry.isDirectory()?inventory(p):[p];
  });
}

export function review(runName,outputName){
  const run=path.resolve(runName),output=path.resolve(outputName),parent=path.join(ROOT,'scripts/proof/results');
  assert.equal(path.dirname(run),parent);assert(path.basename(run).startsWith('official-recorded-penalty-'));
  assert.equal(path.dirname(output),parent);assert(path.basename(output).startsWith('recorded-penalty-review-'));
  function safe(p,file=true){
    assert(!p.split(path.sep).includes('..'),'Traversal forbidden');p=path.resolve(ROOT,p);
    assert(p.startsWith(ROOT+path.sep),'Repository evidence only');
    for(let q=p;q!==path.dirname(ROOT);q=path.dirname(q))assert(!fs.lstatSync(q).isSymbolicLink(),'No symlinks');
    if(file)assert(fs.statSync(p).isFile());return p;
  }
  safe(run,false);safe(parent,false);assert(!fs.existsSync(output));fs.mkdirSync(output);
  const checked={},reports={},files={};
  const save=(name,value)=>{const body=JSON.stringify(value)+'\n';fs.writeFileSync(path.join(output,name),body,{flag:'wx'});files[name]=hash(body);};
  function verify(p,expected){
    p=safe(p);assert(/^[a-f0-9]{64}$/.test(expected));
    if(checked[p])assert.equal(checked[p],expected);
    else {assert.equal(hash(fs.readFileSync(p)),expected,'File drift: '+p);checked[p]=expected;}
  }
  function read(p){p=safe(p);const raw=fs.readFileSync(p),digest=hash(raw);if(checked[p])assert.equal(digest,checked[p]);checked[p]=digest;return JSON.parse(raw);}
  const mapping=map=>{assert(map&&typeof map==='object'&&!Array.isArray(map));for(const [p,h] of Object.entries(map))verify(p,h);};
  try{
    for(const name of ['review_recorded_penalty_candidate.mjs','test_review_recorded_penalty_candidate.mjs','review_method_challengers.mjs']){
      const p=path.join(ROOT,'scripts/proof',name);verify(p,hash(fs.readFileSync(safe(p))));
    }
    const health=read(path.join(run,'health.json'));
    assert.equal(health.status,'complete-recorded-penalty-development-not-accepted');assert.equal(health.publishable,false);
    assert(!fs.existsSync(path.join(run,'failure.json')));
    assert.deepEqual(inventory(run).map(p=>path.relative(run,p)).sort(),[...Object.keys(health.files),'health.json'].sort());
    for(const [name,h] of Object.entries(health.files)){assert(!path.isAbsolute(name)&&!name.split('/').includes('..'));verify(path.join(run,name),h);}
    const declaration=read(path.join(run,'declaration.json')),plan=declaration.plan;
    const planPath=path.join(ROOT,'docs/analytics-recorded-penalty-candidate-plan-20260906.json');
    verify(planPath,declaration.plan_sha256);assert.deepEqual(read(planPath),plan);
    assert.equal(plan.primary,PRIMARY);assert.equal(plan.publishable,false);assert.equal(plan.automatic_acceptance,false);
    mapping(declaration.code_and_reference_sha256);mapping(read(path.join(run,'consumed-file-sha256.json')));
    const source=read(path.join(run,'source-reuse.json'));mapping(source.checked);
    for(const [folder,names] of Object.entries(source.manifest_inventory)){
      const dir=safe(folder,false);assert.deepEqual(inventory(dir).map(p=>path.relative(dir,p)).sort(),[...names].sort());
    }
    const savedResult=read(path.join(run,'result.json'));
    for(const fold of ['fold1','fold2']){
      const p=name=>path.join(run,fold,name),rows=read(p('predictions.json')),diagnostics=read(p('penalty-diagnostic-predictions.json'));
      const control=plan.controls.frozen_conditional_shape;
      verify(path.join(ROOT,control.directory,'health.json'),control.health_sha256);
      const controlHealth=read(path.join(ROOT,control.directory,'health.json'));
      const priorPath=path.join(ROOT,control.directory,fold,'predictions.json');
      verify(priorPath,controlHealth.files[fold+'/predictions.json']);
      verifyRows(rows,diagnostics,read(priorPath),plan);
      verifySchema(read(p('model.json')),read(p('fit-receipt.json')),plan);
      const card=read(p('scorecard.json'));
      const standard=auditCard(rows,card),penalty=auditCard(diagnostics,read(p('penalty-diagnostic-scorecard.json')));
      save(fold+'-standard.json',standard);save(fold+'-penalty-diagnostics.json',penalty);
      const pass=guarded(standard.overall),summary=read(p('summary.json'));
      assert.equal(pass,summary.primary_guard_passed);assert.equal(pass,savedResult.folds[fold].primary_guard_passed);
      const savedLosses=Object.fromEntries(Object.keys(card.overall.models).map(name=>[name,
        Object.fromEntries(['brier','log_loss_clipped'].map(m=>[m,card.overall.models[name].metrics[m].value]))]));
      assert.deepEqual(summary.losses,savedLosses);assert.deepEqual(savedResult.folds[fold].losses,savedLosses);
      assert.equal(summary.events,rows.length);assert.equal(savedResult.folds[fold].events,rows.length);
      reports[fold]={events:rows.length,primary_guard_passed:pass,overall:standard.overall,
        point_comparisons:standard.point_comparisons+penalty.point_comparisons,
        maximum_absolute_error:Math.max(standard.maximum_absolute_error,penalty.maximum_absolute_error),
        penalty_subgroups:penalty.subgroups.length};
    }
    assert.equal(savedResult.primary_guard_passed,Object.values(reports).every(r=>r.primary_guard_passed));
    assert.equal(savedResult.publishable,false);assert.equal(savedResult.model_accepted,false);
    assert.equal(savedResult.production_changed,false);
    for(const [p,h] of Object.entries(checked))assert.equal(hash(fs.readFileSync(safe(p))),h);
    save('checked-file-sha256.json',checked);
    save('review.json',{status:'complete-independent-recorded-penalty-point-review',publishable:false,reports,
      checked_files:Object.keys(checked).length,limitations:['Point losses, reliability bins and subgroup arithmetic recomputed; bootstrap intervals, AUC/AP and refits not recomputed.',
      'Saved diagnostic state membership checked for shape/categories, not independently rederived from raw penalty sources.',
      'Local bytes and adaptive development outcomes, not live serving, untouched-test evidence or model acceptance.']});
    for(const [name,h] of Object.entries(files))assert.equal(hash(fs.readFileSync(path.join(output,name))),h);
    save('health.json',{status:'complete-independent-recorded-penalty-point-review',publishable:false,files:{...files}});
    console.log(JSON.stringify({checked_files:Object.keys(checked).length,reports}));
  }catch(error){save('failure.json',{publishable:false,error:String(error)});throw error;}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))review(process.argv[2],process.argv[3]);
