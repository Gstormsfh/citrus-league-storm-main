import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const capture=readFileSync(new URL('./capture-active.sql',import.meta.url),'utf8');
const restore=readFileSync(new URL('./restore-active.sql',import.meta.url),'utf8');
const old='00000000-0000-0000-0000-000000000001',next='00000000-0000-0000-0000-000000000002';
async function setup(){
 const db=new PGlite();
 await db.exec(`CREATE SCHEMA cron;
 CREATE TABLE canonical_projection_runs(id uuid PRIMARY KEY,season int,revision text);
 CREATE TABLE canonical_projection_active(season int PRIMARY KEY,run_id uuid REFERENCES canonical_projection_runs);
 CREATE TABLE player_ros_projections(player_id int,season int,goals numeric);
 CREATE TABLE player_projected_stats(projection_id int,season int,projection_date date,goals numeric);
 CREATE TABLE cron.job(jobid bigint PRIMARY KEY,schedule text,command text,active boolean);
 CREATE TABLE cron.job_run_details(jobid bigint,status text,end_time timestamptz);
 CREATE FUNCTION cron.alter_job(job_id bigint,schedule text DEFAULT NULL,command text DEFAULT NULL,
  database text DEFAULT NULL,username text DEFAULT NULL,active boolean DEFAULT NULL) RETURNS void LANGUAGE sql AS
  $$UPDATE cron.job j SET schedule=coalesce($2,j.schedule),command=coalesce($3,j.command),active=coalesce($6,j.active) WHERE j.jobid=$1$$;
 CREATE FUNCTION draft_freeze_blockers(int,int) RETURNS SETOF int LANGUAGE sql AS 'SELECT 1 WHERE false';
 INSERT INTO canonical_projection_runs VALUES('${old}',2026,'${'a'.repeat(64)}'),('${next}',2026,'${'b'.repeat(64)}');
 INSERT INTO canonical_projection_active VALUES(2026,'${old}');
 INSERT INTO player_ros_projections VALUES(10,2026,38.123456789012345678901234);
 INSERT INTO player_projected_stats VALUES(1,2026,current_date,0.123456789012345678901234),(2,2026,current_date-1,0.25),(3,2025,current_date,0.99);
 INSERT INTO cron.job VALUES(31,'50 8 * * *','old ROS',true),(34,'5 9 * * *','old daily',true),(99,'* * * * *','unrelated',true);`);
 await db.exec(`
 BEGIN;
 CREATE FUNCTION pg_temp.canonical_recovery_schema() RETURNS jsonb LANGUAGE sql AS $$SELECT '{"test_schema":1}'::jsonb$$;
 CREATE FUNCTION pg_temp.canonical_recovery_hashes(s int,d date) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object(
 'active',jsonb_build_object('count',(SELECT count(*) FROM canonical_projection_active),'rows',(SELECT jsonb_agg(to_jsonb(a)) FROM canonical_projection_active a)),
 'ros',(SELECT jsonb_agg(to_jsonb(r) ORDER BY player_id) FROM player_ros_projections r),
 'daily',(SELECT jsonb_agg(to_jsonb(p) ORDER BY projection_id) FROM player_projected_stats p WHERE season=s AND projection_date>=d))$$;
 CREATE TEMP TABLE recovery_request(payload jsonb);
 INSERT INTO recovery_request VALUES(jsonb_build_object('run_id','${next}','revision','${'b'.repeat(64)}','expected_active_run_id','${old}'));`);
 await db.exec(capture);
 await db.exec(`UPDATE canonical_projection_active SET run_id='${next}';
 UPDATE player_ros_projections SET goals=50;UPDATE player_projected_stats SET goals=1 WHERE season=2026 AND projection_date>=current_date;
 UPDATE cron.job SET active=false WHERE jobid IN(31,34);
 UPDATE recovery_bundle SET payload=payload||jsonb_build_object('post_hashes',pg_temp.canonical_recovery_hashes(2026,current_date),
 'post_jobs',(SELECT jsonb_agg(jsonb_build_object('jobid',jobid,'schedule',schedule,'command',command,'active',active) ORDER BY jobid) FROM cron.job WHERE jobid IN(31,34)));
 DELETE FROM recovery_request;INSERT INTO recovery_request SELECT payload FROM recovery_bundle;`);
 return db;
}
test('active-to-active recovery restores exact decimals, pointer and cron; preserves history and past/other-season rows',async()=>{
 const db=await setup();try{
  await db.exec(restore);
  assert.equal((await db.query('SELECT run_id FROM canonical_projection_active')).rows[0].run_id,old);
  assert.equal((await db.query('SELECT goals::text value FROM player_ros_projections')).rows[0].value,'38.123456789012345678901234');
  assert.equal((await db.query('SELECT goals::text value FROM player_projected_stats WHERE projection_id=1')).rows[0].value,'0.123456789012345678901234');
  assert.equal((await db.query('SELECT count(*)::int n FROM canonical_projection_runs')).rows[0].n,2);
  assert.equal((await db.query('SELECT count(*)::int n FROM cron.job WHERE active')).rows[0].n,3);
  assert.equal((await db.query('SELECT count(*)::int n FROM player_projected_stats')).rows[0].n,3);
 }finally{await db.exec('ROLLBACK');await db.close();}
});
const bad={
 'changed calendar':`UPDATE recovery_request SET payload=jsonb_set(payload,'{database_date}',to_jsonb((current_date-1)::text))`,
 'changed database schema':`UPDATE recovery_request SET payload=jsonb_set(payload,'{schema}','{}')`,
 'changed active revision':`UPDATE canonical_projection_active SET run_id='${old}'`,
 'changed outputs':`UPDATE player_ros_projections SET goals=999`,
 'changed cron definition':`UPDATE cron.job SET command='unexpected' WHERE jobid=31`,
 'running legacy job':`INSERT INTO cron.job_run_details VALUES(31,'running',NULL)`,
 'missing prior pointer':`UPDATE recovery_request SET payload=jsonb_set(payload,'{active_rows}','[]')`,
 'wrong project':`UPDATE recovery_request SET payload=jsonb_set(payload,'{project}','"staging"')`,
 'draft freeze':`CREATE OR REPLACE FUNCTION draft_freeze_blockers(int,int) RETURNS SETOF int LANGUAGE sql AS 'SELECT 1'`,
};
for(const [name,sql] of Object.entries(bad))test('recovery fails closed: '+name,async()=>{
 const db=await setup();try{await db.exec(sql);await assert.rejects(db.exec(restore));}
 finally{await db.exec('ROLLBACK');assert.equal((await db.query('SELECT run_id FROM canonical_projection_active')).rows[0].run_id,old);await db.close();}
});
