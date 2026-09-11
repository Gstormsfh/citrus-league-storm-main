-- ============================================================================
-- lock_keepers_for_season(): refuse an over-designated team instead of
-- letting the draft engine silently drop the excess keepers
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
--
-- (a) WHAT CHANGED
--   public.lock_keepers_for_season(uuid, integer) is REPLACED. One guard is
--   added to the existing per-team validation loop: a team whose designation
--   count for p_season_year exceeds the league's draft_rounds raises, the
--   same way an invalid selection already raises, before anything is locked.
--   Nothing else changes -- the dynasty insert, the validate loop, the lock
--   loop, the returned columns and the search_path are untouched.
--
-- (b) WHY
--   VERIFIED ON PRODUCTION 2026-09-11, read-only.
--
--   The draft engine seats each locked keeper in a draft slot. server/src/
--   draft/keeperSlots.ts assignKeeperSlots() walks a team's rounds looking
--   for a free one; claimFromEnd() returns NULL once every round is taken,
--   and the keeper is then simply absent from the returned array. The engine
--   builds its protection set from that array:
--
--     LobbyManager.ts:950
--     this.keptPlayerIds = new Set(this.keeperSlots.map((k) => k.playerId));
--
--   so a keeper who could not be seated is not merely unseated -- he is not
--   in keptPlayerIds, which means he is not protected, and another team can
--   draft a player his owner was told he was keeping. No throw, no log line.
--
--   How a team gets more designations than rounds: draft_rounds excludes IR
--   (packages/shared/src/types/league.ts, NON_DRAFTABLE_SLOTS = {IR}) while
--   the dynasty branch of this function designates every roster_assignments
--   row for the league. roster_assignments carries no slot column at all --
--   its columns are id, league_id, team_id, player_id, acquired_at,
--   created_at, updated_at -- so the lineup slot lives in
--   fantasy_daily_rosters.slot_type ('active' | 'bench' | 'ir'), a DAILY
--   table. There is therefore no correct, date-free way to exclude IR here,
--   which is why this guard refuses rather than filters.
--
--   Blast radius today is zero and that is the point of landing it now:
--   the only two leagues with keepers on are 'Keeper Test' (12 teams, 14
--   designations possible against 14 rounds -- exactly at the limit, not
--   over) and one deleted dynasty league with no rosters at all. The defect
--   is latent and fires for the first dynasty league that has anyone on IR.
--
--   Why refusing is the right product answer: a dynasty league with 21
--   draftable spots and 2 IR spots genuinely cannot seat 23 keepers in 21
--   rounds. The commissioner has to either reduce keepers or add rounds.
--   Silently dropping two of them picks for him, invisibly, and picks wrong.
--
-- (c) WHO / WORKSTREAM
--   Claude (cloud session 01J7JBu263Ld1ucRRiRxJ2to), directed by Garrett
--   Storms, 2026-09-11, keeper/dynasty audit ahead of drafts opening 15 Sep.
--
-- Reversibility: CREATE OR REPLACE from
--   supabase/migrations/20260910120000_dynasty_keeps_the_roster.sql,
--   which is the version this replaces.
-- Idempotent: CREATE OR REPLACE. A second apply is a no-op.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.lock_keepers_for_season(p_league_id uuid, p_season_year integer)
 RETURNS TABLE(team_id uuid, keepers_locked integer, rounds_consumed integer[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_team record; v_count int; v_rounds int[]; v_bad text;
  v_settings jsonb; v_dynasty boolean; v_penalty text;
  v_draft_rounds int; v_designated int;
begin
  select settings, draft_rounds into v_settings, v_draft_rounds
  from leagues where id = p_league_id;
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

    -- OVERFLOW GUARD (2026-09-11). Every locked keeper must be seatable in a
    -- draft slot: assignKeeperSlots() drops any it cannot place, and the
    -- engine's keptPlayerIds is built from what it placed, so a dropped
    -- keeper loses his protection and re-enters the pool. Refuse here, where
    -- the commissioner can still act, rather than lose players at the draft.
    if v_draft_rounds is not null and v_draft_rounds > 0 then
      select count(*) into v_designated
      from keeper_designations kd
      where kd.league_id = p_league_id
        and kd.team_id = v_team.tid
        and kd.season_year = p_season_year
        and kd.status in ('designated', 'approved', 'locked');

      if v_designated > v_draft_rounds then
        raise exception
          'Team % has % keepers but the draft is only % rounds; every keeper must fit a draft slot. Reduce keepers or increase draft rounds.',
          v_team.tid, v_designated, v_draft_rounds;
      end if;
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

COMMIT;
