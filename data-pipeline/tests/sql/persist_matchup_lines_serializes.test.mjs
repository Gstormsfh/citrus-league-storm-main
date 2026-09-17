import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

// PGlite is single-connection, so the two-session interleaving the migration
// fixes cannot be reproduced here. What can be pinned: the lock is taken, it
// is keyed per matchup, it sits between the matchup lookup and the DELETE,
// grants stay owner+service_role, and serial re-runs remain idempotent.
const migration = readFileSync('supabase/migrations/20260914171000_persist_matchup_lines_serializes_per_matchup.sql', 'utf8');
const MATCHUP = '00000000-0000-0000-0000-0000000000f1';
const LEAGUE = '00000000-0000-0000-0000-0000000000aa';
const T1 = '00000000-0000-0000-0000-0000000000a1';
const T2 = '00000000-0000-0000-0000-0000000000a2';

async function setup() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE matchups(id uuid PRIMARY KEY, league_id uuid, team1_id uuid, team2_id uuid, week_start_date date, week_end_date date);
    CREATE TABLE fantasy_matchup_lines(id serial PRIMARY KEY, matchup_id uuid, player_id int, team_id uuid,
      total_points numeric, stats_breakdown jsonb, games_played int, UNIQUE(matchup_id, player_id));
    CREATE TABLE fantasy_daily_rosters(matchup_id uuid, team_id uuid, player_id int, slot_type text, roster_date date);
    CREATE TABLE player_game_stats(player_id int, game_id int, game_date date);
    CREATE TABLE nhl_games(game_id int, game_type text);
    CREATE VIEW v_player_game_stat_long AS
      SELECT game_id, player_id, 'goals'::text AS stat_key, 1::numeric AS value FROM player_game_stats;
    CREATE FUNCTION get_effective_scoring_rules(p_league uuid) RETURNS TABLE(stat_key text, multiplier numeric)
      LANGUAGE sql AS $$ SELECT 'goals'::text, 6::numeric $$;
    INSERT INTO matchups VALUES ('${MATCHUP}', '${LEAGUE}', '${T1}', '${T2}', '2026-10-05', '2026-10-11');
    INSERT INTO fantasy_daily_rosters VALUES ('${MATCHUP}', '${T1}', 101, 'active', '2026-10-06'), ('${MATCHUP}', '${T2}', 202, 'active', '2026-10-06');
    INSERT INTO player_game_stats VALUES (101, 9001, '2026-10-06'), (202, 9002, '2026-10-06');
    INSERT INTO nhl_games VALUES (9001, 'regular'), (9002, 'regular');
  `);
  await db.exec(migration);
  return db;
}

test('takes a per-matchup transaction advisory lock between the lookup and the delete', async () => {
  const db = await setup();
  try {
    const def = (await db.query(`SELECT pg_get_functiondef('public.persist_matchup_lines(uuid)'::regprocedure) AS d`)).rows[0].d;
    const lockAt = def.indexOf('pg_advisory_xact_lock');
    const lookupAt = def.indexOf('into m from matchups');
    const deleteAt = def.indexOf('delete from fantasy_matchup_lines');
    assert.ok(lockAt > 0, 'advisory lock present');
    assert.ok(lookupAt < lockAt && lockAt < deleteAt, 'lock sits after the matchup lookup and before the delete');
    assert.match(def, /hashtextextended\('persist_matchup_lines:' \|\| p_matchup_id::text, 0\)/, 'keyed per matchup');
    assert.match(def, /SECURITY DEFINER/);
    assert.match(def, /SET search_path TO 'public'/);
  } finally { await db.close(); }
});

test('serial re-runs are idempotent and the lock is released at statement commit', async () => {
  const db = await setup();
  try {
    const first = (await db.query('SELECT persist_matchup_lines($1) AS n', [MATCHUP])).rows[0].n;
    const second = (await db.query('SELECT persist_matchup_lines($1) AS n', [MATCHUP])).rows[0].n;
    assert.equal(first, 2);
    assert.equal(second, 2);
    const rows = (await db.query('SELECT player_id, team_id, total_points::float8 AS pts, games_played FROM fantasy_matchup_lines ORDER BY player_id')).rows;
    assert.deepEqual(rows, [
      {player_id: 101, team_id: T1, pts: 6, games_played: 1},
      {player_id: 202, team_id: T2, pts: 6, games_played: 1},
    ]);
    const held = (await db.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'`)).rows[0].n;
    assert.equal(held, 0, 'no advisory lock outlives the transaction');
  } finally { await db.close(); }
});
