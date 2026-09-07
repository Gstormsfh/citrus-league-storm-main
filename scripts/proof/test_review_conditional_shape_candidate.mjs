import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {MODELS,parseArgs,verifyBaseline,reviewFold,primaryGuard} from './review_conditional_shape_candidate.mjs';
import {statistics} from './review_method_challengers.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const BINS=[0,.01,.025,.05,.1,.2,.35,.5,.75,1];
const value=x=>({value:x});

test('primary guard independently requires both metrics against both controls',()=>{
  const overall=Object.fromEntries(['conditional_shape','frozen_monotone_group','frozen_movement_monotone_group'].map(n=>[n,{brier:.06,log_loss_clipped:.22}]));
  assert.equal(primaryGuard(overall),true);
  for(const control of ['frozen_monotone_group','frozen_movement_monotone_group'])for(const metric of ['brier','log_loss_clipped']){
    const changed=structuredClone(overall);changed[control][metric]-=.001;
    assert.equal(primaryGuard(changed),false);
  }
});
function fixture(){
  const rows=[0,1,0].map((target,i)=>({game_id:i===2?2:1,event_id:i+1,target,
    groups:{strength:i===2?null:'5v5'},predictions:{frozen_monotone_group:.5,frozen_movement_monotone_group:.4,
      movement_raw:target?.8:.2,conditional_shape:target?.75:.25}}));
  const prior=rows.map(r=>({...r,predictions:{monotone_logit_group:r.predictions.frozen_monotone_group}}));
  const movementPrior=rows.map(r=>({...r,predictions:{movement_raw:r.predictions.movement_raw,movement_monotone_group:r.predictions.frozen_movement_monotone_group}}));
  function block(rr){
    const ss=Object.fromEntries(MODELS.map(n=>[n,statistics(rr,n)]));
    const first=ss[MODELS[0]];
    return {events:first.events,games:first.games,goals:first.goals,
      models:Object.fromEntries(MODELS.map(n=>{const s=ss[n];return [n,{
        expected_goals:s.expected_goals,clipped_prediction_count:s.clipped_prediction_count,
        impossible_observation_count:s.impossible_observation_count,
        metrics:Object.fromEntries(['brier','log_loss_clipped','mean_prediction','observed_rate','observed_minus_expected_rate'].map(m=>[m,value(s[m])])),
        reliability:s.reliability.map(b=>({...b,mean_prediction:value(b.mean_prediction),observed_rate:value(b.observed_rate),gap:value(b.gap)})),
      }];})),
      paired_differences:MODELS.flatMap((left,i)=>MODELS.slice(i+1).map(right=>({left,right,direction:'left_minus_right',
        metrics:Object.fromEntries(['brier','log_loss_clipped'].map(m=>[m,value(ss[left][m]-ss[right][m])]))}))),
    };
  }
  const card={contract:'citrus-probability-scorecard-v1',status:'measured_not_model_acceptance',publishable:false,
    config:{bin_edges:BINS,log_loss_epsilon:1e-12},overall:block(rows),
    subgroups:['5v5',null].map(v=>({dimension:'strength',value:v,statistics:block(rows.filter(r=>r.groups.strength===v))}))};
  return {rows,prior,card,movementPrior};
}

test('review independently reconciles points, bins, subgroups and frozen identity',()=>{
  const {rows,prior,card,movementPrior}=fixture(),r=reviewFold(rows,card,prior,movementPrior);
  assert.equal(r.events,3);assert.equal(r.subgroups.length,2);assert.equal(r.primary_guard_passed,true);
  assert.equal(r.overall.conditional_shape.brier,.0625);
  assert.equal(r.overall.frozen_monotone_group.brier,.25);
  assert(r.point_comparisons>0);assert.equal(r.maximum_absolute_error,0);
});

for(const [name,mutate] of [
  ['changed movement probability',x=>{x.rows[0].predictions.frozen_movement_monotone_group=.9;}],
  ['changed raw movement probability',x=>{x.rows[0].predictions.movement_raw=.9;}],
  ['missing movement event',x=>{x.movementPrior.pop();}],
  ['changed target',x=>{x.rows[0].target=1;}],
  ['changed group',x=>{x.rows[0].groups={strength:'PP'};}],
  ['changed baseline score',x=>{x.rows[0].predictions.frozen_monotone_group=.6;}],
  ['missing candidate',x=>{delete x.rows[0].predictions.movement_raw;}],
  ['extra candidate',x=>{x.rows[0].predictions.cherry_picked=.1;}],
  ['duplicate candidate event',x=>{x.rows[1].event_id=x.rows[0].event_id;}],
  ['duplicate baseline event',x=>{x.prior[1].event_id=x.prior[0].event_id;}],
  ['missing event',x=>{x.rows.pop();}],
])test('baseline guard rejects '+name,()=>{const x=fixture();mutate(x);assert.throws(()=>verifyBaseline(x.rows,x.prior,x.movementPrior));});

for(const [name,mutate] of [
  ['overall loss',x=>{x.card.overall.models.movement_raw.metrics.brier.value+=.01;}],
  ['bin population',x=>{x.card.overall.models.movement_raw.reliability[0].events+=1;}],
  ['subgroup loss',x=>{x.card.subgroups[0].statistics.models.movement_raw.metrics.brier.value+=.01;}],
  ['paired difference',x=>{x.card.overall.paired_differences[0].metrics.brier.value+=.01;}],
  ['missing subgroup',x=>{x.card.subgroups.pop();}],
])test('arithmetic guard rejects changed '+name,()=>{const x=fixture();mutate(x);assert.throws(()=>reviewFold(x.rows,x.card,x.prior,x.movementPrior));});

test('argument contract requires separate scoped run and create-only output locations',()=>{
  const results=path.join(ROOT,'scripts/proof/results'),run=path.join(results,'official-conditional-shape-test'),
    output=path.join(results,'conditional-shape-candidate-review-test');
  assert.deepEqual(parseArgs(['--run',run,'--output',output]),{run,output});
  assert.throws(()=>parseArgs(['--run',run]));
  assert.throws(()=>parseArgs(['--output',output,'--run',run]));
  assert.throws(()=>parseArgs(['--run','/tmp/official-conditional-shape-test','--output',output]));
  assert.throws(()=>parseArgs(['--run',run,'--output',path.join(run,'conditional-shape-candidate-review-test')]));
});
