// Independent scalar review of fit membership, constrained gradients and replay.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const dir='scripts/proof/results/timing-shape-20260907-full';
const source='scripts/proof/results/recent-timing-experiment-20260907-full';
const read=p=>JSON.parse(fs.readFileSync(p));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const key=r=>`${r.game_id}/${r.event_id}`;
const clip=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
const logit=p=>{const q=clip(p,1e-6,1-1e-6);return Math.log(q)-Math.log1p(-q);};
const sigmoid=z=>z>=0?1/(1+Math.exp(-z)):Math.exp(z)/(1+Math.exp(z));
const health=read(dir+'/health.json');
assert.equal(health.status,'complete-timing-shape-development-not-accepted');
for(const [n,s] of Object.entries(health.files))assert.equal(sha(dir+'/'+n),s);
let events=0, fits=0, maxError=0, maxGradient=0;
for(const fold of ['fold1','fold2']){
  const original=read(`${source}/${fold}-predictions.json`), output=read(`${dir}/${fold}-predictions.json`);
  const index=new Map(original.map(r=>[key(r),r]));const seen=new Set();
  for(const month of [...new Set(original.map(r=>r.game_date.slice(0,7)))]){
    const fit=read(`${dir}/${fold}-${month}-fit.json`);
    assert.equal(fit.end_exclusive,month+'-01');
    const start=new Date(month+'-01T00:00:00Z');start.setUTCDate(start.getUTCDate()-90);
    assert.equal(fit.start_inclusive,start.toISOString().slice(0,10));
    for(const [band,b] of Object.entries(fit.bands)){
      const train=original.filter(r=>r.population==='original'&&r.band===band&&r.game_date>=fit.start_inclusive&&r.game_date<fit.end_exclusive);
      assert.deepEqual(b.training_keys.map(k=>k.join('/')).sort(),train.map(key).sort());
      assert.equal(b.events,train.length);assert.equal(b.games,new Set(train.map(r=>r.game_id)).size);
      const mean=train.length?train.reduce((s,r)=>s+logit(r.neutral_xg),0)/train.length:0;
      assert.ok(Math.abs(mean-b.mean_logit)<1e-12);
      if(b.events<30||b.games<10){assert.equal(b.intercept,0);assert.equal(b.slope_delta,0);}
      else{
        let g0=10*b.intercept,g1=10*b.slope_delta;
        for(const r of train){const z=logit(r.neutral_xg),x=z-b.mean_logit;
          const residual=sigmoid(z+b.intercept+b.slope_delta*x)-r.target;g0+=residual;g1+=residual*x;}
        maxGradient=Math.max(maxGradient,Math.abs(b.intercept-clip(b.intercept-g0,-10,10)),Math.abs(b.slope_delta-clip(b.slope_delta-g1,-.75,3)));
      }
      fits++;
    }
    for(const p of output.filter(r=>r.game_date.slice(0,7)===month)){
      assert.ok(!seen.has(key(p)));seen.add(key(p));const r=index.get(key(p));assert.ok(r);
      for(const field of ['neutral_xg','recent_xg','target','band','population','game_date'])assert.equal(p[field],r[field]);
      const b=fit.bands[r.band];let q=r.neutral_xg;
      if(b&&(b.intercept!==0||b.slope_delta!==0)){const z=logit(q);q=clip(sigmoid(z+b.intercept+b.slope_delta*(z-b.mean_logit)),1e-6,1-1e-6);}
      maxError=Math.max(maxError,Math.abs(q-p.shape_xg));events++;
    }
  }
  assert.equal(seen.size,index.size);
}
assert.ok(maxError<1e-12);assert.ok(maxGradient<1e-5);
console.log(JSON.stringify({verified:true,events,bandFits:fits,maxProbabilityError:maxError,maxProjectedGradient:maxGradient,healthSha256:sha(dir+'/health.json')}));
