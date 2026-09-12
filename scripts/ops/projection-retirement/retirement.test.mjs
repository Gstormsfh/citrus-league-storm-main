import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {PGlite}=await import(require.resolve('@electric-sql/pglite',{paths:[process.env.CITRUS_TEST_RUNTIME||process.cwd()]}));
const quarantine=readFileSync(new URL('./quarantine-cache.sql',import.meta.url),'utf8');
const restore=readFileSync(new URL('./restore-cache.sql',import.meta.url),'utf8');

async function fixture(){
 const db=new PGlite();
 await db.exec(`CREATE TABLE nhl_games(game_id integer PRIMARY KEY);
 INSERT INTO nhl_games VALUES(1);
 CREATE TABLE projection_cache(cache_id uuid PRIMARY KEY,game_id integer REFERENCES nhl_games,projection_date date,calculation_timestamp timestamptz,projected_goals numeric);
 ALTER TABLE projection_cache ENABLE ROW LEVEL SECURITY;
 CREATE POLICY read_cache ON projection_cache FOR SELECT USING(true);
 INSERT INTO projection_cache VALUES('00000000-0000-0000-0000-000000000001',1,'2026-01-03','2026-01-03T00:00:00Z',0.25);
 SET citrus.retirement_release_verified='true';
 SET citrus.retirement_external_callers_verified='true';
 SET citrus.retirement_restore_verified='true';
 SET citrus.retirement_expected_rows='1';`);
 const [{hash}]=(await db.query(`SELECT md5(string_agg(row_to_json(t)::text,'' ORDER BY cache_id)) hash FROM projection_cache t`)).rows;
 await db.query(`SELECT set_config('citrus.retirement_expected_md5',$1,false)`,[hash]);
 return db;
}

test('rename and inverse preserve OID, data, RLS and constraints',async()=>{
 const db=await fixture();try{
  const before=(await db.query(`SELECT oid,relrowsecurity FROM pg_class WHERE oid='projection_cache'::regclass`)).rows;
  const rows=(await db.query('TABLE projection_cache')).rows;
  const constraints=(await db.query(`SELECT oid FROM pg_constraint WHERE conrelid='projection_cache'::regclass ORDER BY oid`)).rows;
  await db.exec('BEGIN');await db.exec(quarantine);
  assert.equal((await db.query(`SELECT to_regclass('public.projection_cache') AS name`)).rows[0].name,null);
  await db.exec(restore);await db.exec('COMMIT');
  assert.deepEqual((await db.query('TABLE projection_cache')).rows,rows);
  assert.deepEqual((await db.query(`SELECT oid,relrowsecurity FROM pg_class WHERE oid='projection_cache'::regclass`)).rows,before);
  assert.deepEqual((await db.query(`SELECT oid FROM pg_constraint WHERE conrelid='projection_cache'::regclass ORDER BY oid`)).rows,constraints);
 }finally{await db.close();}
});

for(const [name,setup,pattern] of [
 ['unapproved gates',`SET citrus.retirement_release_verified='false'`,/gates not satisfied/],
 ['changed data',`UPDATE projection_cache SET projected_goals=2`,/changed since snapshot/],
 ['incoming foreign key',`CREATE TABLE consumer(id uuid REFERENCES projection_cache(cache_id))`,/dependency/],
 ['dependent view',`CREATE VIEW consumer AS SELECT * FROM projection_cache`,/dependency/],
 ['scheduled job',`CREATE SCHEMA cron; CREATE TABLE cron.job(command text); INSERT INTO cron.job VALUES('SELECT * FROM projection_cache')`,/dependency/],
 ['routine reference',`CREATE FUNCTION consumer() RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM projection_cache'`,/dependency/],
 ['target collision',`CREATE TABLE projection_cache_retired_20260912(id int)`,/target already exists/],
])test(`blocks ${name}`,async()=>{const db=await fixture();try{await db.exec(setup);await assert.rejects(db.exec(quarantine),pattern);assert.equal((await db.query('SELECT count(*)::int n FROM projection_cache')).rows[0].n,1);}finally{await db.close();}});
