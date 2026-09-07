// Independent saved-point review only. No fitting, model deserialization or writes to inputs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {auditCard} from './review_method_challengers.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const RESULTS=path.join(ROOT,'scripts/proof/results');
const BASELINE=path.join(RESULTS,'official-calibration-shape-experiment-20260906');
const MOVEMENT=path.join(RESULTS,'official-movement-20260906-full');
export const MODELS=['frozen_monotone_group','frozen_movement_monotone_group','movement_raw','conditional_shape'].sort();
const FOLDS=['fold1','fold2'],PRIMARY='conditional_shape',FROZEN='frozen_monotone_group';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const key=r=>JSON.stringify([r.game_id,r.event_id]);

export function parseArgs(args){
  assert.equal(args.length,4,'Require --run DIR --output DIR');
  assert.equal(args[0],'--run');assert.equal(args[2],'--output');
  const run=path.resolve(args[1]),output=path.resolve(args[3]);
  assert.equal(path.dirname(run),RESULTS,'Run must be directly within results');
  assert.equal(path.dirname(output),RESULTS,'Review must be directly within results');
  assert(path.basename(run).startsWith('official-conditional-shape-'));
  assert(path.basename(output).startsWith('conditional-shape-candidate-review-'));
  assert.notEqual(run,output);return {run,output};
}

export function verifyBaseline(rows,prior,movementPrior){
  assert(Array.isArray(movementPrior)&&movementPrior.length>0);
  const move=new Map(movementPrior.map(r=>[key(r),r]));
  assert.equal(move.size,movementPrior.length,'Duplicate movement event');
  assert.deepEqual(rows.map(key).sort(),[...move.keys()].sort(),'Exact movement population required');
  assert(rows.length>0&&prior.length>0,'Nonempty populations required');
  const old=new Map(prior.map(r=>[key(r),r]));
  assert.equal(old.size,prior.length,'Duplicate baseline event');
  assert.equal(new Set(rows.map(key)).size,rows.length,'Duplicate candidate event');
  assert.deepEqual(rows.map(key).sort(),[...old.keys()].sort(),'Exact baseline population required');
  for(const r of rows){
    const mb=move.get(key(r));assert.deepEqual(r.target,mb.target);assert.deepEqual(r.groups,mb.groups);
    assert.equal(r.predictions.movement_raw,mb.predictions.movement_raw,'Frozen raw movement probability required');
    assert.equal(r.predictions.frozen_movement_monotone_group,mb.predictions.movement_monotone_group);
    const b=old.get(key(r));assert.deepEqual(r.target,b.target,'Exact outcome required');
    assert.deepEqual(r.groups,b.groups,'Exact subgroup membership required');
    assert.deepEqual(Object.keys(r.predictions).sort(),MODELS,'Exact movement candidates required');
    assert.equal(r.predictions[FROZEN],b.predictions.monotone_logit_group,'Exact frozen probability required');
  }
}

export function primaryGuard(overall){
  return ['brier','log_loss_clipped'].every(m=>overall[PRIMARY][m]<=overall[FROZEN][m]
    &&overall[PRIMARY][m]<=overall.frozen_movement_monotone_group[m]);
}

export function reviewFold(rows,card,prior,movementPrior){
  verifyBaseline(rows,prior,movementPrior);
  const report=auditCard(rows,card);
  report.baseline_parity='exact_event_label_groups_probability';
  report.primary=PRIMARY;
  report.primary_guard_passed=primaryGuard(report.overall);
  report.guard_controls=[FROZEN,'frozen_movement_monotone_group'];
  report.guard_outcomes=Object.fromEntries(MODELS.filter(n=>n!==FROZEN).map(n=>[n,{
    brier_no_worse:report.overall[n].brier<=report.overall[FROZEN].brier,
    log_loss_no_worse:report.overall[n].log_loss_clipped<=report.overall[FROZEN].log_loss_clipped,
  }]));
  return report;
}

function safe(p){
  p=path.resolve(ROOT,p);assert(p.startsWith(ROOT+path.sep),'Repository inputs only');
  for(let q=p;q!==path.dirname(ROOT);q=path.dirname(q))assert(!fs.lstatSync(q).isSymbolicLink(),'No symlinks');
  assert(fs.statSync(p).isFile(),'Regular files only');return p;
}
function inventory(dir){
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
    const p=path.join(dir,e.name);assert(!e.isSymbolicLink(),'No output symlinks');
    assert(e.isDirectory()||e.isFile(),'Regular evidence only');return e.isDirectory()?inventory(p):[p];
  });
}

