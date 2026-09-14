-- ============================================================================
-- persist_matchup_lines: serialize concurrent callers per matchup.
--
-- The function is DELETE-then-INSERT on fantasy_matchup_lines, which carries
-- UNIQUE (matchup_id, player_id). Two callers for the same matchup (two tabs
-- on the Matchup page, or a page load racing the scheduled scorer) interleave
-- under READ COMMITTED like this: S1's DELETE row-locks the existing lines;
-- S2's DELETE blocks on them; S1 inserts and commits; S2's DELETE resumes,
-- finds S1's old rows gone and S1's new rows invisible to its statement
-- snapshot, so it deletes nothing; S2's INSERT then violates the unique key
-- (23505) and the whole call fails. The persisted lines are still S1's and
-- correct, but the server logs a persistence failure on every collision and
-- the comment in MatchupService ("persist_matchup_lines is idempotent") was
-- only true for serial repetition.
--
-- Fix: a transaction-scoped advisory lock keyed on the matchup id, taken
-- after the matchup lookup and before the DELETE. S2 now waits for S1's
-- commit, then its DELETE statement sees S1's committed rows and replaces
-- them. Different matchups never contend. The lock is released at commit or
-- rollback; nothing else about the function changes (body, SECURITY DEFINER,
-- search_path, grants: owner postgres + service_role, no client role).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.persist_matchup_lines(p_matchup_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rows int := 0;
  m record;
begin
  select id, league_id, team1_id, team2_id, week_start_date, week_end_date
    into m from matchups where id = p_matchup_id;
  if not found then
    raise exception 'matchup % not found', p_matchup_id;
  end if;

  -- One writer per matchup per transaction; see header.
  perform pg_advisory_xact_lock(hashtextextended('persist_matchup_lines:' || p_matchup_id::text, 0));

  delete from fantasy_matchup_lines where matchup_id = p_matchup_id;

  with teams as (
    select m.team1_id as team_id where m.team1_id is not null
    union all
    select m.team2_id where m.team2_id is not null
  ),
  rules as (
    select r.stat_key, r.multiplier
      from public.get_effective_scoring_rules(m.league_id) r
  ),
  detail as (
    select t.team_id,
           l.player_id,
           l.stat_key,
           sum(l.value)                       as total_value,
           max(rules.multiplier)              as multiplier,
           sum(l.value * rules.multiplier)    as points,
           count(distinct fdr.roster_date)    as dates
      from teams t
      join fantasy_daily_rosters fdr
        on fdr.matchup_id = m.id
       and fdr.team_id    = t.team_id
       and fdr.slot_type  = 'active'
       and fdr.roster_date between m.week_start_date and m.week_end_date
      join player_game_stats pgs
        on pgs.player_id = fdr.player_id
       and pgs.game_date = fdr.roster_date
      join nhl_games g
        on g.game_id = pgs.game_id and g.game_type = 'regular'
      join public.v_player_game_stat_long l
        on l.game_id = pgs.game_id and l.player_id = pgs.player_id
      join rules on rules.stat_key = l.stat_key
     group by t.team_id, l.player_id, l.stat_key
  ),
  rolled as (
    select team_id, player_id,
           round(sum(points),3) as total_points,
           max(dates)           as games_played,
           coalesce(
             jsonb_object_agg(stat_key,
               jsonb_build_object('value', total_value,
                                  'multiplier', multiplier,
                                  'points', round(points,3)))
             filter (where total_value <> 0),
             '{}'::jsonb) as breakdown
      from detail group by team_id, player_id
  )
  insert into fantasy_matchup_lines
    (matchup_id, player_id, team_id, total_points, stats_breakdown, games_played)
  select p_matchup_id, r.player_id, r.team_id, r.total_points, r.breakdown, r.games_played
    from rolled r;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;

-- Guard: the grants must remain owner + service_role only. CREATE OR REPLACE
-- preserves the ACL, but assert it so a future edit cannot widen it silently.
DO $$
DECLARE
  v_acl text;
BEGIN
  SELECT proacl::text INTO v_acl
    FROM pg_proc WHERE oid = 'public.persist_matchup_lines(uuid)'::regprocedure;
  IF v_acl IS NOT NULL AND (v_acl LIKE '%authenticated=%' OR v_acl LIKE '%anon=%') THEN
    RAISE EXCEPTION 'persist_matchup_lines is granted to a client role: %', v_acl;
  END IF;
END $$;
