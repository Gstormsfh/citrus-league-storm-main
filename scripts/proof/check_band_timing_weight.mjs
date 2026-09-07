// Structural alternative declared before evaluation: fit each timing band's
// convex expert weight separately using earlier original outcomes only.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const dir='scripts/proof/results/timing-shape-20260907-full';
const output='scripts/proof/results/band-timing-weight-20260907.json';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const rawHealth=fs.readFileSync(dir+'/health.json');
assert.equal(hash(rawHealth),'6080f762775b5486d1561bf42935ddcc8b4a62f678a696c960c42474ffeeead5');
const health=JSON.parse(rawHealth),folds={},pins={};assert.ok(!fs.existsSync(output));
const bands=['same_clock','up_to_1s','over_1_under_3s','from_3_to_10s'];
const loss=(p,y)=>{const q=Math.min(1-1e-6,Math.max(1e-6,p));return -y*Math.log(q)-(1-y)*Math.log1p(-q);};
function weight(rows){
 if(rows.length<30||new Set(rows.map(r=>r.game_id)).size<10)return 0;
 let num=0,den=0;for(const r of rows){const d=r.shape_xg-r.recent_xg;num+=d*(r.target-r.recent_xg);den+=d*d;}
 const w=den>0?Math.max(0,Math.min(1,num/den)):0;
 return rows.reduce((s,r)=>s+loss(r.recent_xg+w*(r.shape_xg-r.recent_xg),r.target)-loss(r.recent_xg,r.target),0)<=0?w:0;
}
function score(rows,f){return {brier:rows.reduce((s,r)=>s+(r[f]-r.target)**2,0)/rows.length,log_loss:rows.reduce((s,r)=>s+loss(r[f],r.target),0)/rows.length};}
assert.equal(weight([]),0);
assert.equal(weight(Array.from({length:30},(_,i)=>({game_id:i,recent_xg:.8,shape_xg:.2,target:0}))),1);
for(const fold of ['fold1','fold2']){
 const raw=fs.readFileSync(`${dir}/${fold}-predictions.json`);assert.equal(hash(raw),health.files[`${fold}-predictions.json`]);pins[fold]=hash(raw);
 const rows=JSON.parse(raw),earlier=[],result=[],months={};
 assert.equal(new Set(rows.map(r=>`${r.game_id}/${r.event_id}`)).size,rows.length);
 for(const month of [...new Set(rows.map(r=>r.game_date.slice(0,7)))].sort()){
  assert.ok(earlier.every(r=>r.population==='original'&&r.game_date<month+'-01'));
  const weights=Object.fromEntries(bands.map(b=>[b,weight(earlier.filter(r=>r.band===b))]));
  const a=score(earlier,'recent_xg'),b=score(earlier,'shape_xg'),hard=earlier.length>0&&b.brier<a.brier&&b.log_loss<a.log_loss;
  months[month]={weights,earlier_original_events:earlier.length};
  const current=rows.filter(r=>r.game_date.slice(0,7)===month);
  result.push(...current.map(r=>({...r,weighted_xg:r.recent_xg+(weights[r.band]??0)*(r.shape_xg-r.recent_xg),selected_xg:hard?r.shape_xg:r.recent_xg})));
  earlier.push(...current.filter(r=>r.population==='original'));
 }
 const report={months};for(const pop of ['original','recovered','expanded']){const sample=result.filter(r=>pop==='expanded'||r.population===pop);report[pop]={events:sample.length,...Object.fromEntries(['recent_xg','selected_xg','weighted_xg'].map(f=>[f,score(sample,f)]))};}
 report.improves_current=['brier','log_loss'].every(k=>report.original.weighted_xg[k]<report.original.selected_xg[k]);folds[fold]=report;
 console.log(JSON.stringify({fold,original:report.original,improves_current:report.improves_current}));
}
fs.writeFileSync(output,JSON.stringify({rule:'Per timing band, earlier-original Brier-optimal convex weight, clipped [0,1], min 30 events/10 games; zero if earlier log loss worsens.',folds,source_sha256:pins,code_sha256:hash(fs.readFileSync(new URL(import.meta.url))),production_changed:false,model_accepted:false,limitations:['Adaptive historical development, not untouched validation.','No new raw-model fitting or production deployment.']},null,2)+'\n',{flag:'wx'});
