import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {guard,verifyRows,verifyChronology,verifyIdentity,verifySplit,evidenceReader} from './review_forward_shooter_movement.mjs';
function rows(){return [{game_id:2022020001,event_id:1,target:0,groups:{prior_sog_same_team:null},predictions:{new_neutral:.1,global_control:.11,shooter:.12,frozen_conditional_shape:.13}}];}
function prior(r){return r.map(x=>({...x,predictions:{conditional_shape:x.predictions.frozen_conditional_shape}}));}
test('exact frozen comparator join',()=>{const r=rows();verifyRows(r,prior(r));});
for(const mode of ['duplicate','target','group','comparator','missing_output','endpoint'])test('reject '+mode,()=>{const r=rows(),p=prior(r);if(mode==='duplicate')r.push(r[0]);if(mode==='target')p[0].target=1;if(mode==='group')p[0].groups={};if(mode==='comparator')p[0].predictions.conditional_shape=.2;if(mode==='missing_output')delete r[0].predictions.shooter;if(mode==='endpoint')r[0].predictions.shooter=0;assert.throws(()=>verifyRows(r,p));});
test('every control and both losses without compensation',()=>{const losses=Object.fromEntries(['new_neutral','global_control','shooter','frozen_conditional_shape'].map(k=>[k,{brier:.1,log_loss_clipped:.2}]));assert(guard(losses));losses.frozen_conditional_shape.brier=.099;assert(!guard(losses));losses.frozen_conditional_shape.brier=.1;losses.new_neutral.log_loss_clipped=.19;assert(!guard(losses));losses.shooter.brier=NaN;assert.throws(()=>guard(losses));});
test('strict four-stage calendar windows',()=>{const s=[1,2,3,4].map(m=>({events:2,games:1,start:`2022-0${m}-01`,end:`2022-0${m}-28`}));verifyChronology(s);s[2].start=s[1].end;assert.throws(()=>verifyChronology(s));});
test('identity own role only and validation games excluded',()=>{const stage={events:2,games:1,start:'2022-01-01',end:'2022-02-01'},plan={identity_settings:{gradient_tolerance:.00005,coefficient_bound:1.5},identity_numerics:{method:'declared'}},m={mode:'shooter',publishable:false,historical_as_of_verified:false,settings:plan.identity_settings,fit_start:stage.start,fit_end:stage.end,fit_events:2,fit_game_ids:[2022020001],effects:{shooter:[{player_id:1,fit_events:2,logit_effect:.1}]},optimizer:{success:true,max_projected_gradient:0,method:'declared'}};verifyIdentity(m,'shooter',stage,plan,new Set([2022020002]));assert.throws(()=>verifyIdentity(m,'shooter',stage,plan,new Set([2022020001])));m.effects.goalie=[];assert.throws(()=>verifyIdentity(m,'shooter',stage,plan,new Set()));});
function splitFixture(){
  const cal=[1,2,3,4].map(i=>({game_id:i,event_id:1,game_date:i===1?'2022-02-01':'2022-03-01'})),later=cal.slice(1),validation=[{game_id:5,event_id:1,game_date:'2022-04-01'}];
  const part=rows=>({events:rows.length,games:rows.length,start:rows[0].game_date,end:rows.at(-1).game_date,event_keys_sha256:crypto.createHash('sha256').update(JSON.stringify(rows.map(r=>[r.game_id,r.event_id]))).digest('hex')});
  const expected={cutoff_date:'2022-03-01',earlier_map:part(cal.slice(0,1)),later_identity:part(later)},split={cutoff_date:expected.cutoff_date,earlier_map:{...expected.earlier_map,game_ids:[1]},later_identity:{...expected.later_identity,game_ids:[2,3,4]}};
  const stages=[{events:1,games:1,start:'2022-01-01',end:'2022-01-01'},...['earlier_map','later_identity'].map(k=>{const {event_keys_sha256,...s}=expected[k];return s;}),{events:1,games:1,start:'2022-04-01',end:'2022-04-01'}];return {cal,later,validation,split,expected,stages};
}
test('whole selected date remains in later stage',()=>{const f=splitFixture();assert.equal(verifySplit(f.cal,f.later,f.validation,f.split,f.expected,f.stages).size,1);});
for(const mode of ['cutoff','keyhash','later','overlap','duplicate'])test('reject stage '+mode,()=>{const f=splitFixture();if(mode==='cutoff')f.split.cutoff_date='2022-02-01';if(mode==='keyhash')f.expected.earlier_map.event_keys_sha256='0'.repeat(64);if(mode==='later')f.later.pop();if(mode==='overlap')f.validation[0].game_id=2;if(mode==='duplicate')f.cal.push(f.cal[0]);assert.throws(()=>verifySplit(f.cal,f.later,f.validation,f.split,f.expected,f.stages));});
test('evidence recheck rejects changed bytes and unsafe paths',()=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'forward-shooter-review-test-')));
  try{const f=path.join(root,'receipt.json');fs.writeFileSync(f,'{}');const e=evidenceReader(root);e.read(f);fs.writeFileSync(f,'{"changed":true}');assert.throws(()=>e.recheck());assert.throws(()=>e.read(path.join(root,'..','outside.json')));fs.symlinkSync(f,path.join(root,'alias.json'));assert.throws(()=>e.read(path.join(root,'alias.json')));}finally{fs.rmSync(root,{recursive:true});}
});
