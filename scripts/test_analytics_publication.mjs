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
// SQL fixtures share the same mandatory receipt envelope as Python publishers.
await db.exec(`CREATE FUNCTION fixture_receipt(v jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('gate_version','fixture-v1','evidence_sha256',repeat('a',64),
 'freshness_observed_at','2020-01-01T00:00:00Z') || v $$`);
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
await rejected("INSERT INTO analytics_source_snapshots(source,observed_at,recorded_at,payload) VALUES('forged receipt',now()+interval '1 day','infinity','{}')",/check constraint/);
await rejected("INSERT INTO analytics_source_snapshots(source,observed_at,payload) VALUES('nonfinite','-infinity','{}')",/check constraint/);
const {rows:[hashed]}=await db.query(`INSERT INTO analytics_source_snapshots(source,observed_at,payload,payload_sha256)
 VALUES('hash authority',now()-interval '1 day','{"b": 2, "a": 1}','forged')
 RETURNING payload_sha256=encode(sha256(convert_to(payload::text,'UTF8')),'hex') AS verified`);
assert.equal(hashed.verified,true); checks++;
const { rows: [batch] } = await db.query(`INSERT INTO analytics_metric_batches
  (source_snapshot_id,metric,variant,unit,season,game_type,population,feature_version,model_version,code_revision,data_cutoff,expected_entities,validation)
  VALUES($1,'avg_toi','official','minutes',2025,'regular','skaters','v1','none',$2,now(),2,fixture_receipt('{"status":"passed","entity_ids":[1,2]}')) RETURNING id`, [source.id, '0'.repeat(40)]);
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
 VALUES($1,'avg_toi','official','minutes',2025,'regular','skaters','v1','none',$2,now()-interval '2 days',1,fixture_receipt('{"status":"passed","entity_ids":[1]}')) RETURNING id`,[source.id,'0'.repeat(40)]);
await rejected(`INSERT INTO analytics_metric_values VALUES('${late.id}',1,'NaN','available','verified',NULL)`,/check constraint/);
await rejected(`INSERT INTO analytics_metric_values VALUES('${late.id}',1,0,'unavailable','missing',NULL)`,/check constraint/);
await db.query("INSERT INTO analytics_metric_values VALUES($1,1,5,'available','verified',NULL)",[late.id]);
await rejected(`INSERT INTO analytics_publications(batch_id,reason) VALUES('${late.id}','bad')`,/observed after/);
const {rows:[wrong]} = await db.query(`INSERT INTO analytics_metric_batches
 (source_snapshot_id,metric,variant,unit,season,game_type,population,feature_version,model_version,code_revision,data_cutoff,expected_entities,validation)
 VALUES($1,'avg_toi','official','minutes',2025,'regular','skaters','v1','none',$2,now(),1,fixture_receipt('{"status":"passed","entity_ids":[99]}')) RETURNING id`,[source.id,'0'.repeat(40)]);
await db.query("INSERT INTO analytics_metric_values VALUES($1,1,5,'available','verified',NULL)",[wrong.id]);
await rejected(`INSERT INTO analytics_publications(batch_id,reason) VALUES('${wrong.id}','wrong entity')`,/identities do not match/);
const {rows:[future]}=await db.query(`INSERT INTO analytics_metric_batches
 (source_snapshot_id,metric,variant,unit,season,game_type,population,feature_version,model_version,code_revision,data_cutoff,computed_at,expected_entities,validation)
 VALUES($1,'future','v1','unit',2025,'regular','skaters','v1','none',$2,now()+interval '1 day',now()+interval '2 days',1,
 fixture_receipt('{"status":"passed","entity_ids":[1]}')) RETURNING id`,[source.id,'0'.repeat(40)]);
await db.query("INSERT INTO analytics_metric_values VALUES($1,1,5,'available','verified',NULL)",[future.id]);
await rejected(`INSERT INTO analytics_publications(batch_id,reason) VALUES('${future.id}','future cutoff')`,/cannot be in the future/);
for (const [receipt, pattern] of [
  [{status:'passed',entity_ids:[1]}, /typed foundation receipt/],
  [{gate_version:7}, /typed foundation receipt/],
  [{evidence_sha256:'g'.repeat(64)}, /typed foundation receipt/],
  [{entity_ids:['1']}, /JSON integers/],
  [{freshness_observed_at:'2020-01-01'}, /typed foundation receipt/],
  [{freshness_observed_at:'2100-01-01T00:00:00Z'}, /newer than source/],
]) {
  const validation = Object.hasOwn(receipt,'status') ? receipt : {
    status:'passed',entity_ids:[1],gate_version:'fixture-v1',evidence_sha256:'a'.repeat(64),
    freshness_observed_at:'2020-01-01T00:00:00Z',...receipt};
  const {rows:[candidate]} = await db.query(`INSERT INTO analytics_metric_batches
    (source_snapshot_id,metric,variant,unit,season,game_type,population,feature_version,model_version,code_revision,data_cutoff,expected_entities,validation)
    VALUES($1,'fixture','v1','unit',2025,'regular','skaters','v1','none',$2,now(),1,$3) RETURNING id`,
    [source.id,'0'.repeat(40),JSON.stringify(validation)]);
  await db.query("INSERT INTO analytics_metric_values VALUES($1,1,5,'available','verified',NULL)",[candidate.id]);
  await rejected(`INSERT INTO analytics_publications(batch_id,reason) VALUES('${candidate.id}','bad receipt')`,pattern);
}
await db.exec('RESET ROLE');
await rejected(`UPDATE analytics_metric_values SET value=9 WHERE batch_id='${batch.id}'`, /immutable/);
await db.close();
console.log(`analytics publication: ${checks} checks passed (isolated PGlite)`);