export function review({run,output}){
  ({run,output}=parseArgs(['--run',run,'--output',output]));
  for(const p of [run,RESULTS])for(let q=p;q!==path.dirname(ROOT);q=path.dirname(q)){
    assert(!fs.lstatSync(q).isSymbolicLink(),'No directory symlinks');
  }
  fs.mkdirSync(output); // Create-only; an existing attempt is never touched.
  const checked=new Map();
  function verify(p,expected){
    p=safe(p);assert(/^[0-9a-f]{64}$/.test(expected),'Exact SHA256 required');
    if(checked.has(p))assert.equal(checked.get(p),expected,'Conflicting digest declarations');
    assert.equal(hash(fs.readFileSync(p)),expected,'File drift: '+p);checked.set(p,expected);
  }
  function read(p){p=safe(p);const bytes=fs.readFileSync(p);verify(p,hash(bytes));return JSON.parse(bytes);}
  function verifyMap(map){
    assert(map&&typeof map==='object'&&!Array.isArray(map));
    for(const [p,h] of Object.entries(map))verify(p,h);
  }
  function save(name,value){fs.writeFileSync(path.join(output,name),JSON.stringify(value)+'\n',{flag:'wx'});}
  try{
    save('attempt-started.json',{run:path.relative(ROOT,run),started_at:new Date().toISOString(),publishable:false});
    for(const name of ['review_conditional_shape_candidate.mjs','test_review_conditional_shape_candidate.mjs','review_method_challengers.mjs']){
      const p=path.join(ROOT,'scripts/proof',name);verify(p,hash(fs.readFileSync(safe(p))));
    }
    const health=read(path.join(run,'health.json'));
    assert.equal(health.status,'complete-conditional-shape-development-not-accepted');assert.equal(health.publishable,false);
    assert(!fs.existsSync(path.join(run,'failure.json')),'Failed candidate cannot be reviewed as complete');
    assert(health.files&&typeof health.files==='object'&&!Array.isArray(health.files));
    assert.deepEqual(inventory(run).map(p=>path.relative(run,p)).sort(),[...Object.keys(health.files),'health.json'].sort(),'Exact completed evidence inventory');
    for(const [rel,h] of Object.entries(health.files)){
      assert(!path.isAbsolute(rel)&&!rel.split(/[\\/]/).includes('..'),'Relative contained manifest keys');
      verify(path.join(run,rel),h);
    }
    const declaration=read(path.join(run,'declaration.json'));
    assert.equal(declaration.plan.primary,PRIMARY);assert.equal(declaration.plan.publishable,false);
    assert.equal(declaration.plan.automatic_acceptance,false);
    verifyMap(declaration.code_and_reference_sha256);
    verifyMap(read(path.join(run,'source-replay.json')).checked);
    verifyMap(read(path.join(run,'consumed-file-sha256.json')));
    const movementHealthFile=path.join(MOVEMENT,'health.json');
    assert(checked.has(movementHealthFile),'Movement must be in candidate hash closure');
    const summaries={};
    for(const fold of FOLDS){
      const priorFile=path.join(BASELINE,fold,'predictions.json');
      assert(checked.has(priorFile),'Baseline must be in candidate hash closure');
      const movementFile=path.join(MOVEMENT,fold,'predictions.json');
      assert(checked.has(movementFile),'Movement predictions must be pinned');
      const report=reviewFold(read(path.join(run,fold,'predictions.json')),
        read(path.join(run,fold,'scorecard.json')),read(priorFile),read(movementFile));
      const saved=read(path.join(run,fold,'summary.json'));
      assert.equal(saved.events,report.events);assert.equal(saved.primary_guard_passed,report.primary_guard_passed);
      assert.deepEqual(Object.keys(saved.losses).sort(),MODELS);
      for(const n of MODELS)for(const m of ['brier','log_loss_clipped']){
        assert(Math.abs(saved.losses[n][m]-report.overall[n][m])<=report.tolerance,'Summary point mismatch');
      }
      save(fold+'.json',report);
      summaries[fold]={events:report.events,point_comparisons:report.point_comparisons,
        maximum_absolute_error:report.maximum_absolute_error,primary_guard_passed:report.primary_guard_passed,
        guard_outcomes:report.guard_outcomes,overall:Object.fromEntries(MODELS.map(n=>[n,{
          brier:report.overall[n].brier,log_loss_clipped:report.overall[n].log_loss_clipped}]))};
    }
    const result=read(path.join(run,'result.json'));
    const passed=FOLDS.every(f=>summaries[f].primary_guard_passed);
    assert.deepEqual(Object.keys(result.folds).sort(),FOLDS);
    assert.equal(result.primary_guard_passed,passed);assert.equal(result.publishable,false);
    assert.equal(result.model_accepted,false);assert.equal(result.production_changed,false);
    for(const [p,h] of checked)assert.equal(hash(fs.readFileSync(safe(p))),h,'End input drift');
    save('checked-file-sha256.json',Object.fromEntries(checked));
    const report={contract:'citrus-independent-js-conditional-shape-review-v1',status:'independent-point-review-complete',
      run:path.relative(ROOT,run),folds:summaries,primary:PRIMARY,primary_guard_passed:passed,
      checked_files:checked.size,publishable:false,limitations:[
        'Independent fixed-fit point losses, bins, subgroups and saved paired differences only; no bootstrap, AUC/AP, optimizer, refit or model-inference recomputation.',
        'Local hash consistency and exact frozen baseline identity do not authenticate historical availability or the external data source.',
        'Development comparison is not prospective acceptance, serving activation or industry-superiority evidence.',
      ]};
    save('review.json',report);
    save('health.json',{status:'complete-independent-point-review-not-acceptance',publishable:false,
      files:Object.fromEntries(inventory(output).map(p=>[path.relative(output,p),hash(fs.readFileSync(p))]))});
    return report;
  }catch(error){try{save('failure.json',{error:String(error),publishable:false});}catch{}throw error;}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  console.log(JSON.stringify(review(parseArgs(process.argv.slice(2)))));
}
