// Independent scalar/gradient/window checks of the completed bounded-prior run.
import fs from 'node:fs';import crypto from 'node:crypto';
const folder=process.argv[2];if(!folder)throw Error('Result folder required');
const read=n=>JSON.parse(fs.readFileSync(folder+'/'+n));const h=read('health.json');
if(h.status!=='complete-bounded-timing-prior-not-accepted'||h.publishable!==false)throw Error('Completed offline result required');
for(const[n,d]of Object.entries(h.files))if(crypto.createHash('sha256').update(fs.readFileSync(folder+'/'+n)).digest('hex')!==d)throw Error('Hash mismatch');
const sigmoid=z=>z>=0?1/(1+Math.exp(-z)):Math.exp(z)/(1+Math.exp(z));
const logit=p=>{p=Math.max(1e-6,Math.min(1-1e-6,p));return Math.log(p)-Math.log1p(-p)};
let events=0,fits=0,maxError=0,maxGradient=0;
for(const fold of ['fold1','fold2']){
 const rows=read(fold+'-predictions.json'),months=new Map();
 for(const name of Object.keys(h.files).filter(n=>n.startsWith(fold+'-')&&n.endsWith('-fit.json'))){
  const fit=read(name);months.set(fit.month,fit);const end=fit.month+'-01';
  const start=new Date(Date.parse(end+'T00:00:00Z')-90*86400000).toISOString().slice(0,10);
  if(start!==fit.start_inclusive||end!==fit.end_exclusive||fit.penalty!=='2*log(cosh(offset/2))')throw Error('Fit declaration mismatch');
  for(const[band,b]of Object.entries(fit.bands)){
   const past=rows.filter(r=>r.population==='original'&&r.band===band&&r.game_date>=start&&r.game_date<end);
   const keys=new Set(past.map(r=>r.game_id+':'+r.event_id));
   if(keys.size!==b.training_keys.length||b.training_keys.some(k=>!keys.has(k.join(':')))||past.length!==b.events||new Set(past.map(r=>r.game_id)).size!==b.games)throw Error('Training membership mismatch');
   if(b.events<30||b.games<10){if(b.offset!==0)throw Error('Sparse fallback mismatch')}
   else{const g=2*sigmoid(b.offset)-1+past.reduce((s,r)=>s+sigmoid(logit(r.neutral_xg)+b.offset)-r.target,0);maxGradient=Math.max(maxGradient,Math.abs(g));if(Math.abs(g)>1e-8)throw Error('Gradient mismatch')}
   fits++;
  }
 }
 const seen=new Set();for(const r of rows){const k=r.game_id+':'+r.event_id;if(seen.has(k))throw Error('Duplicate prediction');seen.add(k);
  const fit=months.get(r.game_date.slice(0,7));if(!fit)throw Error('Missing dated fit');const d=fit.bands[r.band]?.offset??0;
  const p=d===0?r.neutral_xg:Math.max(1e-6,Math.min(1-1e-6,sigmoid(logit(r.neutral_xg)+d)));
  maxError=Math.max(maxError,Math.abs(p-r.bounded_xg));if(Math.abs(p-r.bounded_xg)>1e-12)throw Error('Prediction mismatch');events++;
 }
}
console.log(JSON.stringify({events,bandFits:fits,maxScalarError:maxError,maxGradientResidual:maxGradient,outputHashesVerified:true}));
