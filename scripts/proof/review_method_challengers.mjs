// Independent point-metric audit. Hash bytes only; no model loading or fitting.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const TOLERANCE=1e-8;
const BINS=[0,.01,.025,.05,.1,.2,.35,.5,.75,1];
const RUNS=['official-strength-partition-20260906-1731','official-identity-probability-v2-20260906-1742'];
const SHAPE='scripts/proof/results/official-calibration-shape-experiment-20260906';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const exact=(a,b,message)=>assert.deepEqual(a,b,message);
function safe(p){
  p=path.resolve(ROOT,p);
  assert(p.startsWith(ROOT+path.sep),'Evidence must stay within repository');
  for(let q=p;q!==path.dirname(ROOT);q=path.dirname(q))assert(!fs.lstatSync(q).isSymbolicLink(),'No evidence symlinks');
  assert(fs.statSync(p).isFile(),'Regular evidence only');return p;
}
function read(p){return JSON.parse(fs.readFileSync(safe(p),'utf8'));}
function sum(values){let s=0,c=0;for(const x of values){const y=x-c,t=s+y;c=(t-s)-y;s=t;}return s;}
const key=r=>JSON.stringify([r.game_id,r.event_id]);

export function statistics(rows,model,edges=BINS,epsilon=1e-12){
  const n=rows.length,goals=sum(rows.map(r=>r.target)),ps=rows.map(r=>r.predictions[model]);
  const expected=sum(ps),clipped=ps.map(p=>Math.min(1-epsilon,Math.max(epsilon,p)));
  return {events:n,games:new Set(rows.map(r=>r.game_id)).size,goals,expected_goals:expected,
    brier:n?sum(ps.map((p,i)=>(p-rows[i].target)**2))/n:null,
    log_loss_clipped:n?-sum(clipped.map((p,i)=>rows[i].target?Math.log(p):Math.log1p(-p)))/n:null,
    mean_prediction:n?expected/n:null,observed_rate:n?goals/n:null,
    observed_minus_expected_rate:n?(goals-expected)/n:null,
    clipped_prediction_count:ps.filter(p=>p<epsilon||p>1-epsilon).length,
    impossible_observation_count:ps.filter((p,i)=>(p===0&&rows[i].target===1)||(p===1&&rows[i].target===0)).length,
    reliability:edges.slice(0,-1).map((lower,i)=>{
      const upper=edges[i+1],last=i===edges.length-2;
      const rr=rows.filter(r=>r.predictions[model]>=lower&&(r.predictions[model]<upper||(last&&r.predictions[model]===upper)));
      const p=sum(rr.map(r=>r.predictions[model])),y=sum(rr.map(r=>r.target)),n=rr.length;
      return {lower,upper,upper_inclusive:last,events:n,games:new Set(rr.map(r=>r.game_id)).size,
        mean_prediction:n?p/n:null,observed_rate:n?y/n:null,gap:n?(y-p)/n:null};
    })};
}

