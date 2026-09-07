import test from 'node:test';
import assert from 'node:assert/strict';
import {guarded,verifyRows,verifySchema} from './review_recorded_penalty_candidate.mjs';

const primary='recorded_penalty_conditional_shape';
function losses(){return {[primary]:{brier:.05,log_loss_clipped:.2},
  frozen_conditional_shape:{brier:.06,log_loss_clipped:.21},frozen_monotone_group:{brier:.061,log_loss_clipped:.22}};}
test('guard requires both metrics against both controls',()=>{
  assert(guarded(losses()));
  for(const c of ['frozen_conditional_shape','frozen_monotone_group'])for(const m of ['brier','log_loss_clipped']){
    const values=losses();values[c][m]=values[primary][m]-.001;assert.equal(guarded(values),false);
  }
});
function fixture(){
  const plan={features:{unavailable_reasons:['no_recorded_penalty_in_current_period'],append_categorical:[{name:'t1',allowed:[null,'MIN']},{name:'s1',rule:'state'},
    {name:'t2',allowed:[null,'MIN']},{name:'s2',rule:'state'}]}};
  const row={game_id:1,event_id:2,target:0,groups:{strength:null},predictions:{[primary]:.1,recorded_penalty_raw:.09,
    frozen_conditional_shape:.11,frozen_monotone_group:.12}};
  const d={...row,groups:{t1:null,s1:'unavailable:no_recorded_penalty_in_current_period',t2:'MIN',s2:'recorded:type_known:duration_known'}};
  const old={...row,predictions:{conditional_shape:.11,frozen_monotone_group:.12}};
  return {rows:[row],diagnostics:[d],prior:[old],plan};
}
test('exact controls and explicit unknown diagnostics preserved',()=>{const x=fixture();verifyRows(x.rows,x.diagnostics,x.prior,x.plan);});
for(const change of ['control','diagnostic','membership','duplicate','category','unknown_reason'])test('reject '+change,()=>{
  const x=fixture();
  if(change==='control')x.rows[0].predictions.frozen_conditional_shape=.2;
  if(change==='diagnostic')x.diagnostics[0].target=1;
  if(change==='membership')x.prior[0].event_id=3;
  if(change==='duplicate')x.diagnostics.push(x.diagnostics[0]);
  if(change==='category')x.diagnostics[0].groups.t1='OTHER';
  if(change==='unknown_reason')x.diagnostics[0].groups.s1='unavailable:guessed';
  assert.throws(()=>verifyRows(x.rows,x.diagnostics,x.prior,x.plan));
});
test('schema preserves full numeric/categorical names and order',()=>{
  const base={version:'base',names:Array.from({length:47},(_,i)=>'n'+i),categorical_names:['a','b']};
  const plan={features:{base_schema:base,candidate_schema_version:'new',append_numeric:Array.from({length:4},(_,i)=>({name:'p'+i})),
    append_categorical:Array.from({length:4},(_,i)=>({name:'c'+i}))}};
  const schema={...base,version:'new',names:[...base.names,...plan.features.append_numeric.map(r=>r.name)],
    categorical_names:[...base.categorical_names,...plan.features.append_categorical.map(r=>r.name)]};
  const model={design:{schema,numeric_names:schema.names,categorical_names:schema.categorical_names}};
  const receipt={schema,config:{views:{enhanced_numeric_names:schema.names,enhanced_categorical_names:schema.categorical_names}}};
  verifySchema(model,receipt,plan);
  model.design.numeric_names=[...schema.names].reverse();assert.throws(()=>verifySchema(model,receipt,plan));
});
