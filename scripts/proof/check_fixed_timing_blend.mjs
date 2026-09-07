// One declared 50/50 probability blend. No search, fit, or production writes.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const source='scripts/proof/results/timing-shape-20260907-full';
const expected='6080f762775b5486d1561bf42935ddcc8b4a62f678a696c960c42474ffeeead5';
const output='scripts/proof/results/fixed-timing-blend-20260907.json';
const declaration={weight:.5,comparison:'recent_xg',candidate:'(recent_xg+shape_xg)/2',
  fitting:false,parameter_search:false,prospective:false,production_changed:false,accepted:false};
assert.ok(!fs.existsSync(output),'Create-only result required');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const healthBytes=fs.readFileSync(source+'/health.json');assert.equal(hash(healthBytes),expected);
const health=JSON.parse(healthBytes);assert.equal(health.status,'complete-timing-shape-development-not-accepted');
const pins={};
const read=name=>{const raw=fs.readFileSync(source+'/'+name);assert.equal(hash(raw),health.files[name]);pins[name]=hash(raw);return JSON.parse(raw);};
function score(rows){
  let b0=0,b1=0,l0=0,l1=0,g=0,x0=0,x1=0,unchanged=0;
  for(const r of rows){
    const a=r.recent_xg,b=r.shape_xg,y=r.target,p=(a+b)/2;
    assert.ok([a,b].every(x=>Number.isFinite(x)&&x>=0&&x<=1));assert.ok(y===0||y===1);
    const loss=x=>{const q=Math.min(1-1e-6,Math.max(1e-6,x));return -y*Math.log(q)-(1-y)*Math.log1p(-q);};
    // Independent algebraic check of the averaged-probability Brier result.
    assert.ok(Math.abs((p-y)**2-(((a-y)**2+(b-y)**2)/2-(a-b)**2/4))<1e-12);
    b0+=(a-y)**2;b1+=(p-y)**2;l0+=loss(a);l1+=loss(p);g+=y;x0+=a;x1+=p;unchanged+=Number(p===a);
  }
  const n=rows.length;
  return {events:n,goals:g,unchanged,reference:{brier:n?b0/n:null,log_loss:n?l0/n:null,xg:x0},
    blend:{brier:n?b1/n:null,log_loss:n?l1/n:null,xg:x1}};
}
const folds={};
for(const fold of ['fold1','fold2']){
  const rows=read(fold+'-predictions.json');const keys=new Set(rows.map(r=>`${r.game_id}/${r.event_id}`));assert.equal(keys.size,rows.length);
  const report={};for(const pop of ['original','recovered','expanded'])report[pop]=score(rows.filter(r=>pop==='expanded'||r.population===pop));
  report.months=Object.fromEntries([...new Set(rows.map(r=>r.game_date.slice(0,7)))].sort().map(m=>[m,score(rows.filter(r=>r.game_date.slice(0,7)===m))]));
  report.bands=Object.fromEntries([...new Set(rows.map(r=>r.band))].map(b=>[String(b),score(rows.filter(r=>r.band===b))]));
  report.point_guard=['brier','log_loss'].every(k=>report.original.blend[k]<=report.original.reference[k]);
  folds[fold]=report;console.log(JSON.stringify({fold,original:report.original,point_guard:report.point_guard}));
}
const result={declaration,source_health_sha256:expected,source_prediction_sha256:pins,
  code_sha256:hash(fs.readFileSync(new URL(import.meta.url))),folds,
  both_original_point_guards:Object.values(folds).every(f=>f.point_guard),
  limitations:['Adaptively inspected historical folds; not an untouched test.',
    'Immediate source hashes checked; upstream source reconstruction not rerun.',
    'No new full-vector inference packaging, uncertainty interval, or production validation.']};
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
