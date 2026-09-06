// Isolated SQL verification of real Python-prepared canonical source receipts.
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE));
const db = new PGlite();
await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
for (const name of ['20260906005705_analytics_versioned_publication_contract.sql', '20260906013428_analytics_canonical_event_observations.sql']) {
  await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));
}
const fixtures = JSON.parse(execFileSync('python3', ['-c', `
import json
from acquisition.event_observation_service import prepare_observation
from tests.test_canonical_events import game, shot
print(json.dumps([
  prepare_observation(game([shot()]), '2026-01-01T00:00:00Z'),
  prepare_observation(game([shot(typeCode=505)]), '2026-01-02T00:00:00Z'),
  prepare_observation(game([shot(),shot()]), '2026-01-03T00:00:00Z')
]))`], {cwd: new URL('../data-pipeline/', import.meta.url), env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'}, encoding: 'utf8'}));
let checks = 0;
const insert = async (table, row) => {
  const keys = Object.keys(row);
  await db.query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_,i)=>`$${i+1}`).join(',')})`, Object.values(row));
};
const rejected = async (action, pattern) => {await assert.rejects(action, pattern); checks++;};
await db.exec('SET ROLE anon');
await rejected(()=>db.query('SELECT snapshot_id FROM analytics_event_observation_sets'), /permission denied/);
await db.exec('RESET ROLE; SET ROLE service_role');
for (const [snapshot, events, manifest] of fixtures) {
  await insert('analytics_source_snapshots', snapshot);
  await rejected(()=>insert('analytics_event_observation_sets', manifest), /Incomplete or conflicting/);
  await insert('analytics_event_observations', events[0]);
  await rejected(()=>insert('analytics_event_observation_sets', {...manifest, excluded_events: 50}), /manifest/);
  await insert('analytics_event_observation_sets', manifest); checks++;
  await rejected(()=>insert('analytics_event_observations', {...events[0], event_id: 99}), /sealed/);
}
const {rows} = await db.query('SELECT status,count(*)::integer AS n FROM analytics_event_observation_sets GROUP BY status ORDER BY status');
assert.deepEqual(rows, [{status:'complete',n:2},{status:'quarantined',n:1}]); checks++;
for (const change of [
  evidence=>{evidence.complete='true';},
  evidence=>{evidence.game_id=String(evidence.game_id);},
  evidence=>{evidence.excluded={malformed:-1};},
  evidence=>{evidence.excluded={malformed:'0'};},
  evidence=>{evidence.events=null;},
]) {
  const [snapshot,,manifest]=structuredClone(fixtures[0]);
  snapshot.id=randomUUID(); change(snapshot.payload.normalization);
  await insert('analytics_source_snapshots',snapshot);
  await rejected(()=>insert('analytics_event_observation_sets',{...manifest,snapshot_id:snapshot.id}),/typed source evidence|nonnegative JSON integers/);
}
// A self-consistent event manifest may still belong to the wrong game.
const [otherSource,otherEvents,otherManifest]=structuredClone(fixtures[0]);
otherSource.id=randomUUID();
otherSource.payload.normalization.events[0].game_id+=1;
otherEvents[0].game_id+=1; otherEvents[0].snapshot_id=otherSource.id;
await insert('analytics_source_snapshots',otherSource);
await insert('analytics_event_observations',otherEvents[0]);
await rejected(()=>insert('analytics_event_observation_sets',{...otherManifest,snapshot_id:otherSource.id}),/game does not match/);
await db.exec('RESET ROLE');
await rejected(()=>db.query('UPDATE analytics_event_observations SET x_raw=1'), /immutable/);
await rejected(()=>db.query('DELETE FROM analytics_event_observation_sets'), /immutable/);
await db.close();
console.log(`canonical observations: ${checks} checks passed (isolated PGlite)`);
