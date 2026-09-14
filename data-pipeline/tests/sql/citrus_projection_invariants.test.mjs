import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const migration = readFileSync('supabase/migrations/20260914190000_citrus_projection_invariants.sql', 'utf8');
const RUN = '00000000-0000-0000-0000-0000000000f1';

async function setup() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE canonical_projection_runs(id uuid PRIMARY KEY, season int, payload jsonb);
    CREATE TABLE canonical_projection_active(season int PRIMARY KEY, run_id uuid);
    CREATE TABLE canonical_published_players(season int, player_id text, payload jsonb);
    CREATE TABLE player_ros_projections(season int, player_id int, team_abbrev text, is_goalie boolean, games_remaining numeric);
    CREATE TABLE nhl_games(game_id serial, season int, game_type text, home_team text, away_team text, game_date date);
  `);
  await db.exec(migration);
  const run = async () => (await db.query('SELECT check_name, status, measured FROM citrus_projection_invariants() ORDER BY check_name')).rows;
  const statuses = async () => Object.fromEntries((await run()).map(r => [r.check_name, r.status]));
  return {db, run, statuses};
}

/** Two teams, four future regular-season games each (two head-to-head pairs, twice). */
async function publish(db, {crease = [4, 4], modelUsed = 3, provenance = 'MODEL'} = {}) {
  await db.exec(`
    INSERT INTO canonical_projection_runs VALUES ('${RUN}', 2026, '{"schedule": {"AAA": 4, "BBB": 4}}');
    INSERT INTO canonical_projection_active VALUES (2026, '${RUN}');
    INSERT INTO nhl_games(season, game_type, home_team, away_team, game_date) VALUES
      (2026,'regular','AAA','BBB',CURRENT_DATE + 1), (2026,'regular','BBB','AAA',CURRENT_DATE + 2),
      (2026,'regular','AAA','BBB',CURRENT_DATE + 3), (2026,'regular','BBB','AAA',CURRENT_DATE + 4),
      (2026,'playoff','AAA','BBB',CURRENT_DATE + 30);
    INSERT INTO player_ros_projections VALUES
      (2026, 1, 'AAA', true, ${crease[0]}), (2026, 2, 'BBB', true, ${crease[1]}), (2026, 3, 'AAA', false, 4);
    INSERT INTO canonical_published_players VALUES
      (2026, '3', '{"team":"AAA","is_goalie":false,"provenance":"${provenance}","status":"projected","exposure":{"used":${modelUsed}}}'),
      (2026, '1', '{"team":"AAA","is_goalie":true,"provenance":"MODEL","status":"projected","exposure":{"used":4}}');
  `);
}

test('warns, not fails, when nothing is published yet', async () => {
  const {db, run} = await setup();
  try {
    const rows = await run();
    assert.deepEqual(rows.map(r => [r.check_name, r.status]), [['projection_publication_active', 'warn']]);
  } finally { await db.close(); }
});

test('a clean publication passes all four checks', async () => {
  const {db, statuses} = await setup();
  try {
    await publish(db);
    assert.deepEqual(await statuses(), {
      crease_conserved_in_serving_table: 'pass',
      published_schedule_matches_nhl_games: 'pass',
      model_exposure_within_ceiling: 'pass',
      published_rows_carry_provenance: 'pass',
    });
  } finally { await db.close(); }
});

test('a goalie moved after publication breaks the crease in the serving table', async () => {
  const {db, run} = await setup();
  try {
    await publish(db, {crease: [4, 3.5]});
    const row = (await run()).find(r => r.check_name === 'crease_conserved_in_serving_table');
    assert.equal(row.status, 'fail');
    assert.match(row.measured, /BBB 3\.500\/4/);
  } finally { await db.close(); }
});

test('a schedule change after publication is drift, and playoff games never count', async () => {
  const {db, run} = await setup();
  try {
    await publish(db);
    await db.exec(`INSERT INTO nhl_games(season, game_type, home_team, away_team, game_date) VALUES (2026,'regular','AAA','BBB',CURRENT_DATE + 5)`);
    const rows = await run();
    const sched = rows.find(r => r.check_name === 'published_schedule_matches_nhl_games');
    assert.equal(sched.status, 'fail');
    assert.match(sched.measured, /AAA 4\/5/);
    // and the serving crease is now short one game per team too
    assert.equal(rows.find(r => r.check_name === 'crease_conserved_in_serving_table').status, 'fail');
  } finally { await db.close(); }
});

test('a MODEL skater at the full schedule fails the ceiling; MANUAL at the full schedule does not', async () => {
  const {db, statuses} = await setup();
  try {
    await publish(db, {modelUsed: 4});
    assert.equal((await statuses()).model_exposure_within_ceiling, 'fail');
    await db.exec(`UPDATE canonical_published_players SET payload = jsonb_set(payload, '{provenance}', '"MANUAL"') WHERE player_id = '3'`);
    assert.equal((await statuses()).model_exposure_within_ceiling, 'pass');
  } finally { await db.close(); }
});

test('a published row without provenance fails rule 5', async () => {
  const {db, statuses} = await setup();
  try {
    await publish(db);
    await db.exec(`INSERT INTO canonical_published_players VALUES (2026, '9', '{"team":"BBB","is_goalie":false,"status":"rates_only"}')`);
    assert.equal((await statuses()).published_rows_carry_provenance, 'fail');
  } finally { await db.close(); }
});

test('only the service role may run it', async () => {
  const {db} = await setup();
  try {
    await db.exec('SET ROLE authenticated');
    await assert.rejects(db.query('SELECT * FROM citrus_projection_invariants()'), /permission denied/);
    await db.exec('RESET ROLE');
  } finally { await db.close(); }
});
