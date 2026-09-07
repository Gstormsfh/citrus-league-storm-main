import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const dir='scripts/proof/results/five-calibration-ideas-20260907-v3';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p));
const health=read(dir+'/health.json'),summary=read(dir+'/summary.json');
assert.equal(health.status,'complete-five-calibration-ideas');
for(const [name,sha] of Object.entries(health.files))assert.equal(hash(fs.readFileSync(dir+'/'+name)),sha);
const ideas=read(dir+'/declaration.json').ideas;
const bands=['same_clock','up_to_1s','over_1_under_3s','from_3_to_10s'];
const clip=p=>Math.max(1e-6,Math.min(1-1e-6,p));
const sigmoid=z=>z>=0?1/(1+Math.exp(-z)):Math.exp(z)/(1+Math.exp(z));
const loss=(p,y)=>[(p-y)**2,-y*Math.log(clip(p))-(1-y)*Math.log1p(-clip(p))];
let checked=0,maxError=0;
for(const fold of ['fold1','fold2']){
 const raw=fs.readFileSync(`scripts/proof/results/timing-shape-20260907-full/${fold}-predictions.json`);
 assert.equal(hash(raw),summary.source_sha256[fold]);
 const source=JSON.parse(raw),rows=read(`${dir}/${fold}-predictions.json`),fits=read(`${dir}/${fold}-fits.json`);
 assert.equal(rows.length,source.length);
 const decisions={};
 for(const month of new Set(rows.map(r=>r.game_date.slice(0,7)))){
  const train=source.filter(r=>r.population==='original'&&r.game_date<month+'-01');
  const delta=[0,0];for(const r of train){const a=loss(r.recent_xg,r.target),b=loss(r.shape_xg,r.target);for(let k=0;k<2;k++)delta[k]+=b[k]-a[k];}
  decisions[month]=train.length>0&&delta.every(d=>d<0);
 }
 const index=new Map(fits.map(f=>[f.month+'/'+f.idea,f]));
 for(const f of fits){
  const cutoff=f.month+'-01',start=new Date(Date.parse(cutoff)-90*86400000).toISOString().slice(0,10);
  const train=rows.filter(r=>r.population==='original'&&r.game_date>=start&&r.game_date<cutoff);
  assert.equal(train.length,f.events);assert.equal(new Set(train.map(r=>r.game_id)).size,f.games);
  assert.equal(train.reduce((d,r)=>d===null||r.game_date>d?r.game_date:d,null),f.training_end);
 }
 for(let i=0;i<rows.length;i++){
  const r=rows[i],s=source[i],month=r.game_date.slice(0,7);
  for(const k of ['game_id','event_id','target','population','game_date'])assert.equal(r[k],s[k]);
  assert.equal(r.reference,decisions[month]?s.shape_xg:s.recent_xg);
  const p=clip(r.reference),z=Math.log(p)-Math.log1p(-p);
  for(const idea of ideas){
   const f=index.get(month+'/'+idea),v=f.parameters;
   const x=idea==='rate_offset'?[1]:idea==='temperature'?[z]:idea==='platt'?[1,z]:idea==='beta'?[1,Math.log(p),-Math.log1p(-p)]:[1,...bands.map(b=>+(b===s.band))];
   const expected=f.events<100||f.games<30?r.reference:clip(sigmoid(z+x.reduce((a,b,j)=>a+b*v[j],0)));
   const error=Math.abs(expected-r[idea]);maxError=Math.max(maxError,error);assert.ok(error<1e-12);checked++;
  }
 }
 for(const pop of ['original','recovered','expanded']){
  const sample=rows.filter(r=>pop==='expanded'||r.population===pop);
  for(const idea of ['reference',...ideas]){
   const sums=[0,0];for(const r of sample){const values=loss(r[idea],r.target);for(let k=0;k<2;k++)sums[k]+=values[k];}
   for(const [k,metric] of ['brier','log_loss'].entries())assert.ok(Math.abs(sums[k]/sample.length-summary.folds[fold][pop][idea][metric])<1e-12);
  }
 }
}
const result={checked_predictions:checked,max_probability_error:maxError,all_population_losses_reproduced:true,month_membership_and_reference_verified:true,production_changed:false};
fs.writeFileSync(dir+'/independent-review.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(result);
