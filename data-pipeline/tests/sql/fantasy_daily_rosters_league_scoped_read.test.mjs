import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const migration = readFileSync('supabase/migrations/20260914170000_fantasy_daily_rosters_league_scoped_read.sql', 'utf8');
const DEMO = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9';
const LEAGUE_A = '00000000-0000-0000-0000-00000000000a';
const LEAGUE_B = '00000000-0000-0000-0000-00000000000b';
const OWNER_A = '00000000-0000-0000-0000-0000000000a1';
const OWNER_B = '00000000-0000-0000-0000-0000000000b1';

async function setup({wideFirst}) {
  const db = new PGlite();
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE TABLE auth.current(uid uuid);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT uid FROM auth.current LIMIT 1';
    CREATE TABLE public.teams(id uuid PRIMARY KEY, league_id uuid NOT NULL, owner_id uuid);
    CREATE TABLE public.fantasy_daily_rosters(
      id serial PRIMARY KEY, team_id uuid NOT NULL, league_id uuid NOT NULL,
      matchup_id uuid, player_id int, roster_date date);
    INSERT INTO public.teams VALUES
      ('00000000-0000-0000-0000-0000000000aa'::uuid, '${LEAGUE_A}', '${OWNER_A}'),
      ('00000000-0000-0000-0000-0000000000bb'::uuid, '${LEAGUE_B}', '${OWNER_B}'),
      ('00000000-0000-0000-0000-0000000000dd'::uuid, '${DEMO}', NULL);
    INSERT INTO public.fantasy_daily_rosters(team_id, league_id, player_id) VALUES
      ('00000000-0000-0000-0000-0000000000aa', '${LEAGUE_A}', 1),
      ('00000000-0000-0000-0000-0000000000bb', '${LEAGUE_B}', 2),
      ('00000000-0000-0000-0000-0000000000dd', '${DEMO}', 3);
    CREATE ROLE app_user NOLOGIN;
    GRANT USAGE ON SCHEMA public, auth TO app_user;
    GRANT SELECT ON public.teams, public.fantasy_daily_rosters, auth.current TO app_user;
    ALTER TABLE public.fantasy_daily_rosters ENABLE ROW LEVEL SECURITY;
  `);
  if (wideFirst) {
    // The 2026-03 state this migration exists to remove.
    await db.exec(`CREATE POLICY "Authenticated users can view all daily rosters"
      ON public.fantasy_daily_rosters FOR SELECT USING (true);`);
  }
  await db.exec(migration);
  const visibleTo = async uid => {
    await db.exec('DELETE FROM auth.current');
    if (uid) await db.query('INSERT INTO auth.current VALUES ($1)', [uid]);
    await db.exec('SET ROLE app_user');
    try {
      return (await db.query('SELECT player_id FROM public.fantasy_daily_rosters ORDER BY player_id')).rows.map(r => r.player_id);
    } finally {
      await db.exec('RESET ROLE');
    }
  };
  const policies = async () => (await db.query(
    `SELECT policyname FROM pg_policies WHERE tablename='fantasy_daily_rosters' AND cmd='SELECT' ORDER BY 1`)).rows.map(r => r.policyname);
  return {db, visibleTo, policies};
}

test('removes the USING (true) read policy and installs the league-scoped one', async () => {
  const {db, visibleTo, policies} = await setup({wideFirst: true});
  try {
    assert.deepEqual(await policies(), ['Users can view rosters in their leagues']);
    assert.deepEqual(await visibleTo(OWNER_A), [1, 3], 'league A owner sees league A and the demo league only');
    assert.deepEqual(await visibleTo(OWNER_B), [2, 3]);
    assert.deepEqual(await visibleTo(null), [3], 'a guest sees only the demo league');
  } finally { await db.close(); }
});

test('is idempotent on an environment that already carries the scoped policy (production state)', async () => {
  const {db, visibleTo, policies} = await setup({wideFirst: false});
  try {
    await db.exec(migration);
    assert.deepEqual(await policies(), ['Users can view rosters in their leagues']);
    assert.deepEqual(await visibleTo(OWNER_A), [1, 3]);
  } finally { await db.close(); }
});