export function auditCard(rows,card){
  assert(rows.length>0);exact(card.config.bin_edges,BINS,'Original nine bins required');
  assert.equal(card.config.log_loss_epsilon,1e-12);
  assert.equal(card.contract,'citrus-probability-scorecard-v1');
  assert.equal(card.status,'measured_not_model_acceptance');assert.equal(card.publishable,false);
  const models=Object.keys(rows[0].predictions).sort(),dimensions=Object.keys(rows[0].groups).sort();
  const ids=new Set();
  for(const r of rows){
    assert(Number.isSafeInteger(r.game_id)&&Number.isSafeInteger(r.event_id));
    assert(!ids.has(key(r)),'Duplicate event');ids.add(key(r));
    assert(r.target===0||r.target===1);exact(Object.keys(r.predictions).sort(),models);exact(Object.keys(r.groups).sort(),dimensions);
    for(const p of Object.values(r.predictions))assert(typeof p==='number'&&Number.isFinite(p)&&p>=0&&p<=1);
    for(const v of Object.values(r.groups))assert(v===null||typeof v==='string');
  }
  let maximumError=0,comparisons=0;
  function close(actual,expected,label){
    if(expected===null){assert.equal(actual,null,label);return;}
    assert(typeof actual==='number'&&Number.isFinite(actual),label);
    const error=Math.abs(actual-expected);maximumError=Math.max(maximumError,error);comparisons++;
    assert(error<=TOLERANCE,`${label}: ${actual} vs ${expected}, error ${error}`);
  }
  function compare(rr,saved,label){
    exact(Object.keys(saved.models).sort(),models,'Exact model population');const result={};
    for(const model of models){
      const x=statistics(rr,model);result[model]=x;
      for(const field of ['events','games','goals'])exact(saved[field],x[field],label+'.'+field);
      const got=saved.models[model];
      for(const field of ['clipped_prediction_count','impossible_observation_count'])exact(got[field],x[field]);
      close(got.expected_goals,x.expected_goals,label+'.expected_goals');
      for(const field of ['brier','log_loss_clipped','mean_prediction','observed_rate','observed_minus_expected_rate'])close(got.metrics[field].value,x[field],label+'.'+model+'.'+field);
      exact(got.reliability.length,9);
      for(let i=0;i<9;i++){
        const b=x.reliability[i],old=got.reliability[i];
        for(const field of ['lower','upper','upper_inclusive','events','games'])exact(old[field],b[field],label+'.bin'+i+'.'+field);
        for(const field of ['mean_prediction','observed_rate','gap'])close(old[field].value,b[field],label+'.bin'+i+'.'+field);
      }
    }
    // Recompute every saved pair's requested point differences, not intervals.
    const pairs=new Set();
    for(const pair of saved.paired_differences){
      assert.equal(pair.direction,'left_minus_right');assert(result[pair.left]&&result[pair.right]);
      const id=JSON.stringify([pair.left,pair.right]);assert(!pairs.has(id));pairs.add(id);
      for(const field of ['brier','log_loss_clipped'])close(pair.metrics[field].value,result[pair.left][field]-result[pair.right][field],label+'.pair');
    }
    exact(pairs.size,models.length*(models.length-1)/2);
    return result;
  }
  const overall=compare(rows,card.overall,'overall'),subgroups=[];
  const expectedGroups=new Map();
  for(const dimension of dimensions)for(const value of new Set(rows.map(r=>r.groups[dimension])))expectedGroups.set(JSON.stringify([dimension,value]),{dimension,value});
  exact(card.subgroups.length,expectedGroups.size);
  for(const g of card.subgroups){
    const id=JSON.stringify([g.dimension,g.value]);assert(expectedGroups.has(id),'Unknown/duplicate subgroup');expectedGroups.delete(id);
    const rr=rows.filter(r=>r.groups[g.dimension]===g.value);
    subgroups.push({dimension:g.dimension,value:g.value,membership_sha256:sha(JSON.stringify(rr.map(key))),models:compare(rr,g.statistics,id)});
  }
  exact(expectedGroups.size,0);
  return {models,events:rows.length,subgroups,overall,point_comparisons:comparisons,maximum_absolute_error:maximumError,tolerance:TOLERANCE};
}

function inventory(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
  const p=path.join(dir,e.name);assert(!e.isSymbolicLink());return e.isDirectory()?inventory(p):[p];
});}

