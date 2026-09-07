// Independent rank-based AUC, Pearson correlation and proper scoring rules.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const dir='scripts/proof/results/refresh-ensemble-20260907';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p));
const health=read(dir+'/health.json'),summary=read(dir+'/summary.json');
for(const [name,sha] of Object.entries(health.files))assert.equal(hash(fs.readFileSync(dir+'/'+name)),sha);
const refreshed='scripts/proof/results/bounded-xg-refresh-20260907';
assert.equal(hash(fs.readFileSync(refreshed+'/health.json')),summary.source_health_sha256);
const sourceHealth=read(refreshed+'/health.json');
let checked=0;const reports={};
for(const fold of ['fold1','fold2']){
 const raw=fs.readFileSync(`${refreshed}/${fold}-predictions.json`);assert.equal(hash(raw),sourceHealth.files[`${fold}-predictions.json`]);
 const source=JSON.parse(raw),rows=read(`${dir}/${fold}-predictions.json`);assert.equal(rows.length,source.length);
 const result={};
 for(const field of ['reference','original_geometry','symmetric_geometry']){
  let sy=0,sp=0,sp2=0,spy=0,brier=0,ll=0;
  for(let i=0;i<rows.length;i++){
   const r=rows[i],s=source[i];for(const k of ['game_id','event_id','game_date','target','reference'])assert.equal(r[k],s[k]);
   const p=r[field],y=r.target;assert.ok(Number.isFinite(p)&&p>=0&&p<=1&&(y===0||y===1));
   if(field!=='reference')assert.equal(p,(s.reference+s[field+'_timing'])/2);
   sy+=y;sp+=p;sp2+=p*p;spy+=p*y;brier+=(p-y)**2;
   const q=Math.min(1-1e-6,Math.max(1e-6,p));ll+=-y*Math.log(q)-(1-y)*Math.log1p(-q);
  }
  const ordered=[...rows].sort((a,b)=>a[field]-b[field]);let ranks=0;
  for(let i=0;i<ordered.length;){let j=i+1;while(j<ordered.length&&ordered[j][field]===ordered[i][field])j++;
   for(let k=i;k<j;k++)if(ordered[k].target)ranks+=(i+1+j)/2;i=j;}
  const n=rows.length;result[field]={auc:(ranks-sy*(sy+1)/2)/(sy*(n-sy)),brier:brier/n,
   correlation:(spy-sp*sy/n)/Math.sqrt((sp2-sp*sp/n)*(sy-sy*sy/n)),log_loss:ll/n};
  for(const [k,v]of Object.entries(result[field]))assert.ok(Math.abs(v-summary.folds[fold][field][k])<1e-11,`${fold}/${field}/${k}`);
 }
 checked+=rows.length;reports[fold]=result;
}
fs.writeFileSync(dir+'/independent-review.json',JSON.stringify({checked_events:checked,metrics:reports,source_and_prediction_hashes_verified:true},null,2)+'\n',{flag:'wx'});
console.log({checked_events:checked,independent_auc_brier_correlation_logloss:'passed',exact_ensemble_arithmetic:'passed'});
