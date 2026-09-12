import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
const migration=readFileSync('supabase/migrations/20260912073440_scoring_rules_replace_removed_keys.sql','utf8');
async function setup(){
 const db=new PGlite();
 await db.exec(`CREATE TABLE leagues(id uuid PRIMARY KEY,scoring_settings jsonb);
 CREATE TABLE stat_catalog(stat_key text PRIMARY KEY,applies_to text,default_multiplier numeric);
 INSERT INTO stat_catalog VALUES('goals','skater',6),('shots_on_goal','skater',.9),('saves','goalie',.6),('goals_against','goalie',-3);
 CREATE TABLE league_scoring_rules(league_id uuid,stat_key text,multiplier numeric,updated_at timestamptz,PRIMARY KEY(league_id,stat_key));
 INSERT INTO leagues VALUES('00000000-0000-0000-0000-000000000001','{"skater":{"goals":2}}'),('00000000-0000-0000-0000-000000000002',null);
 INSERT INTO league_scoring_rules VALUES('00000000-0000-0000-0000-000000000001','shots_on_goal',9,now()),('00000000-0000-0000-0000-000000000002','goals',99,now());`);
 await db.exec('CREATE FUNCTION sync_scoring_settings_to_rules() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW;END$$');
 await db.exec('CREATE TRIGGER sync_scoring_settings_to_rules_trg AFTER INSERT OR UPDATE OF scoring_settings ON leagues FOR EACH ROW EXECUTE FUNCTION sync_scoring_settings_to_rules()');
 await db.exec(migration);
 const rules=async id=>Object.fromEntries((await db.query('select stat_key,multiplier::float8 multiplier from league_scoring_rules where league_id=$1',[id])).rows.map(r=>[r.stat_key,r.multiplier]));
 const id='00000000-0000-0000-0000-000000000001';
 const update=async value=>db.query('update leagues set scoring_settings=$1::jsonb where id=$2',[value===null?null:JSON.stringify(value),id]);
 return {db,rules,id,update};
}
test('migration reconciles stale removed keys and null-reset rules',async()=>{
 const{db,rules,id}=await setup();try{assert.deepEqual(await rules(id),{goals:2,shots_on_goal:0,saves:0,goals_against:0});assert.equal((await rules('00000000-0000-0000-0000-000000000002')).goals,6)}finally{await db.close()}
});
test('key removal, explicit zero, negative and fractional weights replace previous settings',async()=>{
 const{db,rules,id,update}=await setup();try{
 await update({skater:{goals:8,shots_on_goal:.25},goalie:{saves:0,goals_against:-1.75}});assert.deepEqual(await rules(id),{goals:8,shots_on_goal:.25,saves:0,goals_against:-1.75});
 await update({skater:{shots_on_goal:0}});assert.deepEqual(await rules(id),{goals:0,shots_on_goal:0,saves:0,goals_against:0});
 }finally{await db.close()}
});
test('explicit reset restores defaults; empty configured document disables everything',async()=>{
 const{db,rules,id,update}=await setup();try{
 await update(null);assert.deepEqual(await rules(id),{goals:6,shots_on_goal:.9,saves:.6,goals_against:-3});
 await update({});assert.deepEqual(await rules(id),{goals:0,shots_on_goal:0,saves:0,goals_against:0});
 }finally{await db.close()}
});
test('numeric strings are disabled exactly as client settings normalization, exponent numbers survive',async()=>{
 const{db,rules,id,update}=await setup();try{
 await update({skater:{goals:'8',shots_on_goal:1e-8},goalie:{saves:null}});assert.equal((await rules(id)).goals,0);assert.equal((await rules(id)).shots_on_goal,1e-8);
 }finally{await db.close()}
});
