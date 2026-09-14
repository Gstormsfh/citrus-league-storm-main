-- citrus_projection_invariants(): the projection standards, checked daily
-- rather than only at publication.
--
-- canonical_validate_projection_run refuses to publish a run whose crease
-- is not conserved, whose schedule disagrees with nhl_games, or whose
-- rate x exposure does not equal its counts. rebuild_ros_projections raises
-- on the same crease rule at write time. Nothing looked AFTER publication:
-- a schedule change, a directory refresh that moves a goalie, or a partial
-- materialization leaves the serving table wrong until the next rebuild
-- happens to raise. The MODEL games-played ceiling (83 of 84 for 2026-27,
-- projection_contract.py) was enforced only in a module the publication
-- path never calls.
--
-- Same contract as the other citrus_*_invariant functions: one row per
-- check, status pass / fail / warn, read by
-- data-pipeline/monitoring/check_data_invariants.py on the daily workflow.
create or replace function public.citrus_projection_invariants()
returns table(check_name text, status text, measured text, threshold text, detail text)
language plpgsql stable
set search_path to 'public', 'pg_temp'
as $fn$
declare
  a record;
  v_bad text;
  v_teams integer;
  v_over integer;
  v_max numeric;
  v_unlabelled integer;
  v_rows integer;
begin
  if not exists (select 1 from public.canonical_projection_active) then
    return query select 'projection_publication_active'::text, 'warn'::text,
      'no active canonical publication'::text, '1 active season'::text,
      'Every other projection check is skipped until a canonical run is activated.'::text;
    return;
  end if;

  for a in select ca.season, ca.run_id, r.payload->'schedule' as schedule
             from public.canonical_projection_active ca
             join public.canonical_projection_runs r on r.id = ca.run_id
  loop
    -- 1. The crease, in the table the app reads. Sum of goalie games_remaining
    --    per team equals that team's remaining regular-season games. Counted
    --    exactly as rebuild_ros_projections counts it.
    select string_agg(x.team_abbrev || ' ' || round(x.alloc, 3) || '/' || x.expected, ', ' order by x.team_abbrev),
           count(*)::integer
      into v_bad, v_teams
      from (
        select g.team_abbrev, g.alloc, coalesce(sch.games_left, 0) as expected
          from (
            select r.team_abbrev, sum(r.games_remaining) as alloc
              from public.player_ros_projections r
             where r.season = a.season and r.is_goalie and r.team_abbrev is not null
             group by r.team_abbrev
          ) g
          left join (
            select s.abbrev, count(*)::int as games_left
              from (
                select home_team as abbrev, game_date from public.nhl_games
                 where season = a.season and game_type = 'regular'
                union all
                select away_team, game_date from public.nhl_games
                 where season = a.season and game_type = 'regular'
              ) s
             where s.game_date >= current_date
             group by s.abbrev
          ) sch on sch.abbrev = g.team_abbrev
         where abs(g.alloc - coalesce(sch.games_left, 0)) > 0.00001
      ) x;

    return query select
      'crease_conserved_in_serving_table'::text,
      case when coalesce(v_teams, 0) = 0 then 'pass' else 'fail' end::text,
      coalesce(v_teams, 0)::text || ' team(s) off: ' || coalesce(v_bad, 'none'),
      '0 teams'::text,
      ('Season ' || a.season || ': for every team, projected goalie starts in player_ros_projections must equal the team''s remaining regular-season games. Projection standard rule 4. A miss here after a clean publication means the schedule or the directory moved and the materialization is stale; refresh rather than edit rows.')::text;

    -- 2. The published schedule budgets against nhl_games as it is today.
    select string_agg(k.key || ' ' || k.value || '/' || coalesce(n.cnt, 0), ', ' order by k.key), count(*)::integer
      into v_bad, v_teams
      from jsonb_each_text(coalesce(a.schedule, '{}'::jsonb)) k
      left join (
        select t.abbrev, count(*)::int as cnt
          from (
            select home_team as abbrev from public.nhl_games where season = a.season and game_type = 'regular'
            union all
            select away_team from public.nhl_games where season = a.season and game_type = 'regular'
          ) t group by t.abbrev
      ) n on n.abbrev = k.key
     where k.value::numeric is distinct from coalesce(n.cnt, 0)::numeric;

    return query select
      'published_schedule_matches_nhl_games'::text,
      case when a.schedule is null or a.schedule = '{}'::jsonb then 'fail'
           when coalesce(v_teams, 0) = 0 then 'pass' else 'fail' end::text,
      case when a.schedule is null or a.schedule = '{}'::jsonb then 'active run carries no schedule'
           else coalesce(v_teams, 0)::text || ' team(s) drifted: ' || coalesce(v_bad, 'none') end,
      '0 teams'::text,
      ('Season ' || a.season || ': the per-team game budgets the active run was validated against must still equal the regular-season game count in nhl_games. Projection standard rule 1: season length is derived per team, never a constant. Drift means the NHL schedule changed after publication and every rate x games total is now on the wrong denominator.')::text;

    -- 3. MODEL skater games-played ceiling: a model skater may use at most
    --    one game fewer than its team's schedule (83 of 84). MANUAL and
    --    DEFAULT rows are reviewed by hand and may use the full schedule;
    --    goalie starts are bounded by the crease instead.
    select count(*)::integer, max((p.payload#>>'{exposure,used}')::numeric)
      into v_over, v_max
      from public.canonical_published_players p
     where p.season = a.season
       and p.payload->>'provenance' = 'MODEL'
       and p.payload->>'status' = 'projected'
       and not coalesce((p.payload->>'is_goalie')::boolean, false)
       and (p.payload#>>'{exposure,used}')::numeric
           > coalesce((a.schedule->>(p.payload->>'team'))::numeric, 0) - 1;

    return query select
      'model_exposure_within_ceiling'::text,
      case when coalesce(v_over, 0) = 0 then 'pass' else 'fail' end::text,
      coalesce(v_over, 0)::text || ' MODEL skater row(s) above ceiling; max MODEL skater exposure ' || coalesce(v_max::text, 'n/a'),
      'schedule - 1 (83 of 84 for 2026-27)'::text,
      ('Season ' || a.season || ': projection_contract.py sets the MODEL ceiling deliberately one game under the schedule; this is the first check of it on the publication path.')::text;

    -- 4. Provenance on every published row (rule 5).
    select (count(*) filter (where coalesce(p.payload->>'provenance', '') not in ('MODEL', 'MANUAL', 'DEFAULT')))::integer,
           count(*)::integer
      into v_unlabelled, v_rows
      from public.canonical_published_players p
     where p.season = a.season;

    return query select
      'published_rows_carry_provenance'::text,
      case when v_rows = 0 then 'warn' when v_unlabelled = 0 then 'pass' else 'fail' end::text,
      v_unlabelled::text || ' of ' || v_rows::text || ' rows without MODEL / MANUAL / DEFAULT',
      '0 rows'::text,
      ('Season ' || a.season || ': a number that reaches a screen without provenance is a bug, and a fallback rendered as model output is the one error a customer cannot detect.')::text;
  end loop;
end;
$fn$;

revoke all on function public.citrus_projection_invariants() from public, anon, authenticated;
grant execute on function public.citrus_projection_invariants() to service_role;
comment on function public.citrus_projection_invariants() is
  'Daily post-publication checks of the projection standards: crease conservation in the serving table, schedule budgets vs nhl_games, the MODEL games-played ceiling, and provenance on every published row.';
