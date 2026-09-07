// Independent matched-shot point arithmetic; no fitting, bootstrap or model loading.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const RESULTS=path.join(ROOT,'scripts/proof/results');
const PINS={
  'official-recorded-penalty-20260906-full':'5d07ed08667c8400dc1939c79c3ba65602f3b39bd355c023b354dc9f86178539',
  'official-conditional-shape-20260906-full':'0e395d181d810d1c616a3787633d778c9c0b75e76844304f45001663944f19c7',
  'recorded-penalty-review-20260906-full':'dc4c49ed3563c3297c66ba3265afc81018f7211f617d089041d0dbef83db0e8c'};
const EDGES=[0,.01,.025,.05,.1,.2,.35,.5,.75,1];
const METRICS=['brier','log_loss_clipped'],COMPONENTS=['total','raw','calibration_residual'];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function key(r){assert(Number.isSafeInteger(r.game_id)&&r.game_id>0);assert(Number.isSafeInteger(r.event_id)&&r.event_id>=0);return JSON.stringify([r.game_id,r.event_id]);}
function index(rows){assert(Array.isArray(rows)&&rows.length);const m=new Map();for(const r of rows){const k=key(r);assert(!m.has(k),'Duplicate identity');m.set(k,r);}return m;}
export function band(p){assert(typeof p==='number'&&Number.isFinite(p)&&p>=0&&p<=1);return Math.min(EDGES.filter(e=>e<=p).length-1,EDGES.length-2);}
export function aggregate(current,diagnostics,old){
  const a=index(current),b=index(diagnostics),c=index(old);
  assert.deepEqual([...a.keys()].sort(),[...b.keys()].sort());assert.deepEqual([...a.keys()].sort(),[...c.keys()].sort());
  const groups={overall:new Map(),cells:new Map(),anchor_band:new Map(),prior_sog_same_team:new Map()};
  for(const [k,r] of a){
    const d=b.get(k),o=c.get(k);assert(r.target===0||r.target===1);assert.equal(d.target,r.target);assert.equal(o.target,r.target);
    assert.deepEqual(r.groups,o.groups);assert.deepEqual(r.predictions,d.predictions);
    assert.equal(r.predictions.frozen_conditional_shape,o.predictions.conditional_shape);
    const ps=[o.predictions.movement_raw,o.predictions.conditional_shape,r.predictions.recorded_penalty_raw,r.predictions.recorded_penalty_conditional_shape];
    ps.forEach(band);
    const cell=[band(ps[1]),r.groups.prior_sog_same_team,d.groups.recorded_penalty_same_team__annotation_state,d.groups.recorded_penalty_opponent__annotation_state];
    cell.slice(1).forEach(v=>assert(v===null||typeof v==='string'));
    const losses=ps.map(p=>{const q=Math.max(1e-12,Math.min(1-1e-12,p));return [(p-r.target)**2,-(r.target*Math.log(q)+(1-r.target)*Math.log1p(-q))];});
    const deltas=METRICS.map((_,m)=>{const total=losses[3][m]-losses[1][m],raw=losses[2][m]-losses[0][m];return [total,raw,total-raw];});
    for(const [axis,value] of [['overall',null],['cells',cell],['anchor_band',cell[0]],['prior_sog_same_team',cell[1]]]){
      const id=JSON.stringify(value),map=groups[axis];
      if(!map.has(id))map.set(id,{value,events:0,games:new Set(),sums:[[0,0,0],[0,0,0]]});
      const entry=map.get(id);entry.events++;entry.games.add(r.game_id);deltas.forEach((row,m)=>row.forEach((x,j)=>entry.sums[m][j]+=x));
    }
  }
  return groups;
}
export function verifyPoints(groups,report){
  const overall=groups.overall.get('null'),n=overall.events;assert.equal(report.events,n);assert.equal(report.games,overall.games.size);assert.equal(report.observed_cells,groups.cells.size);
  let comparisons=0,maxError=0;
  const close=(actual,expected)=>{assert(Number.isFinite(actual));const error=Math.abs(actual-expected);maxError=Math.max(maxError,error);assert(error<=1e-12,'Point delta mismatch');comparisons++;};
  const check=(entry,saved)=>{
    assert.equal(saved.events,entry.events);assert.equal(saved.games,entry.games.size);
    assert.equal(saved.support,entry.events<100||entry.games.size<30?'sparse':'supported_exploratory');
    METRICS.forEach((m,mi)=>COMPONENTS.forEach((c,ci)=>{close(saved.metrics[m][c].mean_delta,entry.sums[mi][ci]/entry.events);close(saved.metrics[m][c].weighted_contribution,entry.sums[mi][ci]/n);}));
  };
  check(overall,report.overall);
  for(const axis of ['cells','anchor_band','prior_sog_same_team']){
    const rows=axis==='cells'?report.cells:report.rollups[axis],map=groups[axis];assert.equal(rows.length,map.size);
    const seen=new Set();for(const row of rows){const k=JSON.stringify(axis==='cells'?row.cell:row.value);assert(map.has(k)&&!seen.has(k),'Cell membership drift');seen.add(k);check(map.get(k),row);}
    assert.equal(rows.reduce((s,r)=>s+r.events,0),n);
    METRICS.forEach(m=>COMPONENTS.forEach(c=>close(rows.reduce((s,r)=>s+r.metrics[m][c].weighted_contribution,0),report.overall.metrics[m][c].mean_delta)));
  }
  for(const map of Object.values(groups))for(const e of map.values())for(const sums of e.sums)close(sums[0]/e.events,(sums[1]+sums[2])/e.events);
  return {events:n,games:overall.games.size,cells:groups.cells.size,point_comparisons:comparisons,maximum_absolute_error:maxError};
}
export function review(run,output){
  run=path.resolve(run);output=path.resolve(output);assert.equal(path.dirname(run),RESULTS);assert(path.basename(run).startsWith('recorded-penalty-decomposition-'));
  assert.equal(path.dirname(output),RESULTS);assert(path.basename(output).startsWith('recorded-penalty-decomposition-review-'));
  function safe(p){p=path.resolve(ROOT,p);assert(p.startsWith(ROOT+path.sep));for(let q=p;q!==path.dirname(ROOT);q=path.dirname(q))assert(!fs.lstatSync(q).isSymbolicLink());return p;}
  safe(run);safe(RESULTS);assert(!fs.existsSync(output));fs.mkdirSync(output);
  const checked={},files={};
  function bytes(p,expected){p=safe(p);const raw=fs.readFileSync(p),sha=hash(raw);if(expected)assert.equal(sha,expected,'Evidence hash mismatch');if(checked[p])assert.equal(sha,checked[p]);checked[p]=sha;return raw;}
  const read=(p,expected)=>JSON.parse(bytes(p,expected));
  function save(name,value){const raw=JSON.stringify(value)+'\n';fs.writeFileSync(path.join(output,name),raw,{flag:'wx'});files[name]=hash(raw);}
  try{
    for(const name of ['review_recorded_penalty_decomposition.mjs','test_review_recorded_penalty_decomposition.mjs']){const p=safe(path.join(ROOT,'scripts/proof',name));checked[p]=hash(fs.readFileSync(p));}
    const health=read(path.join(run,'health.json'));assert.equal(health.status,'complete-no-fit-development-decomposition');assert.equal(health.publishable,false);assert(!fs.existsSync(path.join(run,'failure.json')));
    assert.deepEqual(Object.keys(health.files).sort(),['declaration.json','fold1.json','fold2.json','consumed-file-sha256.json'].sort());
    for(const [name,sha] of Object.entries(health.files)){assert.equal(path.basename(name),name);read(path.join(run,name),sha);}
    const declaration=read(path.join(run,'declaration.json'));assert.deepEqual(declaration.pins,PINS);assert.deepEqual(declaration.edges,EDGES);assert.equal(declaration.epsilon,1e-12);
    const consumed=read(path.join(run,'consumed-file-sha256.json'));for(const [p,sha] of Object.entries(consumed))bytes(path.join(ROOT,p),sha);
    const hs={};for(const [name,sha] of Object.entries(PINS))hs[name]=read(path.join(RESULTS,name,'health.json'),sha);
    const folds={};for(const fold of ['fold1','fold2']){
      const load=(name,file)=>read(path.join(RESULTS,name,fold,file),hs[name].files[fold+'/'+file]);
      const current=load(Object.keys(PINS)[0],'predictions.json'),diag=load(Object.keys(PINS)[0],'penalty-diagnostic-predictions.json'),old=load(Object.keys(PINS)[1],'predictions.json');
      folds[fold]=verifyPoints(aggregate(current,diag,old),read(path.join(run,fold+'.json')));
    }
    for(const [p,sha] of Object.entries(checked))assert.equal(hash(fs.readFileSync(safe(p))),sha);
    save('review.json',{publishable:false,folds,checked_files:Object.keys(checked).length,limitations:['Point arithmetic only; bootstrap intervals not reproduced.','Membership independently reconstructed from frozen saved predictions, not raw event sources.','Adaptive development diagnostics; no accuracy acceptance or production changes.']});
    save('checked-file-sha256.json',checked);
    for(const [name,sha] of Object.entries(files))assert.equal(hash(fs.readFileSync(path.join(output,name))),sha);
    save('health.json',{status:'complete-independent-decomposition-point-review',publishable:false,files:{...files}});
    return folds;
  }catch(error){save('failure.json',{error:String(error),publishable:false});throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(review(process.argv[2],process.argv[3])));
