// Isolated synthetic SQL only; no network, hosted mutations, or source validation claim.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db=new PGlite();
const migration=await readFile(new URL('../supabase/migrations/20260906050736_fill_archive_boxscore_compare_and_set.sql',import.meta.url),'utf8');
const signature='public.citrus_fill_archive_boxscore(bigint,date,jsonb,text,timestamptz,jsonb)';
let checks=0;
try {
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  CREATE TABLE raw_nhl_data(id bigint PRIMARY KEY,game_id integer UNIQUE,game_date date,
   raw_json jsonb,boxscore_json jsonb,content_sha256 text,source_url text,fetched_at timestamptz,
   processed boolean,created_at timestamptz,other_metadata jsonb);
  ALTER TABLE raw_nhl_data ENABLE ROW LEVEL SECURITY;
  GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
  GRANT SELECT,UPDATE ON raw_nhl_data TO service_role;`);
 await db.exec(migration);await db.exec(migration);checks++;
 const definition=(await db.query('SELECT pg_get_functiondef($1::regprocedure) d',[signature])).rows[0].d;
 const security=(await db.query('SELECT prosecdef FROM pg_proc WHERE oid=$1::regprocedure',[signature])).rows[0];
 assert.equal(security.prosecdef,false);checks++;
 for(const role of ['anon','authenticated','service_role']){
  assert.equal((await db.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') ok',[role,signature])).rows[0].ok,role==='service_role');checks++;
 }
 const raw={id:2025020001,gameDate:'2025-10-01',season:20252026,gameType:2,gameState:'OFF',homeTeam:{id:1},awayTeam:{id:2},plays:[{eventId:1}]};
 const box={...raw,playerByGameStats:{homeTeam:{forwards:[]},awayTeam:{forwards:[]}}};delete box.plays;
 const args=[raw.id,raw.gameDate,raw,'a'.repeat(64),'2025-10-02T01:02:03.123456Z',box];
 const sql='SELECT public.citrus_fill_archive_boxscore($1::bigint,$2::date,$3::jsonb,$4::text,$5::timestamptz,$6::jsonb) ok';
 const call=async(a=args)=>(await db.query(sql,a)).rows[0].ok;
 const snapshot=async()=>(await db.query('SELECT to_jsonb(r) r FROM raw_nhl_data r ORDER BY id')).rows;
 await db.query(`INSERT INTO raw_nhl_data VALUES(1,$1,$2,$3,NULL,$4,
  'https://api-web.nhle.com/v1/gamecenter/2025020001/play-by-play',$5,true,
  '2025-10-03T00:00:00Z','{"retain":true}')`,args.slice(0,5));
 const original=await snapshot();
 for(const role of ['anon','authenticated']){
  await db.exec(`SET ROLE ${role}`);await assert.rejects(call(),/permission denied/);await db.exec('RESET ROLE');checks++;
 }
 await db.exec('SET ROLE service_role');assert.equal(await call(),true);
 let filled=await snapshot();assert.deepEqual({...filled[0].r,boxscore_json:null},original[0].r);checks++;
 assert.equal(await call(),false);assert.deepEqual(await snapshot(),filled);checks++;
 await db.exec('RESET ROLE');await db.exec("UPDATE raw_nhl_data SET boxscore_json='{}'");
 assert.equal(await call(),false);checks++;
 await db.exec('UPDATE raw_nhl_data SET boxscore_json=NULL');
 // Well-formed but stale CAS values are no-ops, not permission to repair raw evidence.
 for(const [index,value] of [[2,{...raw,revision:2}],[3,'b'.repeat(64)],[4,'2025-10-02T01:02:03.123457Z']]){
  const stale=[...args];stale[index]=value;
  assert.equal(await call(stale),false);assert.deepEqual(await snapshot(),original);checks++;
 }
 for(const mutation of ["source_url='https://example.invalid/pbp'","game_date='2025-10-02'","game_id=2025020002"]){
  await db.exec('BEGIN');await db.exec(`UPDATE raw_nhl_data SET ${mutation}`);
  const before=await snapshot();assert.equal(await call(),false);assert.deepEqual(await snapshot(),before);
  await db.exec('ROLLBACK');checks++;
 }
 const invalid=[];
 for(const [i,values] of [[0,[null,2025010001,2025020000]],[1,[null,'infinity','2024-01-01']],[3,[null,'A'.repeat(64),'x']],[4,[null,'infinity','2099-01-01T00:00:00Z','2025-09-30T23:59:59Z']]])
  for(const value of values){const a=[...args];a[i]=value;invalid.push(a);}
 for(const i of [2,5]) for(const change of [null,[],{}, {...raw,id:'2025020001'},{...raw,gameType:3},{...raw,season:20242025},{...raw,gameState:'LIVE'},{...raw,homeTeam:{id:true}},{...raw,awayTeam:{id:1}},{...raw,homeTeam:{id:0}}]){
  const a=[...args];a[i]=change;invalid.push(a);
 }
 for(const plays of [null,[],[null],[{}],[1]]){const a=[...args];a[2]={...raw,plays};invalid.push(a);}
 for(const stats of [null,{}, {homeTeam:{},awayTeam:{forwards:[]}}, {homeTeam:{forwards:[]},awayTeam:[]}]){
  const a=[...args];a[5]={...box,playerByGameStats:stats};invalid.push(a);
 }
 invalid.push([...args.slice(0,5),{...box,homeTeam:{id:3}}]);
 for(const a of invalid){await assert.rejects(call(a),/Invalid archive fill/);assert.deepEqual(await snapshot(),original);checks++;}
 await db.exec('BEGIN');assert.equal(await call(),true);await db.exec('ROLLBACK');assert.deepEqual(await snapshot(),original);checks++;
 await db.exec("BEGIN; SET LOCAL DateStyle='SQL, DMY'");
 assert.equal(await call(),true);await db.exec('ROLLBACK');assert.deepEqual(await snapshot(),original);checks++;
 // A corrected receipt invalidates the old compare-and-set without replacing it.
 const corrected={...raw,revision:2};
 await db.query('UPDATE raw_nhl_data SET raw_json=$1,content_sha256=$2',[corrected,'c'.repeat(64)]);
 const correction=await snapshot();assert.equal(await call(),false);assert.deepEqual(await snapshot(),correction);
 const fresh=[...args];fresh[2]=corrected;fresh[3]='c'.repeat(64);assert.equal(await call(fresh),true);checks++;
 // Large full-body SQL arguments are supported; REST transport is tested separately.
 await db.query('UPDATE raw_nhl_data SET raw_json=$1,boxscore_json=NULL',[{...raw,padding:'x'.repeat(400000)}]);
 const large=[...fresh];large[2]={...raw,padding:'x'.repeat(400000)};assert.equal(await call(large),true);checks++;
 await db.exec(`ALTER FUNCTION ${signature} SECURITY DEFINER`);
 await assert.rejects(db.exec(migration),/definition drift/);checks++;
 await db.exec(definition);
 await db.exec(`DROP FUNCTION ${signature}`);
 assert.equal((await db.query('SELECT to_regprocedure($1) p',[signature])).rows[0].p,null);checks++;
 console.log(`Archive boxscore fill: ${checks} checks passed; isolated synthetic SQL only.`);
} finally {await db.close();}
