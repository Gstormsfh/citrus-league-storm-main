import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const migrations = [
  '20260912073140_canonical_projection_runs.sql',
  '20260912073240_canonical_projection_materialization.sql',
  '20260912073340_canonical_projection_refresh.sql',
  '20260912073540_canonical_projection_write_boundary.sql',
  '20260912101242_canonical_plus_minus_propagation.sql',
  '20260913225708_canonical_organization_prior_remaining.sql',
].map(name => readFileSync(`supabase/migrations/${name}`, 'utf8'));

async function setup() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE player_directory(player_id bigint,season int,team_abbrev text);
    INSERT INTO player_directory VALUES(1,2026,'A'),(2,2026,'B'),(3,2026,'A');
    CREATE TABLE nhl_games(game_id bigint,season int,game_type text,home_team text,away_team text,home_team_id int,away_team_id int,game_date date);
    INSERT INTO nhl_games VALUES(2026020001,2026,'regular','A','B',1,2,current_date),(2026020002,2026,'regular','B','A',2,1,current_date+1);
    CREATE TABLE player_game_stats(player_id bigint,game_id bigint,icetime_seconds int,nhl_toi_seconds int,goalie_gp int);
    CREATE FUNCTION project_ros(integer) RETURNS TABLE(player_id integer,exp_gp numeric) LANGUAGE sql AS $$SELECT 1,2$$;
    CREATE FUNCTION project_rookies(integer) RETURNS TABLE(player_id integer,exp_gp numeric) LANGUAGE sql AS $$SELECT 3,2$$;
    CREATE FUNCTION get_season_game_count(integer) RETURNS integer LANGUAGE sql AS $$SELECT 2$$;
    CREATE FUNCTION rebuild_ros_projections(integer) RETURNS TABLE(rows_written integer,skaters integer,goalies integer,target_games integer) LANGUAGE sql AS $$SELECT 0,0,0,2$$;
    CREATE FUNCTION rebuild_player_projected_stats(integer) RETURNS TABLE(rows_written integer,players integer,games integer) LANGUAGE sql AS $$SELECT 0,0,0$$;
  `);
  // Derive compatibility-table columns from the actual materializer rather than
  // weakening or replacing the production validator/materializer in this test.
  for (const table of ['player_ros_projections', 'player_projected_stats']) {
    const cols = migrations[1].match(new RegExp(`INSERT INTO public.${table}\\(([^)]+)\\)`))[1]
      .split(',').map(x => x.trim()).filter(x => !['projection_run_id', 'projection_revision'].includes(x));
    const ints = ['player_id', 'season', 'games_played', 'game_id', 'opponent_team_id'];
    const bools = ['is_goalie', 'is_home_game'];
    const times = ['created_at', 'updated_at'];
    const texts = ['player_name', 'team_abbrev', 'position', 'calculation_method', 'opponent_abbrev'];
    await db.exec(`CREATE TABLE ${table}(${cols.map(c => `${c} ${ints.includes(c) ? 'bigint' : bools.includes(c) ? 'boolean' : times.includes(c) ? 'timestamptz' : texts.includes(c) ? 'text' : c === 'projection_date' ? 'date' : 'numeric'}`).join(',')})`);
  }
  await db.exec(`CREATE FUNCTION get_ros_projections(integer[]) RETURNS TABLE(games_remaining integer) LANGUAGE plpgsql AS $$BEGIN RETURN QUERY SELECT r.games_remaining FROM player_ros_projections r WHERE r.player_id=ANY($1); END$$;`);
  for (const sql of migrations) await db.exec(`BEGIN;\n${sql}\nCOMMIT;`);
  const today = (await db.query("select current_date::text as reviewed_date")).rows[0].reviewed_date;
  const goalie = (id, team) => ({ player_id: String(id), name: `goalie${id}`, position: 'G', team, is_goalie: true,
    status: 'projected', availability: { status: 'unknown' }, sources: [{ fixture: 'synthetic' }],
    rate_policy: 'preserve_override', exposure_policy: 'preserve_season_override', exposure: { used: 2, unit: 'starts' },
    rates: { wins: .5, saves: 25, shutouts: .1, goals_against: 2 }, counts: { wins: 1, saves: 50, shutouts: .2, goals_against: 4 } });
  const rates = { goals: 2, assists: 1, shots_on_goal: 3, blocks: 1, power_play_points: .2, short_handed_points: 0, hits: 1, penalty_minutes: 1, plus_minus: -.2 };
  const prospect = { player_id: '3', name: 'synthetic prospect', position: 'C', team: 'A', is_goalie: false,
    status: 'projected', availability: { status: 'unknown' }, sources: [{ fixture: 'synthetic' }],
    rate_policy: 'preserve_override', exposure_policy: 'organization_prior_remaining',
    exposure: { kind: 'model_prior', unit: 'games', used: .75, roster_probability: null, probability_semantics: 'already_in_exposure' }, rates,
    counts: Object.fromEntries(Object.entries(rates).map(([k, v]) => [k, v * .75])),
    opportunity_prior: { method: 'synthetic_measured_cohort', measured_season: 2025, cohort_count: 25,
      prior_nhl_gp_min: 0, prior_nhl_gp_max: 24, draft_band: 'synthetic', unscaled_gp: 1.5,
      cohort_schedule_games: 2, pre_cap_gp: 1.5, allocation_factor: .5, final_gp: .75,
      probability_semantics: 'already_in_exposure', as_of: today,
      evidence: [{ url: 'https://example.org/synthetic-fixture', date: today }], limitations: 'Synthetic test only; no guaranteed NHL role.' } };
  const payload = { schema_version: 'citrus.canonical-projection-inputs.v1', season: 2026, revision: 'a'.repeat(64),
    players: [goalie(1, 'A'), goalie(2, 'B'), prospect], scope_player_ids: ['1', '2', '3'], schedule: { A: 2, B: 2 },
    teams: [{ team: 'A', lineup_slots: [{ player_id: '1' }] }, { team: 'B', lineup_slots: [{ player_id: '2' }] }],
    publish_blockers: [], contract: { publication_ready: true } };
  const stage = async doc => (await db.query('select canonical_stage_projection_run($1) id', [JSON.stringify(doc)])).rows[0].id;
  const publish = async () => { const id = await stage(payload); await db.query('select canonical_activate_projection_run($1,$2)', [id, payload.revision]); return id; };
  const refresh = async () => (await db.query('select canonical_refresh_projection_run(2026) result')).rows[0].result;
  return { db, today, payload, prospect, stage, publish, refresh };
}

test('real validator rejects invalid provenance and workload derivations before activation', async () => {
  const { db, payload, stage } = await setup();
  try {
    const cases = [
      ['missing prior', p => delete p.opportunity_prior],
      ['goalie policy', p => { p.is_goalie = true; p.exposure.unit = 'starts'; }],
      ['refreshing rates', p => p.rate_policy = 'refresh_model'],
      ['non-prior exposure', p => p.exposure.kind = 'override'],
      ['missing exposure semantics', p => delete p.exposure.probability_semantics],
      ['second probability', p => p.roster_probability = .5],
      ['second exposure probability', p => p.exposure.roster_probability = .5],
      ['second prior probability', p => p.opportunity_prior.roster_probability = .5],
      ['bad semantics', p => p.opportunity_prior.probability_semantics = 'conditional'],
      ['unexpected metadata', p => p.opportunity_prior.unreviewed_probability = .5],
      ['credential URL', p => p.opportunity_prior.evidence[0].url = 'https://user:password@example.org/a'],
      ['blank method', p => p.opportunity_prior.method = ' '],
      ['blank limitations', p => p.opportunity_prior.limitations = ''],
      ['blank cohort', p => p.opportunity_prior.draft_band = ''],
      ['small cohort', p => p.opportunity_prior.cohort_count = 19],
      ['fractional cohort', p => p.opportunity_prior.cohort_count = 25.5],
      ['current-season cohort', p => p.opportunity_prior.measured_season = 2026],
      ['reversed cohort bounds', p => p.opportunity_prior.prior_nhl_gp_min = 25],
      ['negative cohort bound', p => p.opportunity_prior.prior_nhl_gp_min = -1],
      ['zero denominator', p => p.opportunity_prior.cohort_schedule_games = 0],
      ['invalid numeric type', p => p.opportunity_prior.unscaled_gp = '1.5'],
      ['impossible baseline', p => p.opportunity_prior.unscaled_gp = 3],
      ['inflated allocation', p => p.opportunity_prior.allocation_factor = 1.1],
      ['negative allocation', p => p.opportunity_prior.allocation_factor = -.1],
      ['unscaled derivation mismatch', p => p.opportunity_prior.pre_cap_gp = 1],
      ['final derivation mismatch', p => p.opportunity_prior.final_gp = .5],
      ['exposure mismatch', p => p.exposure.used = 1],
      ['future review', p => p.opportunity_prior.as_of = '2999-01-01'],
      ['invalid date', p => p.opportunity_prior.as_of = '2026-02-30'],
      ['empty evidence', p => p.opportunity_prior.evidence = []],
      ['HTTP evidence', p => p.opportunity_prior.evidence[0].url = 'http://example.org'],
      ['undated evidence', p => delete p.opportunity_prior.evidence[0].date],
      ['future evidence', p => p.opportunity_prior.evidence[0].date = '2999-01-01'],
    ];
    for (let i = 0; i < cases.length; i++) {
      const [name, mutate] = cases[i]; const doc = structuredClone(payload);
      doc.revision = (i + 1).toString(16).padStart(64, '0'); mutate(doc.players[2]);
      const id = await stage(doc);
      const report = (await db.query('select canonical_validate_projection_run($1) result', [id])).rows[0].result;
      assert.equal(report.valid, false, name);
      assert.ok(report.errors.some(e => e.code === 'INVALID_PLAYER' && e.player_id === '3'), `${name}: ${JSON.stringify(report)}`);
    }
    assert.equal((await db.query('select count(*)::int n from canonical_projection_active')).rows[0].n, 0);
    await db.exec('SET ROLE authenticated');
    await assert.rejects(db.query('select canonical_validate_opportunity_prior($1,2,2026)', [JSON.stringify(payload.players[2])]), /permission denied/);
  } finally { await db.close(); }
});

test('no-game prospect decays once by schedule; materialization and repeated refresh preserve source and probability', async () => {
  const { db, payload, publish, refresh } = await setup();
  try {
    const source = structuredClone(payload); const sourceId = await publish();
    await db.exec('update nhl_games set game_date=current_date-1 where game_id=2026020001');
    for (let i = 0; i < 2; i++) {
      const result = await refresh(); assert.notEqual(result.status, 'failed', JSON.stringify(result));
      const p = (await db.query("select payload from canonical_published_players where player_id='3'")).rows[0].payload;
      assert.deepEqual(p.exposure, source.players[2].exposure);
      assert.deepEqual(p.opportunity_prior, source.players[2].opportunity_prior);
      assert.deepEqual(p.rates, source.players[2].rates);
      assert.equal(p.remaining.used, .375); assert.equal(p.remaining.actual_gp, null);
      assert.equal(p.remaining.method, 'organization_prior_remaining');
      assert.equal(p.remaining.participation_semantics, 'not_used_by_prior');
      assert.equal(p.counts.goals, .75); assert.equal(p.counts.plus_minus, -.075);
      const row = (await db.query('select games_remaining::float8 gp,games_played,projected_goals::float8 goals,projected_plus_minus::float8 pm from player_ros_projections where player_id=3')).rows[0];
      assert.deepEqual(row, { gp: .375, games_played: null, goals: .75, pm: -.075 });
      const daily = (await db.query('select sum(projected_gp)::float8 gp,sum(projected_goals)::float8 goals,sum(projected_plus_minus)::float8 pm from player_projected_stats where player_id=3 and projection_date>=current_date')).rows[0];
      assert.deepEqual(daily, { gp: .375, goals: .75, pm: -.075 });
      const published = (await db.query('select source_run_id,source_payload from canonical_published_runs')).rows[0];
      assert.equal(published.source_run_id, sourceId); assert.deepEqual(published.source_payload, source);
      assert.equal((await db.query('select last_refresh_status from canonical_projection_active')).rows[0].last_refresh_status, 'success');
    }
    // Exhausted schedule yields authored numeric zero, not missing forecast.
    await db.exec('update nhl_games set game_date=current_date-1');
    assert.notEqual((await refresh()).status, 'failed');
    assert.equal((await db.query('select games_remaining::float8 gp from player_ros_projections where player_id=3')).rows[0].gp, 0);
    assert.equal((await db.query('select count(*)::int n from player_projected_stats where projection_date>=current_date')).rows[0].n, 0);
  } finally { await db.close(); }
});

test('existing override still fails on unknown ingestion, accepts explicit zero and subtracts actual appearances', async () => {
  const { db, prospect, publish, refresh } = await setup();
  try {
    prospect.exposure_policy = 'preserve_season_override';
    const original = await publish();
    await db.exec('update nhl_games set game_date=current_date-1 where game_id=2026020001');
    const failed = await refresh(); assert.equal(failed.status, 'failed'); assert.match(failed.error, /Actual participation unknown/);
    assert.equal((await db.query('select run_id from canonical_projection_active')).rows[0].run_id, original);
    // A supplied nonparticipation row is measured zero, unlike a missing row.
    await db.exec('insert into player_game_stats values(3,2026020001,0,0,0)');
    assert.notEqual((await refresh()).status, 'failed');
    let p = (await db.query("select payload from canonical_published_players where player_id='3'")).rows[0].payload;
    assert.equal(p.remaining.actual_gp, 0); assert.equal(p.remaining.used, .75);
    await db.exec('update player_game_stats set nhl_toi_seconds=600');
    assert.notEqual((await refresh()).status, 'failed');
    p = (await db.query("select payload from canonical_published_players where player_id='3'")).rows[0].payload;
    assert.equal(p.remaining.actual_gp, 1); assert.equal(p.remaining.used, 0);
  } finally { await db.close(); }
});

test('new policy cannot stage a fabricated remaining actual or apply probability twice', async () => {
  const { db, payload, stage } = await setup();
  try {
    const remaining = { used: .75, actual_gp: null, team_games: 2, as_of: '2026-09-13', method: 'organization_prior_remaining', participation_semantics: 'not_used_by_prior' };
    for (const [i, patch] of [{ actual_gp: 0 }, { used: .375 }, { team_games: 1 }, { method: 'preserve_season_override' }].entries()) {
      const doc = structuredClone(payload); doc.revision = (100 + i).toString(16).padStart(64, '0');
      doc.players[2].remaining = { ...remaining, ...patch };
      const report = (await db.query('select canonical_validate_projection_run($1) result', [await stage(doc)])).rows[0].result;
      assert.equal(report.valid, false); assert.match(JSON.stringify(report.errors), /Invalid remaining organization prior workload/);
    }
  } finally { await db.close(); }
});
