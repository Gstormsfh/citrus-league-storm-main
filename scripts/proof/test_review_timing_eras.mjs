import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRow,Counts,DIMENSIONS,safe} from './review_timing_eras.mjs';
function row(){return {game_id:2023020001,event_id:2,season:2023,month:'2023-10',game_type:'regular',current_type:505,target:1,state:'1',gap_band:'up_to_1s',gap_seconds:1,previous_type:506,previous_event_id:1,raw_play_index:1,current_clock:'01:01',previous_clock:'01:00',current_period:{number:1,periodType:'REG'},previous_period:{number:1,periodType:'REG'},current_order:2,previous_order:1,current_coordinates:[70,-5],previous_coordinates:[70,5],same_raw_coordinates:false,current_actor:8470001,previous_actor:8470001,same_actor:true,actor_diagnostic_retrospective_not_predictor:true,current_owner:1,previous_owner:1,source_body_sha256:'a'.repeat(64),source_receipt_sha256:'b'.repeat(64),source_envelope_sha256:'c'.repeat(64),source_event_sha256:'d'.repeat(64),previous_source_event_sha256:'e'.repeat(64)};}
test('valid row independent checks',()=>assert.equal(validateRow(row()).gap_seconds,1));
for(const [seconds,band]of [[0,'same_clock'],[1,'up_to_1s'],[2,'over_1_under_3s'],[3,'from_3_to_10s'],[10,'from_3_to_10s'],[11,'over_10s']])test(`exact gap ${seconds}`,()=>{const r=row();r.current_clock=`01:${String(seconds).padStart(2,'0')}`;r.gap_seconds=seconds;r.gap_band=band;validateRow(r);});
test('period boundary gap remains unknown',()=>{const r=row();r.current_period.number=2;r.current_clock='00:00';r.state=null;r.gap_seconds=null;r.gap_band='no_same_period_predecessor';validateRow(r);});
test('signed coordinates never folded',()=>{const r=row();r.same_raw_coordinates=true;assert.throws(()=>validateRow(r),/coordinate/);});
test('invalid coordinate yields unknown not false',()=>{const r=row();r.current_coordinates=[101,0];r.same_raw_coordinates=null;validateRow(r);r.same_raw_coordinates=false;assert.throws(()=>validateRow(r));});
test('unknown actors not equal',()=>{const r=row();r.current_actor=null;r.previous_actor=null;r.same_actor=null;validateRow(r);r.same_actor=true;assert.throws(()=>validateRow(r));});
for(const [field,value]of [['target',0],['season',2024],['gap_seconds',2],['previous_order',2],['current_clock','01:60'],['current_actor',true],['game_id',true],['source_event_sha256','invalid'],['state',null]])test(`reject corrupted ${field}`,()=>{const r=row();r[field]=value;assert.throws(()=>validateRow(r));});
test('duplicate keys rejected',()=>{const c=new Counts();c.add(row());assert.throws(()=>c.add(row()));});
function accounting(r){return {events:1,goals:1,games:1,publishable:false,rollups:Object.fromEntries(Object.entries(DIMENSIONS).map(([name,fields])=>[name,[{cell:fields.map(f=>r[f]),events:1,goals:1,games:1}]]))};}
test('all five exact rollups',()=>{const r=row(),c=new Counts();c.add(r);assert.equal(c.compare(accounting(r)),5);});
test('corrupt cell counts rejected',()=>{const r=row(),c=new Counts();c.add(r);const a=accounting(r);a.rollups.season_type_gap[0].goals=0;assert.throws(()=>c.compare(a));});
test('missing dimension rejected',()=>{const r=row(),c=new Counts();c.add(r);const a=accounting(r);delete a.rollups.month_state_gap;assert.throws(()=>c.compare(a));});
test('duplicate cell rejected',()=>{const r=row(),c=new Counts();c.add(r);const a=accounting(r);a.rollups.month_state_gap.push(a.rollups.month_state_gap[0]);assert.throws(()=>c.compare(a));});
test('absolute and relative traversal rejected',()=>{assert.throws(()=>safe('/tmp','../outside'));assert.throws(()=>safe('/tmp','/tmp/../outside'));});
