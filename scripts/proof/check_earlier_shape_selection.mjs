// Declared before evaluation: cumulative earlier ORIGINAL out-of-sample losses
// must both strictly improve to select the current month's shape calibrator.
// Otherwise preserve recent_xg exactly. No window/threshold/weight search.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const dir='scripts/proof/results/timing-shape-20260907-full';
const out='scripts/proof/results/earlier-shape-selection-20260907.json';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const h=fs.readFileSync(dir+'/health.json');
assert.equal(hash(h),'6080f762775b5486d1561bf42935ddcc8b4a62f678a696c960c42474ffeeead5');
const health=JSON.parse(h);assert.ok(!fs.existsSync(out));
const loss=(p,y)=>{assert.ok(Number.isFinite(p)&&p>=0&&p<=1&&(y===0||y===1));const q=Math.min(1-1e-6,Math.max(1e-6,p));return [(p-y)**2,-y*Math.log(q)-(1-y)*Math.log1p(-q)];};
const choose=h=>h.n>0&&h.shape[0]<h.reference[0]&&h.shape[1]<h.reference[1];
assert.equal(choose({n:10,shape:[1,2],reference:[2,3]}),true);
assert.equal(choose({n:10,shape:[1,4],reference:[2,3]}),false);
assert.equal(choose({n:0,shape:[0,0],reference:[0,0]}),false);
function scores(rows){
 const result={events:rows.length};
 for(const field of ['recent_xg','selected_xg']){const sums=[0,0];for(const r of rows){const l=loss(r[field],r.target);sums[0]+=l[0];sums[1]+=l[1];}result[field]={brier:sums[0]/rows.length,log_loss:sums[1]/rows.length};}
 return result;
}
const folds={},pins={};
for(const fold of ['fold1','fold2']){
 const name=fold+'-predictions.json',raw=fs.readFileSync(dir+'/'+name);assert.equal(hash(raw),health.files[name]);pins[name]=hash(raw);
 const rows=JSON.parse(raw);assert.equal(new Set(rows.map(r=>`${r.game_id}/${r.event_id}`)).size,rows.length);
 const history={n:0,reference:[0,0],shape:[0,0]},months={},result=[];let latest=null;
 for(const month of [...new Set(rows.map(r=>r.game_date.slice(0,7)))].sort()){
  const useShape=choose(history);assert.ok(latest===null||latest<month+'-01');
  const selected=rows.filter(r=>r.game_date.slice(0,7)===month);
  months[month]={use_shape:useShape,earlier_original_events:history.n,training_end:latest,earlier_losses:structuredClone(history)};
  // Lock this month's decision BEFORE admitting any of its outcomes.
  result.push(...selected.map(r=>({...r,selected_xg:useShape?r.shape_xg:r.recent_xg})));
  for(const r of selected.filter(r=>r.population==='original')){
   const a=loss(r.recent_xg,r.target),b=loss(r.shape_xg,r.target);
   history.n++;for(let i=0;i<2;i++){history.reference[i]+=a[i];history.shape[i]+=b[i];}
   latest=latest===null||r.game_date>latest?r.game_date:latest;
  }
 }
 const report={months};for(const pop of ['original','recovered','expanded'])report[pop]=scores(result.filter(r=>pop==='expanded'||r.population===pop));
 report.point_guard=['brier','log_loss'].every(k=>report.original.selected_xg[k]<=report.original.recent_xg[k]);
 folds[fold]=report;console.log(JSON.stringify({fold,point_guard:report.point_guard,original:report.original,shape_months:Object.entries(months).filter(([,v])=>v.use_shape).map(([m])=>m)}));
}
fs.writeFileSync(out,JSON.stringify({rule:'Select shape iff cumulative earlier original prequential Brier AND log loss are strictly lower; otherwise recent reference.',folds,prediction_sha256:pins,code_sha256:hash(fs.readFileSync(new URL(import.meta.url))),model_accepted:false,production_changed:false,limitations:['Adaptively inspected retrospective development, not untouched validation.','No full-vector package or production deployment; selection rule alone is not acceptance.']},null,2)+'\n',{flag:'wx'});
