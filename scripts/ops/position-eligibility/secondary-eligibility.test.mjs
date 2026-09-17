import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const primaryMigration = read('../../../supabase/migrations/20260913231943_governed_primary_position_corrections.sql');
const restoreMigration = read('../../../supabase/migrations/20260914010154_position_override_return_to_feed.sql');
const secondaryMigration = read('../../../supabase/migrations/20260914180000_governed_secondary_eligibility.sql');
const zuccarello = read('./restore-zuccarello-nhl-baseline-with-rw-grant.sql');

async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE player_directory(season int,player_id int,full_name text,team_abbrev text,position_code text,is_goalie boolean,jersey_number text,headshot_url text,shoots_catches text,created_at timestamptz,updated_at timestamptz,height_in int,weight_lb int,birthdate date,nationality text,college_team text,prior_team text,bio_summary text,notes text,source_last_fetched_at timestamptz,eligible_positions text,career jsonb,career_fetched_at timestamptz);
  CREATE TABLE canonical_projection_active(season int);
  CREATE TABLE canonical_published_players(season int,player_id text,payload jsonb);
  CREATE TABLE player_affiliation_events(id uuid,sequence bigint,season int,player_id int,recorded_at timestamptz,team_abbrev text,status text,authority text,effective_on date,organization text,source_urls jsonb,reason text);
  CREATE TABLE team_lineups(league_id uuid,team_id uuid,starters jsonb,slot_assignments jsonb);
  CREATE TABLE fantasy_daily_rosters(player_id int,roster_date date,slot_type text,slot_id text);
  GRANT SELECT ON player_directory,canonical_projection_active,canonical_published_players,player_affiliation_events TO authenticated,service_role;
  INSERT INTO player_directory(season,player_id,full_name,position_code,is_goalie,eligible_positions,team_abbrev) VALUES
    (2026,1,'Skater One','C',false,'C','EDM'),
    (2026,2,'Goalie Two','G',true,'G','WPG'),
    (2026,3,'Sync Multi','LW',false,'LW,RW','TOR'),
    (2026,8475692,'Mats Zuccarello','C',false,NULL,'LAK');`);
  await db.exec(primaryMigration);
  await db.exec(restoreMigration);
  await db.exec(secondaryMigration);
  const directory = async ids => (await db.query(
    'SELECT player_id,position_code,eligible_positions,eligibility_events FROM player_current_directory WHERE season=2026 AND player_id = ANY($1) ORDER BY player_id', [ids])).rows;
  const grant = (id, pos, date = '2026-01-01') => db.query(
    `INSERT INTO player_eligibility_events(season,player_id,position_code,event_action,effective_on,source_urls,reason,recorded_by)
     VALUES(2026,$1,$2,'grant',$3,'["https://example.org/evidence"]','owner-approved secondary','test') RETURNING id`, [id, pos, date]);
  return { db, directory, grant };
}

test('eligibility resolves to primary plus active manual grants; raw sync cells are evidence only', async () => {
  const { db, directory, grant } = await setup();
  try {
    // Baseline: no grants → eligibility is exactly the primary. The sync-computed
    // 'LW,RW' cell on player 3 is NOT read (policy: no automatic grants).
    assert.deepEqual(await directory([1, 2, 3]), [
      { player_id: 1, position_code: 'C', eligible_positions: 'C', eligibility_events: [] },
      { player_id: 2, position_code: 'G', eligible_positions: 'G', eligibility_events: [] },
      { player_id: 3, position_code: 'LW', eligible_positions: 'LW', eligibility_events: [] },
    ]);

    // A grant adds the position; the primary stays first.
    const { rows: [{ id: lwGrant }] } = await grant(1, 'LW');
    let [one] = await directory([1]);
    assert.equal(one.eligible_positions, 'C,LW');
    assert.equal(one.eligibility_events.length, 1);
    assert.equal(one.eligibility_events[0].position, 'LW');
    assert.equal(one.eligibility_events[0].recorded_by, 'test');

    // A future-dated grant is not yet active.
    await grant(1, 'RW', '2099-01-01');
    [one] = await directory([1]);
    assert.equal(one.eligible_positions, 'C,LW');

    // A grant equal to the primary is a no-op on the string.
    await grant(1, 'C');
    [one] = await directory([1]);
    assert.equal(one.eligible_positions, 'C,LW');

    // Revoke must supersede the grant it revokes; then the position disappears.
    await assert.rejects(db.query(
      `INSERT INTO player_eligibility_events(season,player_id,position_code,event_action,effective_on,source_urls,reason,recorded_by)
       VALUES(2026,1,'LW','revoke','2026-02-01','["https://example.org"]','x','test')`), /revoke_requires_grant/);
    await db.query(
      `INSERT INTO player_eligibility_events(season,player_id,position_code,event_action,effective_on,source_urls,reason,recorded_by,supersedes)
       VALUES(2026,1,'LW','revoke','2026-02-01','["https://example.org"]','role changed','test',$1)`, [lwGrant]);
    [one] = await directory([1]);
    assert.equal(one.eligible_positions, 'C');
    // the redundant C grant is still an active recorded event; LW is gone
    assert.deepEqual(one.eligibility_events.map(e => e.position), ['C']);

    // Ingestion rewriting the raw cell cannot add or remove eligibility.
    await db.exec("UPDATE player_directory SET eligible_positions='C,LW,RW,D' WHERE player_id=1");
    [one] = await directory([1]);
    assert.equal(one.eligible_positions, 'C');

    // A reviewed primary change reorders: reviewed primary first, then the
    // active grants (the earlier C grant now counts as a secondary).
    await grant(1, 'RW');
    await db.query(`INSERT INTO player_position_events(season,player_id,position_code,feed_position_at_review,effective_on,source_urls,reason,recorded_by)
      VALUES(2026,1,'LW','C','2026-03-01','["https://example.org/official"]','reviewed','test')`);
    [one] = await directory([1]);
    assert.deepEqual([one.position_code, one.eligible_positions], ['LW', 'LW,C,RW']);

    // Goalies never gain skater eligibility from a grant.
    await grant(2, 'D');
    const [two] = await directory([2]);
    assert.equal(two.eligible_positions, 'G');
  } finally { await db.close(); }
});

test('event store is append-only and closed to client roles', async () => {
  const { db, grant } = await setup();
  try {
    await grant(1, 'LW');
    await db.exec('SET ROLE authenticated');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM player_eligibility_events')).rows[0].n, 1, 'evidence is readable');
    await assert.rejects(grant(1, 'RW'), /permission denied/);
    await db.exec('RESET ROLE; SET ROLE service_role;');
    await assert.rejects(db.exec("UPDATE player_eligibility_events SET position_code='D'"), /permission denied/);
    await assert.rejects(db.exec('DELETE FROM player_eligibility_events'), /permission denied/);
    await db.exec('RESET ROLE');
    await assert.rejects(db.query(
      `INSERT INTO player_eligibility_events(season,player_id,position_code,event_action,effective_on,source_urls,reason,recorded_by)
       VALUES(2026,1,'F','grant','2026-01-01','["https://x"]','x','test')`), /check constraint|violates/);
  } finally { await db.close(); }
});

test('Zuccarello script: restore official C and grant RW atomically, guarded by pre/post-image', async () => {
  const { db, directory } = await setup();
  try {
    // Reproduce the production pre-image: the 2026-09-13 RW primary correction
    // with the recorded event id, and one saved lineup at RW.
    await db.query(`INSERT INTO player_position_events(id,season,player_id,position_code,feed_position_at_review,effective_on,source_urls,reason,recorded_by)
      VALUES('76fa0e35-6a56-45ab-99b9-aaee6c8782ea',2026,8475692,'RW','C','2026-09-13','["https://www.nhlpa.com/player/701/mats-zuccarello/"]','NHLPA','review')`);
    await db.exec(`INSERT INTO team_lineups(starters,slot_assignments) VALUES('[8475692]','{"8475692":"slot-RW-1"}')`);
    assert.deepEqual((await directory([8475692])).map(r => [r.position_code, r.eligible_positions]), [['RW', 'RW']]);

    await db.exec(zuccarello);
    const [z] = await directory([8475692]);
    assert.equal(z.position_code, 'C', 'official baseline restored');
    assert.equal(z.eligible_positions, 'C,RW', 'RW survives as a recorded grant');
    assert.equal(z.eligibility_events[0].recorded_by, 'owner-decision-position-policy-2026-09-14');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM player_position_events WHERE player_id=8475692')).rows[0].n, 2, 'history retained');
    assert.deepEqual((await db.query('SELECT slot_assignments FROM team_lineups')).rows[0].slot_assignments, { '8475692': 'slot-RW-1' }, 'saved roster untouched');

    // Re-running is refused: the pre-image has moved on.
    await assert.rejects(db.exec(zuccarello), /preimage changed/);
    await db.exec('ROLLBACK');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM player_eligibility_events')).rows[0].n, 1);
  } finally { await db.close(); }
});
