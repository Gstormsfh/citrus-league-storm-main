// Separate scalar replay and training-window/gradient check. No fitting or writes.
import fs from 'node:fs';
import crypto from 'node:crypto';
const folder=process.argv[2];
if(!folder)throw Error('Result folder required');
const read=n=>JSON.parse(fs.readFileSync(folder+'/'+n));
const sha=n=>crypto.createHash('sha256').update(fs.readFileSync(folder+'/'+n)).digest('hex');
const h=read('health.json');
if(h.status!=='complete-recent-timing-experiment-not-accepted'||h.publishable!==false)throw Error('Completed offline experiment required');
for(const[n,d]of Object.entries(h.files))if(sha(n)!==d)throw Error('Output drift: '+n);
const sigmoid=z=>z>=0?1/(1+Math.exp(-z)):Math.exp(z)/(1+Math.exp(z));
const logit=p=>{p=Math.max(1e-6,Math.min(1-1e-6,p));return Math.log(p)-Math.log1p(-p)};
let events=0,fits=0,maxError=0,maxGradient=0,unchanged=0;
for(const fold of ['fold1','fold2']){
 const rows=read(fold+'-predictions.json'), original=rows.filter(r=>r.population==='original');
 const seen=new Set(), fitCache=new Map();
 for(const name of Object.keys(h.files).filter(n=>n.startsWith(fold+'-')&&n.endsWith('-fit.json'))){
  const fit=read(name);fitCache.set(fit.month,fit);
  for(const[band,b]of Object.entries(fit.bands)){
   const training=original.filter(r=>r.game_date>=fit.start_inclusive&&r.game_date<fit.end_exclusive&&r.band===band);
   const expected=new Set(training.map(r=>r.game_id+':'+r.event_id));
   if(expected.size!==b.training_keys.length||b.training_keys.some(k=>!expected.has(k.join(':'))))throw Error('Training membership mismatch');
   if(training.length!==b.events||new Set(training.map(r=>r.game_id)).size!==b.games)throw Error('Support mismatch');
   if(b.events<30||b.games<10){if(b.offset!==0)throw Error('Sparse fallback changed')}
   else {const g=10*b.offset+training.reduce((s,r)=>s+sigmoid(logit(r.neutral_xg)+b.offset)-r.target,0);maxGradient=Math.max(maxGradient,Math.abs(g));if(Math.abs(g)>1e-8)throw Error('Optimizer gradient mismatch')}
   fits++;
  }
 }
 for(const r of rows){
  const key=r.game_id+':'+r.event_id;if(seen.has(key))throw Error('Duplicate prediction');seen.add(key);
  const fit=fitCache.get(r.game_date.slice(0,7));if(!fit)throw Error('Missing dated fit');
  const o=fit.bands[r.band]?.offset??0;
  const q=o===0?r.neutral_xg:Math.max(1e-6,Math.min(1-1e-6,sigmoid(logit(r.neutral_xg)+o)));
  const error=Math.abs(q-r.recent_xg);maxError=Math.max(maxError,error);if(error>1e-12)throw Error('Scalar mismatch');
  if(o===0){if(r.recent_xg!==r.neutral_xg)throw Error('Unchanged control mismatch');unchanged++}
  events++;
 }
}
console.log(JSON.stringify({events,bandFits:fits,unchangedPredictions:unchanged,maxScalarError:maxError,maxGradientResidual:maxGradient,outputHashesVerified:true}));
