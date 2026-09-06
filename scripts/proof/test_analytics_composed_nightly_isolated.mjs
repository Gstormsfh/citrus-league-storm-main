import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {install,snapshot} from './test_analytics_composed_nightly_fixture.mjs';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE));
const db=new PGlite();
const options={legacyRefresh:process.env.ANALYTICS_COMPOSED_LEGACY_REFRESH==='1'};
// query adapter supports migration multi-statements without claiming backends.
const adapter={query:async(sql,args)=>args?db.query(sql,args):(/;\s*\S/.test(sql)?(await db.exec(sql)).at(-1):db.query(sql))};
try {
 const boundary=await install(adapter,options);
 const first=await adapter.query('SELECT nightly_xg_pipeline() AS result');
 assert.match(first.rows[0].result,/strength=8 toi=8 onice=8 gar=10/);
 const state=await snapshot(adapter,options);
 assert.equal(state.game_strength_intervals.length,72);
 assert.equal(state.player_gar_components.length,10);
 assert.equal(state.player_toi_by_state.length,224);
 await adapter.query('UPDATE raw_shots SET xg_v5=1.5 WHERE id=1');
 await adapter.query('UPDATE strength_build_state SET onice_built_at=NULL WHERE game_id=2025020001');
 const invalidBefore=await snapshot(adapter,options);
 await assert.rejects(adapter.query('SELECT nightly_xg_pipeline()'),/Invalid or duplicate/);
 assert.deepEqual(await snapshot(adapter,options),invalidBefore);
 await adapter.query('UPDATE raw_shots SET xg_v5=.5 WHERE id=1');
 assert.match((await adapter.query('SELECT nightly_xg_pipeline() result')).rows[0].result,/onice=1 gar=10/);
 if(options.legacyRefresh) {
  assert.match(first.rows[0].result,/gsax=2/);
  assert.match(first.rows[0].result,/adjusted=4/);
  const adjusted=(await adapter.query('SELECT x_adj,y_adj,distance_adj FROM nhl_shots WHERE event_id=1')).rows[0];
  assert.equal(adjusted.x_adj,70);assert.equal(adjusted.y_adj,6);
  assert.ok(Math.abs(adjusted.distance_adj-Math.sqrt(397))<1e-12);
  await adapter.query('UPDATE nhl_shots SET xg_sql=1.5 WHERE event_id=1');
  const prior=await snapshot(adapter,options);
  await assert.rejects(adapter.query('SELECT nightly_xg_pipeline()'),/missing or invalid probabilities/);
  assert.deepEqual(await snapshot(adapter,options),prior);
  await adapter.query('UPDATE nhl_shots SET xg_sql=.5 WHERE event_id=1');
  assert.match((await adapter.query('SELECT nightly_xg_pipeline() result')).rows[0].result,/gsax=2/);
 }
 console.log(JSON.stringify({status:'passed-isolated-not-concurrency',boundary,result:first.rows[0],counts:Object.fromEntries(Object.entries(state).map(([k,v])=>[k,v.length]))}));
} finally {await db.close();}