export function review(output){
  output=path.resolve(output);
  assert.equal(path.dirname(output),path.join(ROOT,'scripts/proof/results'));
  assert(path.basename(output).startsWith('method-challenger-review-20260906-'));
  fs.mkdirSync(output); // Duplicate attempt must never modify a prior review.
  const checked=new Map(),reports={};
  function verify(p,expected){
    p=safe(p);assert(/^[0-9a-f]{64}$/.test(expected));
    if(checked.has(p)){assert.equal(checked.get(p),expected,'Conflicting digest declarations');return;}
    assert.equal(sha(fs.readFileSync(p)),expected,'File drift: '+p);checked.set(p,expected);
  }
  function map(values){assert(values&&typeof values==='object'&&!Array.isArray(values));for(const [p,h] of Object.entries(values))verify(p,h);}
  function save(name,value){fs.writeFileSync(path.join(output,name),JSON.stringify(value)+'\n',{flag:'wx'});}
  try{
    save('attempt-started.json',{started_at:new Date().toISOString(),publishable:false});
    const reviewer=fileURLToPath(import.meta.url);verify(reviewer,sha(fs.readFileSync(reviewer)));
    for(const name of RUNS){
      const dir=path.join(ROOT,'scripts/proof/results',name),health=read(path.join(dir,'health.json'));
      assert(!fs.existsSync(path.join(dir,'failure.json')));assert.equal(health.publishable,false);
      assert(['complete-strength-development-not-accepted','complete-identity-development-not-accepted'].includes(health.status));
      exact(health.completed_folds,['fold1','fold2']);
      exact(inventory(dir).map(p=>path.relative(dir,p)).sort(),[...Object.keys(health.files),'health.json'].sort());
      verify(path.join(dir,'health.json'),sha(fs.readFileSync(path.join(dir,'health.json'))));
      for(const [rel,h] of Object.entries(health.files)){assert(!path.isAbsolute(rel)&&!rel.split('/').includes('..'));verify(path.join(dir,rel),h);}
      const declaration=read(path.join(dir,'declaration.json'));
      if(declaration.code_and_reference_sha256)map(declaration.code_and_reference_sha256);
      if(declaration.code_sha256)map(declaration.code_sha256);
      if(fs.existsSync(path.join(dir,'source-replay.json')))map(read(path.join(dir,'source-replay.json')).checked);
      if(fs.existsSync(path.join(dir,'consumed-file-sha256.json')))map(read(path.join(dir,'consumed-file-sha256.json')));
      const folds={};
      for(const fold of health.completed_folds){
        const rows=read(path.join(dir,fold,'predictions.json')),card=read(path.join(dir,fold,'scorecard.json'));
        const baseline=read(`${SHAPE}/${fold}/predictions.json`),old=new Map(baseline.map(r=>[key(r),r]));
        assert.equal(old.size,baseline.length);exact([...old.keys()].sort(),rows.map(key).sort());
        const baselineName=name.includes('strength')?'frozen_monotone_logit_group':'frozen_monotone';
        for(const r of rows){const b=old.get(key(r));exact(r.target,b.target);exact(r.groups,b.groups,'Exact prior subgroup membership');exact(r.predictions[baselineName],b.predictions.monotone_logit_group,'Exact frozen baseline probability');}
        const report=auditCard(rows,card);
        report.baseline_parity='exact_event_label_groups_probability';
        report.guard_outcomes=Object.fromEntries(report.models.filter(n=>n!==baselineName).map(n=>[n,{
          brier_no_worse:report.overall[n].brier<=report.overall[baselineName].brier,
          log_loss_no_worse:report.overall[n].log_loss_clipped<=report.overall[baselineName].log_loss_clipped}]));
        save(name+'-'+fold+'.json',report);folds[fold]={events:report.events,models:report.models,
          subgroup_count:report.subgroups.length,maximum_absolute_error:report.maximum_absolute_error,
          guard_outcomes:report.guard_outcomes,overall:Object.fromEntries(report.models.map(n=>[n,{brier:report.overall[n].brier,log_loss:report.overall[n].log_loss_clipped}]))};
      }
      reports[name]={folds,status:'point_metrics_and_hash_closure_verified',publishable:false,
        scope_caveat:name.includes('identity')?'Saved generic neutral scorecard label does not describe actor-conditioned shooter/joint candidates; not neutral-xG gain.':null};
    }
    for(const [p,h] of checked)assert.equal(sha(fs.readFileSync(safe(p))),h,'End input drift');
    save('checked-file-sha256.json',Object.fromEntries(checked));
    save('review.json',{contract:'citrus-independent-js-method-challenger-review-v1',reports,checked_files:checked.size,
      tolerance:TOLERANCE,publishable:false,limitations:['No bootstrap intervals, AUC/AP, calibration optimizer or model inference recomputed.',
      'Hashes verify local consistency, not historical source availability or publisher authentication.',
      'Inspected retrospective development; no untouched holdout or prospective acceptance claim.']});
    const files=Object.fromEntries(inventory(output).map(p=>[path.basename(p),sha(fs.readFileSync(p))]));
    save('health.json',{status:'complete-independent-point-review-not-acceptance',files,publishable:false});
    return {reports,checked_files:checked.size};
  }catch(error){try{save('failure.json',{error:String(error),publishable:false});}catch{}throw error;}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  assert.equal(process.argv[2],'--output');assert.equal(process.argv.length,4);
  console.log(JSON.stringify(review(process.argv[3])));
}
