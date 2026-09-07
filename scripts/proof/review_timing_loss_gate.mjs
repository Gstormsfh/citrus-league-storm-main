// Separate deterministic past-window and routing check; no fitting or writes.
import fs from 'node:fs';
import crypto from 'node:crypto';
const root=process.argv[2];if(!root)throw Error('Result directory required');
const read=n=>JSON.parse(fs.readFileSync(root+'/'+n));
const health=read('health.json');
if(health.status!=='complete-timing-loss-gate-comparison-not-accepted'||health.publishable!==false)throw Error('Completed offline result required');
for(const[n,d]of Object.entries(health.files))if(crypto.createHash('sha256').update(fs.readFileSync(root+'/'+n)).digest('hex')!==d)throw Error('Hash mismatch');
const loss=(rows,key)=>{
 let b=0,l=0;for(const r of rows){const p=r[key],y=r.target,q=Math.max(1e-6,Math.min(1-1e-6,p));b+=(p-y)**2;l+=-y*Math.log(q)-(1-y)*Math.log1p(-q)}
 return {brier:b/rows.length,log_loss:l/rows.length};
};
let count=0,checks=0,active=0;
for(const fold of ['fold1','fold2']){
 const rows=read(fold+'-predictions.json'),gates=read(fold+'-gates.json'),byMonth=new Map();
 for(const gate of gates){
  const end=gate.month+'-01',start=new Date(Date.parse(end+'T00:00:00Z')-90*86400000).toISOString().slice(0,10);
  if(start!==gate.start_inclusive||end!==gate.end_exclusive)throw Error('Window mismatch');
  for(const[band,decision]of Object.entries(gate.bands)){
   const past=rows.filter(r=>r.population==='original'&&r.band===band&&r.game_date>=start&&r.game_date<end);
   const keys=new Set(past.map(r=>r.game_id+':'+r.event_id)),games=new Set(past.map(r=>r.game_id));
   if(keys.size!==decision.prior_keys.length||decision.prior_keys.some(k=>!keys.has(k.join(':')))||past.length!==decision.events||games.size!==decision.games)throw Error('Past membership mismatch');
   const c=loss(past,'neutral_xg'),s=loss(past,'recent_xg');
   const enabled=past.length>=30&&games.size>=10&&s.brier<c.brier&&s.log_loss<c.log_loss;
   if(enabled!==decision.active)throw Error('Decision mismatch');
   checks++;active+=Number(enabled);
  }
  byMonth.set(gate.month,gate);
 }
 for(const r of rows){const gate=byMonth.get(r.game_date.slice(0,7));if(!gate)throw Error('Missing gate');
  const expected=gate.bands[r.band]?.active?r.recent_xg:r.neutral_xg;if(expected!==r.gated_xg)throw Error('Routing mismatch');count++}
}
console.log(JSON.stringify({predictionsVerified:count,bandDecisionsVerified:checks,activeBandDecisions:active,outputHashesVerified:true}));
