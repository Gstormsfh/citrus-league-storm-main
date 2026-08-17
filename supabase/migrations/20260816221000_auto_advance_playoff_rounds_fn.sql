-- AUTONOMY (2026-08-16): scheduled playoff round advancement.
-- advance_playoff_round() is commissioner-gated via auth.uid() and has no
-- time guard. This wrapper advances a bracket ONLY when every active
-- series in its current round has fully completed matchup weeks, and
-- invokes the existing (battle-tested) function under a transaction-local
-- commissioner claim so its auth check passes for the league's own
-- scheduled advancement. Idempotent: a round with no active series or
-- with pending matchups is skipped.
-- APPLIED to prod 2026-08-16 via MCP apply_migration (auto_advance_playoff_rounds_fn).
create or replace function public.auto_advance_playoff_rounds()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bracket record;
  v_pending int;
  v_active int;
  v_commissioner uuid;
  v_res json;
  v_results jsonb := '[]'::jsonb;
begin
  for v_bracket in
    select pb.id, pb.league_id, pb.current_round
    from playoff_brackets pb
    where pb.status is distinct from 'completed'
  loop
    select count(*) into v_active
    from playoff_series ps
    where ps.bracket_id = v_bracket.id
      and ps.round_number = v_bracket.current_round
      and ps.status = 'active'
      and ps.home_team_id is not null
      and ps.away_team_id is not null;
    if v_active = 0 then
      continue;
    end if;

    -- A round advances only when every matchup row backing its active
    -- series is completed (auto_complete_matchups flips them after the
    -- week ends). Anything pending -> wait for a later sweep.
    select count(*) into v_pending
    from playoff_series ps
    join matchups m
      on m.league_id = v_bracket.league_id
     and m.week_number in (ps.matchup_week_1, ps.matchup_week_2)
     and ((m.team1_id = ps.home_team_id and m.team2_id = ps.away_team_id)
       or (m.team1_id = ps.away_team_id and m.team2_id = ps.home_team_id))
    where ps.bracket_id = v_bracket.id
      and ps.round_number = v_bracket.current_round
      and ps.status = 'active'
      and lower(coalesce(m.status, '')) not in ('completed', 'final');
    if v_pending > 0 then
      continue;
    end if;

    select commissioner_id into v_commissioner
    from leagues where id = v_bracket.league_id;
    if v_commissioner is null then
      continue;
    end if;

    -- Transaction-local commissioner claim so the gated function's
    -- auth.uid() check passes for this league's scheduled advancement.
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_commissioner, 'role', 'authenticated')::text,
      true
    );
    v_res := public.advance_playoff_round(v_bracket.id);
    perform set_config('request.jwt.claims', '{}', true);

    v_results := v_results || jsonb_build_object(
      'bracket_id', v_bracket.id,
      'league_id', v_bracket.league_id,
      'round', v_bracket.current_round,
      'result', v_res::jsonb
    );
  end loop;
  return v_results;
end;
$$;

revoke all on function public.auto_advance_playoff_rounds() from public;
grant execute on function public.auto_advance_playoff_rounds() to service_role;
