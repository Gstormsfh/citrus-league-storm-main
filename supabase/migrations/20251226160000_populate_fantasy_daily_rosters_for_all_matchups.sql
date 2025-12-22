-- Populate fantasy_daily_rosters for all existing matchups
-- This ensures calculate_daily_matchup_scores RPC has data to work with
-- CRITICAL: Without this data, all scores will be 0

-- First, populate active players from team_lineups.starters
INSERT INTO public.fantasy_daily_rosters (
  league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
)
SELECT 
  m.league_id,
  t.id AS team_id,
  m.id AS matchup_id,
  starter_id::integer AS player_id,
  d.roster_date,
  'active' AS slot_type,
  tl.slot_assignments->>(starter_id::text) AS slot_id,
  CASE 
    WHEN d.roster_date < CURRENT_DATE THEN true 
    ELSE false 
  END AS is_locked
FROM matchups m
JOIN teams t ON (t.id = m.team1_id OR t.id = m.team2_id)
JOIN team_lineups tl ON tl.team_id = t.id AND tl.league_id = m.league_id
CROSS JOIN LATERAL generate_series(m.week_start_date, m.week_end_date, '1 day'::interval) AS d(roster_date)
CROSS JOIN LATERAL jsonb_array_elements_text(tl.starters) AS starter_id
WHERE tl.starters IS NOT NULL
  AND jsonb_array_length(tl.starters) > 0
  AND NOT EXISTS (
    SELECT 1 FROM fantasy_daily_rosters fdr
    WHERE fdr.team_id = t.id
      AND fdr.matchup_id = m.id
      AND fdr.player_id = starter_id::integer
      AND fdr.roster_date = d.roster_date
  )
ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO NOTHING;

-- Populate bench players from team_lineups.bench
INSERT INTO public.fantasy_daily_rosters (
  league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
)
SELECT 
  m.league_id,
  t.id AS team_id,
  m.id AS matchup_id,
  bench_id::integer AS player_id,
  d.roster_date,
  'bench' AS slot_type,
  NULL AS slot_id,
  CASE 
    WHEN d.roster_date < CURRENT_DATE THEN true 
    ELSE false 
  END AS is_locked
FROM matchups m
JOIN teams t ON (t.id = m.team1_id OR t.id = m.team2_id)
JOIN team_lineups tl ON tl.team_id = t.id AND tl.league_id = m.league_id
CROSS JOIN LATERAL generate_series(m.week_start_date, m.week_end_date, '1 day'::interval) AS d(roster_date)
CROSS JOIN LATERAL jsonb_array_elements_text(tl.bench) AS bench_id
WHERE tl.bench IS NOT NULL
  AND jsonb_array_length(tl.bench) > 0
  AND NOT EXISTS (
    SELECT 1 FROM fantasy_daily_rosters fdr
    WHERE fdr.team_id = t.id
      AND fdr.matchup_id = m.id
      AND fdr.player_id = bench_id::integer
      AND fdr.roster_date = d.roster_date
  )
ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO NOTHING;

-- Populate IR players from team_lineups.ir
INSERT INTO public.fantasy_daily_rosters (
  league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
)
SELECT 
  m.league_id,
  t.id AS team_id,
  m.id AS matchup_id,
  ir_id::integer AS player_id,
  d.roster_date,
  'ir' AS slot_type,
  NULL AS slot_id,
  CASE 
    WHEN d.roster_date < CURRENT_DATE THEN true 
    ELSE false 
  END AS is_locked
FROM matchups m
JOIN teams t ON (t.id = m.team1_id OR t.id = m.team2_id)
JOIN team_lineups tl ON tl.team_id = t.id AND tl.league_id = m.league_id
CROSS JOIN LATERAL generate_series(m.week_start_date, m.week_end_date, '1 day'::interval) AS d(roster_date)
CROSS JOIN LATERAL jsonb_array_elements_text(tl.ir) AS ir_id
WHERE tl.ir IS NOT NULL
  AND jsonb_array_length(tl.ir) > 0
  AND NOT EXISTS (
    SELECT 1 FROM fantasy_daily_rosters fdr
    WHERE fdr.team_id = t.id
      AND fdr.matchup_id = m.id
      AND fdr.player_id = ir_id::integer
      AND fdr.roster_date = d.roster_date
  )
ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO NOTHING;

-- Log summary
DO $$
DECLARE
  v_total_count INTEGER;
  v_active_count INTEGER;
  v_bench_count INTEGER;
  v_ir_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_total_count FROM fantasy_daily_rosters;
  SELECT COUNT(*) INTO v_active_count FROM fantasy_daily_rosters WHERE slot_type = 'active';
  SELECT COUNT(*) INTO v_bench_count FROM fantasy_daily_rosters WHERE slot_type = 'bench';
  SELECT COUNT(*) INTO v_ir_count FROM fantasy_daily_rosters WHERE slot_type = 'ir';
  
  RAISE NOTICE 'fantasy_daily_rosters populated: Total=%, Active=%, Bench=%, IR=%', 
    v_total_count, v_active_count, v_bench_count, v_ir_count;
END $$;

COMMENT ON TABLE fantasy_daily_rosters IS 'Populated for all matchups. This migration ensures calculate_daily_matchup_scores RPC has data to calculate scores. Without this data, scores will be 0.';

