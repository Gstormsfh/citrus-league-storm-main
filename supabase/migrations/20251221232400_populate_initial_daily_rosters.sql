-- Populate initial daily rosters for existing matchups
-- Uses current lineup state for all days (best guess for historical data)
-- For future weeks, this will be updated when users save their lineups

INSERT INTO public.fantasy_daily_rosters (
  league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
)
SELECT 
  m.league_id,
  t.id AS team_id,
  m.id AS matchup_id,
  (jsonb_array_elements_text(tl.starters)::integer) AS player_id,
  generate_series(m.week_start_date, m.week_end_date, '1 day'::interval)::DATE AS roster_date,
  'active' AS slot_type,
  tl.slot_assignments->>(jsonb_array_elements_text(tl.starters)::text) AS slot_id,
  false AS is_locked
FROM matchups m
JOIN teams t ON (t.id = m.team1_id OR t.id = m.team2_id)
JOIN team_lineups tl ON tl.team_id = t.id::text AND tl.league_id = m.league_id
WHERE m.status IN ('scheduled', 'in_progress', 'completed')
  AND tl.starters IS NOT NULL
  AND jsonb_array_length(tl.starters) > 0
ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO NOTHING;

-- Also insert bench players
INSERT INTO public.fantasy_daily_rosters (
  league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
)
SELECT 
  m.league_id,
  t.id AS team_id,
  m.id AS matchup_id,
  (jsonb_array_elements_text(tl.bench)::integer) AS player_id,
  generate_series(m.week_start_date, m.week_end_date, '1 day'::interval)::DATE AS roster_date,
  'bench' AS slot_type,
  NULL AS slot_id,
  false AS is_locked
FROM matchups m
JOIN teams t ON (t.id = m.team1_id OR t.id = m.team2_id)
JOIN team_lineups tl ON tl.team_id = t.id::text AND tl.league_id = m.league_id
WHERE m.status IN ('scheduled', 'in_progress', 'completed')
  AND tl.bench IS NOT NULL
  AND jsonb_array_length(tl.bench) > 0
ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO NOTHING;

-- Also insert IR players
INSERT INTO public.fantasy_daily_rosters (
  league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
)
SELECT 
  m.league_id,
  t.id AS team_id,
  m.id AS matchup_id,
  (jsonb_array_elements_text(tl.ir)::integer) AS player_id,
  generate_series(m.week_start_date, m.week_end_date, '1 day'::interval)::DATE AS roster_date,
  'ir' AS slot_type,
  tl.slot_assignments->>(jsonb_array_elements_text(tl.ir)::text) AS slot_id,
  false AS is_locked
FROM matchups m
JOIN teams t ON (t.id = m.team1_id OR t.id = m.team2_id)
JOIN team_lineups tl ON tl.team_id = t.id::text AND tl.league_id = m.league_id
WHERE m.status IN ('scheduled', 'in_progress', 'completed')
  AND tl.ir IS NOT NULL
  AND jsonb_array_length(tl.ir) > 0
ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO NOTHING;

COMMENT ON FUNCTION public.calculate_daily_matchup_scores IS 'Backfilled initial daily rosters for existing matchups using current lineup state. Future lineup saves will update these records.';
