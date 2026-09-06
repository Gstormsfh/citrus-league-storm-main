// Exact captured view closure; explicitly synthetic cell parameters only.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const hash=s=>createHash('md5').update(s).digest('hex');
export async function installCellScorer(db) {
 const load=async name=>JSON.parse(await readFile(new URL('captures/'+name,import.meta.url),'utf8'));
 const feature=(await load('composed_legacy_features_20260906_080310.json')).objects[0];
 const views=(await load('composed_legacy_keys_fold_20260906_080406.json')).objects;
 const columns=(await load('composed_legacy_columns_20260906_080330.json')).objects;
 const present=new Set((await db.query("SELECT attname FROM pg_attribute WHERE attrelid='nhl_shots'::regclass AND attnum>0 AND NOT attisdropped")).rows.map(r=>r.attname));
 for(const c of columns.find(r=>r.relation==='nhl_shots').columns)
  if(!present.has(c.name))await db.query(`ALTER TABLE nhl_shots ADD COLUMN "${c.name}" ${c.type}`);
 await db.query(`ALTER TABLE nhl_shots ALTER xg_sql TYPE float8,ALTER x_norm TYPE numeric,
 ALTER y_norm TYPE numeric,ALTER seconds_since_prev TYPE numeric;
 CREATE TABLE nhl_xg_sql_cells(fold smallint NOT NULL,lvl smallint NOT NULL,ckey text NOT NULL,
 n int NOT NULL,k int NOT NULL,rate float8 NOT NULL,PRIMARY KEY(fold,lvl,ckey));`);
 for(const row of [feature,...views]) {
  assert.equal(hash(row.definition),row.definition_md5);
  await db.query(`CREATE VIEW public.${row.relation} AS ${row.definition}`);
  assert.equal((await db.query('SELECT md5(pg_get_viewdef($1::regclass,true)) hash',[row.relation])).rows[0].hash,row.definition_md5);
 }
 const capture=JSON.parse(await readFile(new URL('../../supabase/migrations/captures/2026-09-06_analytics_writer_protocol_rollback.json',import.meta.url),'utf8'));
 const scorer=capture.find(r=>r.signature==='score_xg_sql_v2(integer)');assert.equal(hash(scorer.definition),scorer.definition_md5);
 const definition=scorer.definition.replace(/\nbegin\n/i,m=>m+'  PERFORM public.analytics_enter_writer_protocol();\n');
 await db.query('DROP FUNCTION score_xg_sql_v2(integer)');await db.query(definition);
 assert.equal((await db.query("SELECT md5(pg_get_functiondef('score_xg_sql_v2(integer)'::regprocedure)) hash")).rows[0].hash,hash(definition));
 await db.query(`UPDATE nhl_shots SET game_date='2025-10-01',angle=0,shot_type='wrist',
 own_skaters=5,opp_skaters=5,own_goalie=1,opp_goalie=1,strength_source='synthetic_reviewed_fixture',
 is_penalty_shot=false,score_diff=0,period=1,seconds_elapsed=60;
 INSERT INTO nhl_xg_sql_cells SELECT fold,0,'ALL',100,40,.4 FROM generate_series(0,4) fold;
 INSERT INTO nhl_xg_sql_cells VALUES(20,0,'ALL',100,40,.4);
 ALTER TABLE nhl_xg_sql_cells ENABLE ROW LEVEL SECURITY;
 GRANT SELECT,INSERT,UPDATE,DELETE ON nhl_xg_sql_cells TO service_role;
 GRANT SELECT ON nhl_shot_features,nhl_shot_fold,nhl_xg_sql_keys TO service_role;`);
 return {signature:scorer.signature,installed_md5:hash(definition),
  views:[feature,...views].map(r=>({relation:r.relation,definition_md5:r.definition_md5,observed_utc:r.observed_utc})),
  scope:'exact feature/fold/key/scorer plumbing with synthetic .4 global cells; no fitted-model validity or calibration acceptance'};
}
