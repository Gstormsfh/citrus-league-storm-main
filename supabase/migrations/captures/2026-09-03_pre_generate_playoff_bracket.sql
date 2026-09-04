CREATE OR REPLACE FUNCTION public.generate_playoff_bracket(p_league_id uuid, p_consolation_enabled boolean DEFAULT false, p_two_week_matchups boolean DEFAULT false, p_reseed_each_round boolean DEFAULT false, p_seeding_method text DEFAULT 'standings'::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bracket_id UUID;
  v_league RECORD;
  v_bracket_size INT;
  v_total_rounds INT;
  v_playoff_teams INT;
  v_team_count INT;
  v_regular_season_weeks INT;
  v_playoff_start_week INT;
  v_team RECORD;
  v_seed_num INT := 0;
  v_series_season INT;
  v_qf1 UUID; v_qf2 UUID; v_qf3 UUID; v_qf4 UUID;
  v_sf1 UUID; v_sf2 UUID;
  v_finals UUID;
  v_third_place UUID;
  v_con_sf1 UUID; v_con_sf2 UUID; v_con_finals UUID;
  v_con_r1_1 UUID; v_con_r1_2 UUID;
  v_week_offset INT;
BEGIN
  IF EXTRACT(MONTH FROM NOW()) >= 10 THEN
    v_series_season := EXTRACT(YEAR FROM NOW())::INT;
  ELSE
    v_series_season := (EXTRACT(YEAR FROM NOW()) - 1)::INT;
  END IF;

  SELECT l.*,
    COALESCE((l.settings->>'playoffTeams')::INT, 6) AS cfg_playoff_teams,
    COALESCE((l.settings->>'playoffWeeks')::INT, 3) AS cfg_playoff_weeks,
    COALESCE((l.settings->>'regularSeasonWeeks')::INT, 0) AS cfg_regular_weeks,
    COALESCE(l.settings->>'leagueType', 'fantasy') AS cfg_league_type
  INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'League not found');
  END IF;

  -- Allow admin/service callers (auth.uid() IS NULL) to bypass commissioner gate
  IF auth.uid() IS NOT NULL AND v_league.commissioner_id != auth.uid() THEN
    RETURN json_build_object('error', 'Only the commissioner can generate playoff brackets');
  END IF;

  IF v_league.cfg_league_type != 'fantasy' THEN
    RETURN json_build_object('error', 'Playoff brackets are only available for fantasy leagues');
  END IF;

  IF v_league.draft_status != 'completed' THEN
    RETURN json_build_object('error', 'Draft must be completed before generating playoffs');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.playoff_brackets pb
    WHERE pb.league_id = p_league_id
    AND pb.season = v_series_season
    AND pb.status != 'completed'
  ) THEN
    RETURN json_build_object('error', 'An active playoff bracket already exists. Reset it first.');
  END IF;

  SELECT COUNT(*) INTO v_team_count FROM public.teams t WHERE t.league_id = p_league_id;

  v_playoff_teams := v_league.cfg_playoff_teams;
  IF v_playoff_teams > v_team_count THEN v_playoff_teams := v_team_count; END IF;

  IF v_playoff_teams >= 8 THEN v_bracket_size := 8;
  ELSIF v_playoff_teams >= 6 THEN v_bracket_size := 6;
  ELSIF v_playoff_teams >= 4 THEN v_bracket_size := 4;
  ELSE RETURN json_build_object('error', 'Need at least 4 teams for playoffs');
  END IF;

  IF v_bracket_size = 8 THEN v_total_rounds := 3;
  ELSIF v_bracket_size = 6 THEN v_total_rounds := 3;
  ELSE v_total_rounds := 2;
  END IF;

  IF v_league.cfg_regular_weeks > 0 THEN
    v_regular_season_weeks := v_league.cfg_regular_weeks;
  ELSE
    SELECT COALESCE(MAX(week_number), 0) INTO v_regular_season_weeks
    FROM public.matchups m WHERE m.league_id = p_league_id;
  END IF;
  v_playoff_start_week := v_regular_season_weeks + 1;

  INSERT INTO public.playoff_brackets (
    league_id, season, bracket_size, status, current_round, total_rounds,
    seeding_method, reseed_each_round, consolation_enabled, two_week_matchups,
    generated_by, started_at
  ) VALUES (
    p_league_id, v_series_season, v_bracket_size, 'active', 1, v_total_rounds,
    p_seeding_method, p_reseed_each_round, p_consolation_enabled, p_two_week_matchups,
    auth.uid(), NOW()
  )
  RETURNING id INTO v_bracket_id;

  v_seed_num := 0;
  FOR v_team IN
    SELECT t.id AS team_id,
      COALESCE(SUM(CASE WHEN m.team1_id = t.id AND m.team1_score > m.team2_score THEN 1
                        WHEN m.team2_id = t.id AND m.team2_score > m.team1_score THEN 1
                        ELSE 0 END), 0) AS wins,
      COALESCE(SUM(CASE WHEN m.team1_id = t.id AND m.team1_score < m.team2_score THEN 1
                        WHEN m.team2_id = t.id AND m.team2_score < m.team1_score THEN 1
                        ELSE 0 END), 0) AS losses,
      COALESCE(SUM(CASE WHEN m.team1_id = t.id AND m.team1_score = m.team2_score AND m.team2_id IS NOT NULL THEN 1
                        WHEN m.team2_id = t.id AND m.team1_score = m.team2_score THEN 1
                        ELSE 0 END), 0) AS ties,
      COALESCE(SUM(CASE WHEN m.team1_id = t.id THEN m.team1_score
                        WHEN m.team2_id = t.id THEN m.team2_score
                        ELSE 0 END), 0) AS points_for
    FROM public.teams t
    LEFT JOIN public.matchups m ON ((m.team1_id = t.id OR m.team2_id = t.id)
      AND m.league_id = p_league_id AND m.week_number <= v_regular_season_weeks)
    WHERE t.league_id = p_league_id
    GROUP BY t.id
    ORDER BY wins DESC, points_for DESC, losses ASC
    LIMIT v_bracket_size
  LOOP
    v_seed_num := v_seed_num + 1;
    INSERT INTO public.playoff_seeds (
      bracket_id, team_id, seed_number,
      regular_season_wins, regular_season_losses, regular_season_ties,
      regular_season_points_for, source
    ) VALUES (
      v_bracket_id, v_team.team_id, v_seed_num,
      v_team.wins, v_team.losses, v_team.ties,
      v_team.points_for, p_seeding_method
    );
  END LOOP;

  IF v_bracket_size = 8 THEN
    v_week_offset := 0;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 1, 'winners', 1, 8, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_qf1;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 2, 'winners', 4, 5, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_qf2;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 3, 'winners', 2, 7, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_qf3;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 4, 'winners', 3, 6, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_qf4;

    IF p_two_week_matchups THEN v_week_offset := 2; ELSE v_week_offset := 1; END IF;

    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 2, 1, 'winners', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_sf1;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 2, 2, 'winners', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_sf2;

    IF p_two_week_matchups THEN v_week_offset := 4; ELSE v_week_offset := 2; END IF;

    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 3, 1, 'winners', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_finals;

    UPDATE public.playoff_series SET winner_advances_to = v_sf1, winner_slot = 'home' WHERE id = v_qf1;
    UPDATE public.playoff_series SET winner_advances_to = v_sf1, winner_slot = 'away' WHERE id = v_qf2;
    UPDATE public.playoff_series SET winner_advances_to = v_sf2, winner_slot = 'home' WHERE id = v_qf3;
    UPDATE public.playoff_series SET winner_advances_to = v_sf2, winner_slot = 'away' WHERE id = v_qf4;
    UPDATE public.playoff_series SET winner_advances_to = v_finals, winner_slot = 'home' WHERE id = v_sf1;
    UPDATE public.playoff_series SET winner_advances_to = v_finals, winner_slot = 'away' WHERE id = v_sf2;

    IF p_consolation_enabled THEN
      INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
      VALUES (v_bracket_id, 3, 1, 'third_place', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
      RETURNING id INTO v_third_place;
      UPDATE public.playoff_series SET loser_drops_to = v_third_place, loser_slot = 'home' WHERE id = v_sf1;
      UPDATE public.playoff_series SET loser_drops_to = v_third_place, loser_slot = 'away' WHERE id = v_sf2;

      INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
      VALUES (v_bracket_id, 2, 1, 'consolation', 'pending', v_playoff_start_week + v_week_offset - (CASE WHEN p_two_week_matchups THEN 2 ELSE 1 END), CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset - 1 ELSE NULL END)
      RETURNING id INTO v_con_r1_1;
      INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
      VALUES (v_bracket_id, 2, 2, 'consolation', 'pending', v_playoff_start_week + v_week_offset - (CASE WHEN p_two_week_matchups THEN 2 ELSE 1 END), CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset - 1 ELSE NULL END)
      RETURNING id INTO v_con_r1_2;
      INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
      VALUES (v_bracket_id, 3, 1, 'consolation', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
      RETURNING id INTO v_con_finals;

      UPDATE public.playoff_series SET loser_drops_to = v_con_r1_1, loser_slot = 'home' WHERE id = v_qf1;
      UPDATE public.playoff_series SET loser_drops_to = v_con_r1_1, loser_slot = 'away' WHERE id = v_qf2;
      UPDATE public.playoff_series SET loser_drops_to = v_con_r1_2, loser_slot = 'home' WHERE id = v_qf3;
      UPDATE public.playoff_series SET loser_drops_to = v_con_r1_2, loser_slot = 'away' WHERE id = v_qf4;
      UPDATE public.playoff_series SET winner_advances_to = v_con_finals, winner_slot = 'home' WHERE id = v_con_r1_1;
      UPDATE public.playoff_series SET winner_advances_to = v_con_finals, winner_slot = 'away' WHERE id = v_con_r1_2;
    END IF;

  ELSIF v_bracket_size = 6 THEN
    v_week_offset := 0;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 1, 'winners', 3, 6, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_qf1;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 2, 'winners', 4, 5, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_qf2;

    IF p_two_week_matchups THEN v_week_offset := 2; ELSE v_week_offset := 1; END IF;

    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 2, 1, 'winners', 1, 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_sf1;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 2, 2, 'winners', 2, 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_sf2;

    IF p_two_week_matchups THEN v_week_offset := 4; ELSE v_week_offset := 2; END IF;

    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 3, 1, 'winners', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_finals;

    UPDATE public.playoff_series SET winner_advances_to = v_sf1, winner_slot = 'away' WHERE id = v_qf2;
    UPDATE public.playoff_series SET winner_advances_to = v_sf2, winner_slot = 'away' WHERE id = v_qf1;
    UPDATE public.playoff_series SET winner_advances_to = v_finals, winner_slot = 'home' WHERE id = v_sf1;
    UPDATE public.playoff_series SET winner_advances_to = v_finals, winner_slot = 'away' WHERE id = v_sf2;

    IF p_consolation_enabled THEN
      INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
      VALUES (v_bracket_id, 3, 1, 'third_place', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
      RETURNING id INTO v_third_place;
      UPDATE public.playoff_series SET loser_drops_to = v_third_place, loser_slot = 'home' WHERE id = v_sf1;
      UPDATE public.playoff_series SET loser_drops_to = v_third_place, loser_slot = 'away' WHERE id = v_sf2;
    END IF;

  ELSE
    v_week_offset := 0;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 1, 'winners', 1, 4, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_sf1;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 2, 'winners', 2, 3, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_sf2;

    IF p_two_week_matchups THEN v_week_offset := 2; ELSE v_week_offset := 1; END IF;

    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 2, 1, 'winners', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_finals;

    UPDATE public.playoff_series SET winner_advances_to = v_finals, winner_slot = 'home' WHERE id = v_sf1;
    UPDATE public.playoff_series SET winner_advances_to = v_finals, winner_slot = 'away' WHERE id = v_sf2;

    IF p_consolation_enabled THEN
      INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
      VALUES (v_bracket_id, 2, 1, 'third_place', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
      RETURNING id INTO v_third_place;
      UPDATE public.playoff_series SET loser_drops_to = v_third_place, loser_slot = 'home' WHERE id = v_sf1;
      UPDATE public.playoff_series SET loser_drops_to = v_third_place, loser_slot = 'away' WHERE id = v_sf2;
    END IF;
  END IF;

  UPDATE public.playoff_series ps
  SET home_team_id = (SELECT team_id FROM public.playoff_seeds WHERE bracket_id = v_bracket_id AND seed_number = ps.home_seed),
      away_team_id = (SELECT team_id FROM public.playoff_seeds WHERE bracket_id = v_bracket_id AND seed_number = ps.away_seed)
  WHERE ps.bracket_id = v_bracket_id AND ps.round_number = 1 AND ps.home_seed IS NOT NULL;

  IF v_bracket_size = 6 THEN
    UPDATE public.playoff_series ps
    SET home_team_id = (SELECT team_id FROM public.playoff_seeds WHERE bracket_id = v_bracket_id AND seed_number = ps.home_seed)
    WHERE ps.bracket_id = v_bracket_id AND ps.round_number = 2 AND ps.home_seed IS NOT NULL;
  END IF;

  INSERT INTO public.matchups (league_id, week_number, team1_id, team2_id, team1_score, team2_score, status, week_start_date, week_end_date)
  SELECT p_league_id, ps.matchup_week_1, ps.home_team_id, ps.away_team_id,
    0, 0, 'scheduled', CURRENT_DATE, CURRENT_DATE + INTERVAL '6 days'
  FROM public.playoff_series ps
  WHERE ps.bracket_id = v_bracket_id AND ps.home_team_id IS NOT NULL AND ps.away_team_id IS NOT NULL AND ps.status = 'active'
  ON CONFLICT DO NOTHING;

  RETURN json_build_object(
    'bracket_id', v_bracket_id,
    'bracket_size', v_bracket_size,
    'total_rounds', v_total_rounds,
    'playoff_start_week', v_playoff_start_week,
    'consolation_enabled', p_consolation_enabled,
    'two_week_matchups', p_two_week_matchups,
    'success', true
  );
END;
$function$
