-- JOIN-FLOW (2026-08-16): Sleeper-parity joining.
-- 1) New leagues get a friendly 6-char join code (unambiguous alphabet,
--    no 0/O/1/I/L) instead of a 36-char UUID nobody can read aloud.
-- 2) join_league_with_code matches codes case- and whitespace-insensitively.
-- 3) Team-name fallback never uses the generated signup handle.
-- Existing leagues keep their codes; invite links carry any format.
-- APPLIED to prod 2026-08-16 via MCP apply_migration (join_flow_friendly_codes).
-- Drilled live post-apply: lowercase+whitespace join, idempotent retry,
-- custom team name, full-league rejection, bad-code rejection — all pass.

create or replace function public.generate_join_code()
returns text
language plpgsql
volatile
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text;
  v_attempt int := 0;
begin
  loop
    v_attempt := v_attempt + 1;
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.leagues where upper(join_code) = v_code)
           or v_attempt >= 5;
  end loop;
  return v_code;
end;
$$;

create unique index if not exists leagues_join_code_upper_uniq
  on public.leagues (upper(join_code))
  where join_code is not null;

alter table public.leagues
  alter column join_code set default public.generate_join_code();

-- Original has parameter defaults; preserve the exact signature.
drop function if exists public.join_league_with_code(text, uuid, text);

create function public.join_league_with_code(p_join_code text, p_user_id uuid default null::uuid, p_team_name text default null::text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_user_id UUID;
  v_league RECORD;
  v_existing_team RECORD;
  v_team_count INT;
  v_max_teams INT;
  v_final_team_name TEXT;
  v_new_team RECORD;
  v_is_pool BOOLEAN;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated.');
  END IF;

  -- JOIN-FLOW (2026-08-16): case- and whitespace-insensitive code match.
  SELECT l.* INTO v_league FROM public.leagues l
  WHERE upper(l.join_code) = upper(trim(p_join_code));

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid join code. Please check and try again.');
  END IF;

  -- IDEMPOTENT PATH: if user already has a team here, return success
  -- with the existing team. This keeps retries / double-taps safe.
  SELECT t.* INTO v_existing_team FROM public.teams t
  WHERE t.league_id = v_league.id AND t.owner_id = v_user_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'league_id', v_league.id,
      'league_name', v_league.name,
      'settings', v_league.settings,
      'team_id', v_existing_team.id,
      'team_name', v_existing_team.team_name,
      'already_member', true
    );
  END IF;

  SELECT COUNT(*) INTO v_team_count FROM public.teams t WHERE t.league_id = v_league.id;
  v_max_teams := COALESCE(
    (v_league.settings->>'teamsCount')::INT,
    (v_league.settings->>'teamCount')::INT,
    (v_league.settings->>'numberOfTeams')::INT,
    12
  );
  IF v_team_count >= v_max_teams THEN
    RETURN jsonb_build_object('success', false, 'error', 'This league is full.');
  END IF;

  -- Pool leagues don't have drafts; skip the draft-status block.
  v_is_pool := (v_league.settings->>'leagueType') IS NOT NULL
               AND (v_league.settings->>'leagueType') <> 'fantasy';

  IF NOT v_is_pool THEN
    IF v_league.draft_status = 'in_progress' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cannot join — the draft is currently in progress.');
    END IF;
    IF v_league.draft_status = 'completed' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cannot join — the draft has already been completed.');
    END IF;
  END IF;

  IF p_team_name IS NOT NULL AND LENGTH(TRIM(p_team_name)) > 0 THEN
    v_final_team_name := TRIM(p_team_name);
  ELSE
    -- JOIN-FLOW (2026-08-16): never fall back to the generated signup
    -- handle (user_<id-prefix>) as a TEAM NAME on the draft board.
    SELECT COALESCE(
      p.default_team_name,
      CASE WHEN p.username IS NOT NULL AND p.username !~* '^user_[0-9a-f]{6,}' THEN p.username END,
      'Team ' || (v_team_count + 1)
    )
    INTO v_final_team_name
    FROM profiles p
    WHERE p.id = v_user_id;
    IF v_final_team_name IS NULL THEN
      v_final_team_name := 'Team ' || (v_team_count + 1);
    END IF;
  END IF;

  INSERT INTO public.teams (league_id, owner_id, team_name)
  VALUES (v_league.id, v_user_id, v_final_team_name)
  RETURNING * INTO v_new_team;

  RETURN jsonb_build_object(
    'success', true,
    'league_id', v_league.id,
    'league_name', v_league.name,
    'settings', v_league.settings,
    'team_id', v_new_team.id,
    'team_name', v_new_team.team_name,
    'already_member', false
  );
END;
$$;
