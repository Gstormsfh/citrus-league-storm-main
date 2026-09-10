-- DYNASTY KEEPS THE ROSTER (2026-09-10)
--
-- `dynastyMode` did one thing: it raised the keeper cap to 999 in
-- validate_keeper_selections. Every player still had to be designated by
-- hand, and lock_keepers_for_season locked only the rows that existed. A
-- manager who forgot to click through his whole roster watched the
-- undesignated players go to the pool. That is the opposite of a dynasty.
--
-- Two changes, both scoped to dynastyMode = true:
--
--   1. lock_keepers_for_season designates every rostered player before it
--      validates and locks. ON CONFLICT DO NOTHING keeps an existing row,
--      so an explicit 'released' designation still means released.
--
--   2. get_keeper_draft_costs returns a NULL effective_round for every
--      keeper. A dynasty keeper is free: the engine seats free keepers from
--      the team's last pick backwards (server/src/draft/keeperSlots.ts), so
--      a team that keeps 19 of 21 drafts in rounds 1 and 2 and the rest of
--      the board is already his. A round-cost dynasty was incoherent anyway:
--      with the whole roster kept every round is consumed, and a player with
--      no recorded original round COALESCEs to round 1, so every auto-kept
--      player would have collided on the first pick.
--
-- Non-dynasty keeper leagues are untouched by both.

create or replace function public.get_keeper_draft_costs(p_league_id uuid, p_team_id uuid, p_season_year integer)
returns table(player_id text, keeper_round integer, penalty_type text, original_draft_round integer, years_kept integer, effective_round integer)
language plpgsql stable security definer
set search_path to 'public'
as $function$
declare
  v_settings jsonb;
  v_penalty_type text;
  v_dynasty boolean;
begin
  select settings into v_settings from leagues where id = p_league_id;
  v_penalty_type := coalesce(v_settings->>'keeperPenalty', 'none');
  v_dynasty := coalesce((v_settings->>'dynastyMode')::boolean, false);

  return query
  select
    kd.player_id,
    kd.keeper_round,
    v_penalty_type,
    kd.original_draft_round,
    kd.years_kept,
    case
      when v_dynasty then null                      -- dynasty: every keeper is free
      when v_penalty_type = 'none' then null        -- no round cost, keeper is free
      when v_penalty_type = 'round-cost' then coalesce(kd.original_draft_round, 1)
      when v_penalty_type = 'round-escalation' then greatest(1,
        coalesce(kd.original_draft_round, 1) - kd.years_kept)
      else null
    end
  from keeper_designations kd
  where kd.league_id = p_league_id
    and kd.team_id = p_team_id
    and kd.season_year = p_season_year
    and kd.status in ('approved', 'locked');
end;
$function$;

create or replace function public.lock_keepers_for_season(p_league_id uuid, p_season_year integer)
returns table(team_id uuid, keepers_locked integer, rounds_consumed integer[])
language plpgsql security definer
set search_path to 'public'
as $function$
declare
  v_team record; v_count int; v_rounds int[]; v_bad text;
  v_settings jsonb; v_dynasty boolean; v_penalty text;
begin
  select settings into v_settings from leagues where id = p_league_id;
  v_dynasty := coalesce((v_settings->>'dynastyMode')::boolean, false);
  v_penalty := v_settings->>'keeperPenalty';
  if v_penalty is null or v_penalty not in ('none', 'round-cost', 'round-escalation') then
    v_penalty := 'none';
  end if;

  -- Dynasty: the whole roster is kept. Designate every rostered player who
  -- has no row for this season yet. An existing row of any status wins.
  if v_dynasty then
    insert into keeper_designations (league_id, team_id, player_id, season_year, status, keeper_penalty_type)
    select ra.league_id, ra.team_id, ra.player_id, p_season_year, 'designated', v_penalty
    from roster_assignments ra
    where ra.league_id = p_league_id
    on conflict (league_id, player_id, season_year) do nothing;
  end if;

  -- Validate every team first; refuse the whole lock if any team is invalid.
  for v_team in select t.id as tid from teams t where t.league_id = p_league_id
  loop
    select v.error_message into v_bad
    from public.validate_keeper_selections(p_league_id, v_team.tid, p_season_year) v
    where v.is_valid = false
    limit 1;

    if v_bad is not null then
      raise exception 'Team % has invalid keeper selections: %', v_team.tid, v_bad;
    end if;
  end loop;

  for v_team in select t.id as tid from teams t where t.league_id = p_league_id
  loop
    update keeper_designations kd
       set status = 'locked'
     where kd.league_id = p_league_id
       and kd.team_id = v_team.tid
       and kd.season_year = p_season_year
       and kd.status in ('designated', 'approved');
    get diagnostics v_count = row_count;

    select array_agg(c.effective_round order by c.effective_round) into v_rounds
    from public.get_keeper_draft_costs(p_league_id, v_team.tid, p_season_year) c
    where c.effective_round is not null;

    team_id := v_team.tid;
    keepers_locked := v_count;
    rounds_consumed := coalesce(v_rounds, array[]::int[]);
    return next;
  end loop;

  return;
end
$function$;
