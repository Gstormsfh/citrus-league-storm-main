-- Backfill fantasy_daily_rosters for Dec 15-21, 2025 (Genesis Week)
-- Uses CROSS JOIN LATERAL with generate_series for efficient row generation
-- All rosters are locked since games are completed
-- This establishes the "Record of Truth" for the first matchup week
--
-- DEFENSIVE CHECKS:
-- - Only processes matchups with valid week dates
-- - Skips teams without lineups
-- - Handles NULL arrays gracefully
-- - Uses ON CONFLICT to prevent duplicates

-- 1. Insert active players (starters)
INSERT INTO public.fantasy_daily_rosters (
  league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
)
SELECT 
  m.league_id,
  t.id AS team_id,
  m.id AS matchup_id,
  (jsonb_array_elements_text(tl.starters)::integer) AS player_id,
  d.roster_date,
  'active' AS slot_type,
  tl.slot_assignments->>(jsonb_array_elements_text(tl.starters)::text) AS slot_id,
  true AS is_locked
FROM matchups m
JOIN teams t ON (t.id = m.team1_id OR t.id = m.team2_id)
JOIN team_lineups tl ON tl.team_id = t.id AND tl.league_id = m.league_id
CROSS JOIN LATERAL generate_series('2025-12-15'::date, '2025-12-21'::date, '1 day'::interval) AS d(roster_date)
WHERE m.week_start_date = '2025-12-15' 
  AND m.week_end_date = '2025-12-21'
  AND tl.starters IS NOT NULL
  AND jsonb_array_length(tl.starters) > 0
ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO UPDATE 
SET is_locked = true, updated_at = NOW();

-- 2. Insert bench players
INSERT INTO public.fantasy_daily_rosters (
  league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
)
SELECT 
  m.league_id,
  t.id AS team_id,
  m.id AS matchup_id,
  (jsonb_array_elements_text(tl.bench)::integer) AS player_id,
  d.roster_date,
  'bench' AS slot_type,
  NULL AS slot_id,
  true AS is_locked
FROM matchups m
JOIN teams t ON (t.id = m.team1_id OR t.id = m.team2_id)
JOIN team_lineups tl ON tl.team_id = t.id AND tl.league_id = m.league_id
CROSS JOIN LATERAL generate_series('2025-12-15'::date, '2025-12-21'::date, '1 day'::interval) AS d(roster_date)
WHERE m.week_start_date = '2025-12-15' 
  AND m.week_end_date = '2025-12-21'
  AND tl.bench IS NOT NULL
  AND jsonb_array_length(tl.bench) > 0
ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO UPDATE 
SET is_locked = true, updated_at = NOW();

-- 3. Insert IR players
INSERT INTO public.fantasy_daily_rosters (
  league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
)
SELECT 
  m.league_id,
  t.id AS team_id,
  m.id AS matchup_id,
  (jsonb_array_elements_text(tl.ir)::integer) AS player_id,
  d.roster_date,
  'ir' AS slot_type,
  tl.slot_assignments->>(jsonb_array_elements_text(tl.ir)::text) AS slot_id,
  true AS is_locked
FROM matchups m
JOIN teams t ON (t.id = m.team1_id OR t.id = m.team2_id)
JOIN team_lineups tl ON tl.team_id = t.id AND tl.league_id = m.league_id
CROSS JOIN LATERAL generate_series('2025-12-15'::date, '2025-12-21'::date, '1 day'::interval) AS d(roster_date)
WHERE m.week_start_date = '2025-12-15' 
  AND m.week_end_date = '2025-12-21'
  AND tl.ir IS NOT NULL
  AND jsonb_array_length(tl.ir) > 0
ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO UPDATE 
SET is_locked = true, updated_at = NOW();

COMMENT ON TABLE public.fantasy_daily_rosters IS 'Daily roster snapshots for fantasy matchups. Dec 15-21, 2025 is the Genesis Week - the immutable foundation for scoring.';
