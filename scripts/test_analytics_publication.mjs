// Isolated Postgres/WASM test, never connects to a hosted database.
// PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node scripts/test_analytics_publication.mjs
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
if (!process.env.PGLITE_MODULE) throw new Error('Provide isolated PGLITE_MODULE path');
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE));
const db = new PGlite();
await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
await db.exec(await readFile(new URL('../supabase/migrations/20260906005705_analytics_versioned_publication_contract.sql', import.meta.url), 'utf8'));
let checks = 0;
async function rejected(sql, pattern) {
  await assert.rejects(db.exec(sql), pattern);
  checks++;
}
await db.exec('SET ROLE anon');
await rejected('SELECT * FROM analytics_source_snapshots', /permission denied/);
await db.exec('RESET ROLE; SET ROLE authenticated');
await rejected('INSERT INTO analytics_publications(batch_id,reason) VALUES(gen_random_uuid(),\'bad\')', /permission denied/);
await db.exec('RESET ROLE; SET ROLE service_role');
const { rows: [source] } = await db.query("INSERT INTO analytics_source_snapshots(source,observed_at,payload) VALUES('fixture',now()-interval '1 day','{}') RETURNING id,payload_sha256");
assert.match(source.payload_sha256, /^[a-f0-9]{64}$/); checks++;
const { rows: [batch] } = await db.query(`INSERT INTO analytics_metric_batches
  (source_snapshot_id,metric,variant,unit,season,game_type,population,feature_version,model_version,code_revision,data_cutoff,expected_entities,validation)
  VALUES($1,'avg_toi','official','minutes',2025,'regular','skaters','v1','none',$2,now(),2,'{"status":"passed"}') RETURNING id`, [source.id, '0'.repeat(40)]);
await rejected(`INSERT INTO analytics_publications(batch_id,reason) VALUES('${batch.id}','incomplete')`, /Incomplete analytics batch/);
await db.query(`INSERT INTO analytics_metric_values(batch_id,entity_id,value,availability,reason)
  VALUES($1,1,5,'available','verified'),($1,2,NULL,'unavailable','missing_source')`, [batch.id]);
await db.query('INSERT INTO analytics_publications(batch_id,reason) VALUES($1,$2)', [batch.id,'verified fixture']);
checks++;
await rejected(`INSERT INTO analytics_metric_values(batch_id,entity_id,value,availability,reason) VALUES('${batch.id}',3,1,'available','verified')`, /sealed/);
await rejected(`UPDATE analytics_metric_values SET value=9 WHERE batch_id='${batch.id}'`, /permission denied|immutable/);
await rejected(`DELETE FROM analytics_source_snapshots WHERE id='${source.id}'`, /permission denied|immutable/);
await db.query('INSERT INTO analytics_publications(batch_id,reason) VALUES($1,$2)',[batch.id,'explicit replay']);
checks++;
const {rows:[failed]} = await db.query(`INSERT INTO analytics_metric_batches
 (source_snapshot_id,metric,variant,unit,season,game_type,population,feature_version,model_version,code_revision,data_cutoff,expected_entities,validation)
 VALUES($1,'avg_toi','official','minutes',2025,'regular','skaters','v1','none',$2,now(),1,'{"status":"failed"}') RETURNING id`,[source.id,'0'.repeat(40)]);
await db.query("INSERT INTO analytics_metric_values VALUES($1,1,5,'available','verified',NULL)",[failed.id]);
await rejected(`INSERT INTO analytics_publications(batch_id,reason) VALUES('${failed.id}','bad')`,/validation has not passed/);
const {rows:[late]} = await db.query(`INSERT INTO analytics_metric_batches
 (source_snapshot_id,metric,variant,unit,season,game_type,population,feature_version,model_version,code_revision,data_cutoff,expected_entities,validation)
 VALUES($1,'avg_toi','official','minutes',2025,'regular','skaters','v1','none',$2,now()-interval '2 days',1,'{"status":"passed"}') RETURNING id`,[source.id,'0'.repeat(40)]);
await rejected(`INSERT INTO analytics_metric_values VALUES('${late.id}',1,'NaN','available','verified',NULL)`,/check constraint/);
await rejected(`INSERT INTO analytics_metric_values VALUES('${late.id}',1,0,'unavailable','missing',NULL)`,/check constraint/);
await db.query("INSERT INTO analytics_metric_values VALUES($1,1,5,'available','verified',NULL)",[late.id]);
await rejected(`INSERT INTO analytics_publications(batch_id,reason) VALUES('${late.id}','bad')`,/observed after/);
await db.exec('RESET ROLE');
await rejected(`UPDATE analytics_metric_values SET value=9 WHERE batch_id='${batch.id}'`, /immutable/);
await db.close();
console.log(`analytics publication: ${checks} checks passed (isolated PGlite)`);
