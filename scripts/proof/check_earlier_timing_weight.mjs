// One declared candidate: closed-form earlier-only Brier-optimal convex blend.
// No weight grid. Require earlier log loss not to worsen; otherwise weight zero.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const source='scripts/proof/results/timing-shape-20260907-full';
const output='scripts/proof/results/earlier-timing-weight-20260907.json';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const healthRaw=fs.readFileSync(source+'/health.json');
assert.equal(hash(healthRaw),'6080f762775b5486d1561bf42935ddcc8b4a62f678a696c960c42474ffeeead5');
const health=JSON.parse(healthRaw);
assert.ok(!fs.existsSync(output));
const ll=(p,y)=>{const q=Math.max(1e-6,Math.min(1-1e-6,p));return -y*Math.log(q)-(1-y)*Math.log1p(-q);};
function weight(rows){
 let numerator=0,denominator=0;
 for(const r of rows){const d=r.shape_xg-r.recent_xg;numerator+=d*(r.target-r.recent_xg);denominator+=d*d;}
 let w=denominator>0?Math.max(0,Math.min(1,numerator/denominator)):0;
 let delta=0;
 for(const r of rows)delta+=ll(r.recent_xg+w*(r.shape_xg-r.recent_xg),r.target)-ll(r.recent_xg,r.target);
 return delta<=0?w:0;
}
assert.equal(weight([]),0);
assert.equal(weight([{recent_xg:.8,shape_xg:.2,target:0}]),1);
assert.equal(weight([{recent_xg:.2,shape_xg:.8,target:0}]),0);
assert.equal(weight([{recent_xg:.2,shape_xg:.2,target:0}]),0);
function score(rows,key){let b=0,l=0;for(const r of rows){b+=(r[key]-r.target)**2;l+=ll(r[key],r.target);}return {brier:b/rows.length,log_loss:l/rows.length};}
const folds={},pins={};
for(const fold of ['fold1','fold2']){
 const raw=fs.readFileSync(`${source}/${fold}-predictions.json`);assert.equal(hash(raw),health.files[`${fold}-predictions.json`]);pins[fold]=hash(raw);
 const rows=JSON.parse(raw),months={},earlier=[],result=[];
 assert.equal(new Set(rows.map(r=>`${r.game_id}/${r.event_id}`)).size,rows.length);
 for(const r of rows){assert.ok([0,1].includes(r.target));for(const f of ['recent_xg','shape_xg'])assert.ok(Number.isFinite(r[f])&&r[f]>=0&&r[f]<=1);}
 for(const month of [...new Set(rows.map(r=>r.game_date.slice(0,7)))].sort()){
  assert.ok(earlier.every(r=>r.population==='original'&&r.game_date<month+'-01'));
  const w=weight(earlier),a=score(earlier,'recent_xg'),b=score(earlier,'shape_xg');
  const hard=earlier.length>0&&b.brier<a.brier&&b.log_loss<a.log_loss;
  const current=rows.filter(r=>r.game_date.slice(0,7)===month);
  months[month]={weight:w,earlier_original_events:earlier.length,training_end:earlier.reduce((d,r)=>d===null||r.game_date>d?r.game_date:d,null)};
  result.push(...current.map(r=>({...r,weighted_xg:r.recent_xg+w*(r.shape_xg-r.recent_xg),selected_xg:hard?r.shape_xg:r.recent_xg})));
  earlier.push(...current.filter(r=>r.population==='original'));
 }
 const report={months};
 for(const population of ['original','recovered','expanded']){
  const sample=result.filter(r=>population==='expanded'||r.population===population);
  report[population]={events:sample.length,...Object.fromEntries(['recent_xg','selected_xg','weighted_xg'].map(f=>[f,score(sample,f)]))};
 }
 report.improves_current=['brier','log_loss'].every(k=>report.original.weighted_xg[k]<report.original.selected_xg[k]);
 folds[fold]=report;
 console.log(JSON.stringify({fold,original:report.original,improves_current:report.improves_current,weights:Object.fromEntries(Object.entries(months).map(([m,v])=>[m,v.weight]))}));
}
fs.writeFileSync(output,JSON.stringify({rule:'Earlier-original closed-form Brier-optimal convex recent/shape weight, clipped [0,1]; zero if earlier log loss worsens.',folds,source_sha256:pins,code_sha256:hash(fs.readFileSync(new URL(import.meta.url))),production_changed:false,model_accepted:false,limitations:['Adaptive historical development, not untouched validation.','Frozen full-feature expert outputs; no new raw-model training.']},null,2)+'\n',{flag:'wx'});
