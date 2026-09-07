import test from 'node:test';
import assert from 'node:assert/strict';
import {statistics,auditCard} from './review_method_challengers.mjs';

test('independent exact endpoints, games and right-open bins',()=>{
  const rows=[{game_id:1,target:0,predictions:{a:0}},
    {game_id:1,target:1,predictions:{a:.01}},{game_id:2,target:1,predictions:{a:1}}];
  const x=statistics(rows,'a');
  assert.equal(x.events,3);assert.equal(x.games,2);assert.equal(x.goals,2);
  assert.equal(x.brier,.99**2/3);
  assert.ok(Math.abs(x.log_loss_clipped-(-2*Math.log(1-1e-12)-Math.log(.01))/3)<1e-14);
  assert.equal(x.reliability[0].events,1);assert.equal(x.reliability[1].events,1);
  assert.equal(x.reliability[8].events,1);assert.equal(x.reliability[2].mean_prediction,null);
  assert.equal(x.clipped_prediction_count,2);assert.equal(x.impossible_observation_count,0);
});
test('wrong bins fail before accepting statistics',()=>{
  assert.throws(()=>auditCard([{game_id:1}],{config:{bin_edges:[0,1]}}));
});
