import {test} from 'node:test';
import assert from 'node:assert/strict';
import {aggregate,band,verifyPoints} from './review_recorded_penalty_decomposition.mjs';

const metrics=['brier','log_loss_clipped'],components=['total','raw','calibration_residual'];
function fixture(){
  const current=[0,1,0,1].map((target,i)=>({game_id:1+Math.floor(i/2),event_id:i,target,groups:{prior_sog_same_team:i%2?'true':null},predictions:{frozen_conditional_shape:i===0?0:.1,recorded_penalty_raw:.2,recorded_penalty_conditional_shape:.15}}));
  const old=current.map(r=>({...r,predictions:{movement_raw:.12,conditional_shape:r.predictions.frozen_conditional_shape}}));
  const diagnostics=current.map(r=>({...r,groups:{recorded_penalty_same_team__annotation_state:'unavailable:no_recorded_penalty',recorded_penalty_opponent__annotation_state:'recorded:type_known:duration_known'}}));
  return {current,old,diagnostics};
}
function report(groups){
  const n=groups.overall.get('null').events;
  const entry=e=>({events:e.events,games:e.games.size,support:'sparse',metrics:Object.fromEntries(metrics.map((m,i)=>[m,Object.fromEntries(components.map((c,j)=>[c,{mean_delta:e.sums[i][j]/e.events,weighted_contribution:e.sums[i][j]/n}]))]))});
  return {events:n,games:groups.overall.get('null').games.size,observed_cells:groups.cells.size,overall:entry(groups.overall.get('null')),cells:[...groups.cells.values()].map(e=>({cell:e.value,...entry(e)})),rollups:Object.fromEntries(['anchor_band','prior_sog_same_team'].map(k=>[k,[...groups[k].values()].map(e=>({value:e.value,...entry(e)}))]))};
}
test('right anchored exact edges and endpoints',()=>{[0,.01,.025,.05,.1,.2,.35,.5,.75,1].forEach((p,i)=>assert.equal(band(p),Math.min(i,8)));for(const p of [null,-1,NaN,Infinity,1.01])assert.throws(()=>band(p));});
test('exact membership independent of input ordering',()=>{const f=fixture(),a=aggregate(f.current,f.diagnostics,f.old),b=aggregate([...f.current].reverse(),f.diagnostics,f.old);const r=report(a);assert.equal(verifyPoints(b,r).events,4);});
test('manual squared loss total raw and residual',()=>{const f=fixture();const g=aggregate([f.current[0]],[f.diagnostics[0]],[f.old[0]]);const s=g.overall.get('null').sums[0];assert(Math.abs(s[0]-.15**2)<1e-15);assert(Math.abs(s[1]-(.2**2-.12**2))<1e-15);assert(Math.abs(s[2]-(s[0]-s[1]))<1e-15);});
for(const mutation of ['duplicate','missing','target','control','groups','diagnostics'])test('reject '+mutation,()=>{const f=fixture();if(mutation==='duplicate')f.current.push(f.current[0]);if(mutation==='missing')f.old.pop();if(mutation==='target')f.old[0].target=1;if(mutation==='control')f.old[0].predictions.conditional_shape=.5;if(mutation==='groups')f.old[0].groups={prior_sog_same_team:'false'};if(mutation==='diagnostics')f.diagnostics[0].predictions={};assert.throws(()=>aggregate(f.current,f.diagnostics,f.old));});
for(const mutation of ['point','rollup','cell','support'])test('reject saved '+mutation+' drift',()=>{const f=fixture(),g=aggregate(f.current,f.diagnostics,f.old),r=report(g);if(mutation==='point')r.overall.metrics.brier.total.mean_delta+=.01;if(mutation==='rollup')r.rollups.anchor_band.pop();if(mutation==='cell')r.cells[0].cell[2]='invented';if(mutation==='support')r.overall.support='supported_exploratory';assert.throws(()=>verifyPoints(g,r));});
