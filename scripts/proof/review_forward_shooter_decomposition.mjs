// Independent saved-shot loss arithmetic; no fits or bootstrap recomputation.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {evidenceReader,inventory} from './review_forward_shooter_movement.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const RESULTS=path.join(ROOT,'scripts/proof/results');
const PINS={
  'official-forward-shooter-movement-20260906-retry1':'829119131d856969b5278d1b14d1a711c19b4a5a404b6b932ee40cf29af9fe22',
  'forward-shooter-movement-review-20260906-retry1':'93e9d10c339f3b53e683f992abfaa7d2d85b534fe8d834f6e74178e2b10b8b2d'};
const EDGES=[0,.01,.025,.05,.1,.2,.35,.5,.75,1];
const METRICS=['brier','log_loss_clipped'];
const COMPONENTS=['total','map_pipeline','global','shooter_increment'];
const MODELS=['frozen_conditional_shape','new_neutral','global_control','shooter'];
const PLAN='docs/analytics-forward-shooter-decomposition-plan-20260906.md';
const PLAN_SHA='aa79a619e76647de8c9496d89a8ac9517792f9d93e623130e28ff17bac133540';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
export function verifyDeclaration(d){
  assert.equal(d.analysis,'adaptive-development-no-fit-forward-shooter-loss-decomposition');assert.equal(d.publishable,false);assert.equal(d.fit_permitted,false);
  assert.equal(d.anchor,'frozen_conditional_shape');assert.deepEqual(d.edges,EDGES);assert.deepEqual(d.components,COMPONENTS);assert.deepEqual(d.models,MODELS);
  assert.deepEqual(d.cell_axes,['anchor_probability_band_index','month','prior_sog_same_team']);assert.equal(d.epsilon,1e-12);assert.deepEqual(d.pins,PINS);
  assert.equal(d.plan_path,PLAN);assert.equal(d.plan_sha256,PLAN_SHA);
  assert.deepEqual(d.bootstrap,{draws:256,seed:60906,unit:'whole_game',interval:'percentile_95',contribution_denominator:'full_resampled_fold_events',cell_mean_empty_draws:'excluded_and_counted'});
  assert.deepEqual(d.support_label,{sparse_below_events:100,sparse_below_games:30,all_observed_cells_retained:true});
  assert.deepEqual(Object.keys(d.code_sha256).sort(),['scripts/proof/decompose_forward_shooter.py','scripts/proof/test_decompose_forward_shooter.py','scripts/proof/test_decompose_forward_shooter_review.py'].sort());
}
function key(r){assert(Number.isSafeInteger(r.game_id)&&r.game_id>0);assert(Number.isSafeInteger(r.event_id)&&r.event_id>=0);return JSON.stringify([r.game_id,r.event_id]);}
function index(rows){assert(Array.isArray(rows)&&rows.length);const m=new Map();for(const r of rows){const k=key(r);assert(!m.has(k));m.set(k,r);}return m;}
export function band(p){assert(typeof p==='number'&&Number.isFinite(p)&&p>=0&&p<=1);return Math.min(EDGES.filter(e=>e<=p).length-1,8);}
export function aggregate(predictions,records){
  const a=index(predictions),b=index(records);assert.deepEqual([...a.keys()].sort(),[...b.keys()].sort());
  const groups={overall:new Map(),cells:new Map(),anchor_band:new Map(),month:new Map(),prior_sog_same_team:new Map()};
  const dates=new Map();
  for(const [k,r] of a){const source=b.get(k);assert(r.target===0||r.target===1);assert.equal(source.target,r.target);assert.equal(source.probability,r.predictions.new_neutral);
    assert(/^\d{4}-\d{2}-\d{2}$/.test(source.game_date));assert.equal(new Date(source.game_date+'T00:00:00Z').toISOString().slice(0,10),source.game_date);
    if(dates.has(r.game_id))assert.equal(dates.get(r.game_id),source.game_date);dates.set(r.game_id,source.game_date);
    assert.deepEqual(Object.keys(r.predictions).sort(),[...MODELS].sort());const ps=MODELS.map(n=>r.predictions[n]);ps.forEach(band);
    const prior=r.groups.prior_sog_same_team;assert(prior===null||typeof prior==='string');
    const cell=[band(ps[0]),source.game_date.slice(0,7),prior];
    const losses=ps.map(p=>{const q=Math.max(1e-12,Math.min(1-1e-12,p));return [(p-r.target)**2,-(r.target*Math.log(q)+(1-r.target)*Math.log1p(-q))];});
    const deltas=METRICS.map((_,m)=>[losses[3][m]-losses[0][m],losses[1][m]-losses[0][m],losses[2][m]-losses[1][m],losses[3][m]-losses[2][m]]);
    for(const [axis,value] of [['overall',null],['cells',cell],['anchor_band',cell[0]],['month',cell[1]],['prior_sog_same_team',cell[2]]]){
      const id=JSON.stringify(value),map=groups[axis];if(!map.has(id))map.set(id,{value,events:0,games:new Set(),sums:[[0,0,0,0],[0,0,0,0]]});
      const e=map.get(id);e.events++;e.games.add(r.game_id);deltas.forEach((v,m)=>v.forEach((x,c)=>e.sums[m][c]+=x));
    }
  }
  return groups;
}
export function verifyPoints(groups,report){
  const overall=groups.overall.get('null'),n=overall.events;assert.equal(report.events,n);assert.equal(report.games,overall.games.size);assert.equal(report.observed_cells,groups.cells.size);
  let comparisons=0,maximumError=0;
  function close(actual,expected){assert(Number.isFinite(actual));const error=Math.abs(actual-expected);maximumError=Math.max(maximumError,error);assert(error<=1e-12,'Point delta drift');comparisons++;}
  function check(e,s){assert.equal(s.events,e.events);assert.equal(s.games,e.games.size);assert.equal(s.support,e.events<100||e.games.size<30?'sparse':'supported_exploratory');
    METRICS.forEach((m,i)=>COMPONENTS.forEach((c,j)=>{close(s.metrics[m][c].mean_delta,e.sums[i][j]/e.events);close(s.metrics[m][c].weighted_contribution,e.sums[i][j]/n);}));
  }
  check(overall,report.overall);
  for(const axis of ['cells','anchor_band','month','prior_sog_same_team']){
    const saved=axis==='cells'?report.cells:report.rollups[axis],map=groups[axis],seen=new Set();assert.equal(saved.length,map.size);
    for(const s of saved){const id=JSON.stringify(axis==='cells'?s.cell:s.value);assert(map.has(id)&&!seen.has(id),'Membership drift');seen.add(id);check(map.get(id),s);}
    assert.equal(saved.reduce((n,s)=>n+s.events,0),n);
    METRICS.forEach(m=>COMPONENTS.forEach(c=>close(saved.reduce((n,s)=>n+s.metrics[m][c].weighted_contribution,0),report.overall.metrics[m][c].mean_delta)));
  }
  for(const map of Object.values(groups))for(const e of map.values())for(const s of e.sums)close(s[0]/e.events,(s[1]+s[2]+s[3])/e.events);
  return {events:n,games:overall.games.size,cells:groups.cells.size,point_comparisons:comparisons,maximum_absolute_error:maximumError};
}
export function review(run,output){
  run=path.resolve(run);output=path.resolve(output);assert.equal(path.dirname(run),RESULTS);assert(path.basename(run).startsWith('forward-shooter-decomposition-'));
  assert.equal(path.dirname(output),RESULTS);assert(path.basename(output).startsWith('forward-shooter-decomposition-review-'));
  const {checked,safe,bytes,read,mapping,recheck}=evidenceReader();safe(run,false);safe(RESULTS,false);assert(!fs.existsSync(output));fs.mkdirSync(output);
  const files={};const save=(name,v)=>{const b=JSON.stringify(v)+'\n';fs.writeFileSync(path.join(output,name),b,{flag:'wx'});files[name]=hash(b);};
  function bind(directory,health){
    assert.equal(health.publishable,false);assert(!fs.existsSync(path.join(directory,'failure.json')));
    assert.deepEqual(inventory(directory).map(p=>path.relative(directory,p)).sort(),[...Object.keys(health.files),'health.json'].sort());
    for(const [name,sha] of Object.entries(health.files)){assert(!path.isAbsolute(name)&&!name.split('/').includes('..'));bytes(path.join(directory,name),sha);}
  }
  try{
    for(const name of ['review_forward_shooter_decomposition.mjs','test_review_forward_shooter_decomposition.mjs','review_forward_shooter_movement.mjs','review_method_challengers.mjs'])bytes(path.join(ROOT,'scripts/proof',name));
    const health=read(path.join(run,'health.json'));assert.equal(health.status,'complete-no-fit-forward-shooter-decomposition');assert.equal(health.production_changed,false);assert.equal(health.fit_performed,false);bind(run,health);
    assert.deepEqual(Object.keys(health.files).sort(),['declaration.json','fold1.json','fold2.json','consumed-file-sha256.json'].sort());
    const declaration=read(path.join(run,'declaration.json'));verifyDeclaration(declaration);bytes(path.join(ROOT,PLAN),PLAN_SHA);mapping(declaration.code_sha256);
    const consumed=read(path.join(run,'consumed-file-sha256.json'));mapping(consumed);
    // Python default JSON separators, sorted flat string-to-string manifest.
    const manifest='{'+Object.keys(consumed).sort().map(k=>JSON.stringify(k)+': '+JSON.stringify(consumed[k])).join(', ')+'}';
    assert.equal(hash(manifest),declaration.source_manifest_sha256);
    const hs={};for(const [name,sha] of Object.entries(PINS)){const dir=path.join(RESULTS,name);hs[name]=read(path.join(dir,'health.json'),sha);bind(dir,hs[name]);}
    const source=path.join(RESULTS,Object.keys(PINS)[0]);
    const reuse=read(path.join(source,'source-reuse.json'));mapping(reuse.checked);
    for(const [folder,names] of Object.entries(reuse.inventories)){const dir=safe(folder,false);assert.deepEqual(inventory(dir).map(p=>path.relative(dir,p)).sort(),[...names].sort());}
    const folds={};for(const fold of ['fold1','fold2']){
      const load=name=>read(path.join(source,fold,name),hs[Object.keys(PINS)[0]].files[fold+'/'+name]);
      folds[fold]=verifyPoints(aggregate(load('predictions.json'),load('validation-identity-inputs.json')),read(path.join(run,fold+'.json')));
    }
    recheck();save('review.json',{publishable:false,folds,checked_files:Object.keys(checked).length,limitations:['Independent saved-shot point arithmetic and cell/rollup conservation only; bootstrap intervals not reproduced.','Raw source actor/date provenance belongs to pinned prior source reviews, not reconstructed here.','Adaptive development diagnostic; no acceptance, refitting or production changes.']});save('checked-file-sha256.json',checked);
    for(const [name,sha] of Object.entries(files))assert.equal(hash(fs.readFileSync(path.join(output,name))),sha);
    save('health.json',{status:'complete-independent-forward-shooter-decomposition-point-review',publishable:false,files:{...files}});return folds;
  }catch(error){save('failure.json',{error:String(error),publishable:false});throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(review(process.argv[2],process.argv[3])));
