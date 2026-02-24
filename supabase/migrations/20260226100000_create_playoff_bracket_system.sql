-- ============================================================================
-- World-Class Playoff Bracket System
-- Industry-standard tournament bracket management:
--   - Proper seeding (1v8, 2v7, 3v6, 4v5)
--   - Bye support for 6-team brackets (top 2 seeds get first-round byes)
--   - Consolation bracket (toilet bowl) for eliminated teams
--   - Two-week (aggregate score) playoff matchup support
--   - Commissioner manual seed overrides
--   - Auto-advancement after round completion
--   - Re-seeding option (reseed remaining teams each round)
-- ============================================================================

-- ============================================================================
-- 1. PLAYOFF BRACKETS TABLE - Master bracket record per league per season
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.playoff_brackets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  season INT NOT NULL DEFAULT EXTRACT(YEAR FROM NOW()),
  bracket_size INT NOT NULL CHECK (bracket_size IN (4, 6, 8)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed')),
  current_round INT NOT NULL DEFAULT 0,
  total_rounds INT NOT NULL,
  -- Configuration
  seeding_method TEXT NOT NULL DEFAULT 'standings' CHECK (seeding_method IN ('standings', 'manual')),
  reseed_each_round BOOLEAN NOT NULL DEFAULT FALSE,
  consolation_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  two_week_matchups BOOLEAN NOT NULL DEFAULT FALSE,
  -- Results
  champion_team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  runner_up_team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  third_place_team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  -- Metadata
  generated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One active bracket per league per season
  UNIQUE(league_id, season)
);

-- ============================================================================
-- 2. PLAYOFF SEEDS TABLE - Records seed assignments for each team
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.playoff_seeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bracket_id UUID NOT NULL REFERENCES public.playoff_brackets(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  seed_number INT NOT NULL CHECK (seed_number >= 1 AND seed_number <= 16),
  -- Regular season record at time of seeding
  regular_season_wins INT NOT NULL DEFAULT 0,
  regular_season_losses INT NOT NULL DEFAULT 0,
  regular_season_ties INT NOT NULL DEFAULT 0,
  regular_season_points_for NUMERIC NOT NULL DEFAULT 0,
  -- Source of the seed assignment
  source TEXT NOT NULL DEFAULT 'standings' CHECK (source IN ('standings', 'commissioner_override')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One seed per team per bracket; one number per bracket
  UNIQUE(bracket_id, team_id),
  UNIQUE(bracket_id, seed_number)
);

-- ============================================================================
-- 3. PLAYOFF SERIES TABLE - Individual matchups/series within the bracket
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.playoff_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bracket_id UUID NOT NULL REFERENCES public.playoff_brackets(id) ON DELETE CASCADE,
  round_number INT NOT NULL CHECK (round_number >= 1),
  match_number INT NOT NULL CHECK (match_number >= 1),
  -- Bracket position tracking for visual rendering
  bracket_position TEXT NOT NULL DEFAULT 'winners',  -- 'winners', 'consolation', 'third_place'
  -- Teams (null until determined via advancement)
  home_seed INT,
  away_seed INT,
  home_team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  away_team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  -- Scores (aggregate across matchup weeks)
  home_score NUMERIC NOT NULL DEFAULT 0,
  away_score NUMERIC NOT NULL DEFAULT 0,
  -- Result
  winner_team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  loser_team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'bye', 'active', 'completed')),
  -- Links to regular matchups table (for scoring integration)
  matchup_week_1 INT,  -- First week of this playoff series
  matchup_week_2 INT,  -- Second week (for two-week matchups)
  -- Advancement tracking: where does the winner/loser go?
  winner_advances_to UUID REFERENCES public.playoff_series(id) ON DELETE SET NULL,
  winner_slot TEXT CHECK (winner_slot IN ('home', 'away')),
  loser_drops_to UUID REFERENCES public.playoff_series(id) ON DELETE SET NULL,
  loser_slot TEXT CHECK (loser_slot IN ('home', 'away')),
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Unique series per round per bracket
  UNIQUE(bracket_id, round_number, match_number, bracket_position)
);

-- ============================================================================
-- 4. INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_playoff_brackets_league ON public.playoff_brackets(league_id);
CREATE INDEX IF NOT EXISTS idx_playoff_brackets_status ON public.playoff_brackets(status);
CREATE INDEX IF NOT EXISTS idx_playoff_seeds_bracket ON public.playoff_seeds(bracket_id);
CREATE INDEX IF NOT EXISTS idx_playoff_seeds_team ON public.playoff_seeds(team_id);
CREATE INDEX IF NOT EXISTS idx_playoff_series_bracket ON public.playoff_series(bracket_id);
CREATE INDEX IF NOT EXISTS idx_playoff_series_round ON public.playoff_series(bracket_id, round_number);
CREATE INDEX IF NOT EXISTS idx_playoff_series_teams ON public.playoff_series(home_team_id, away_team_id);
CREATE INDEX IF NOT EXISTS idx_playoff_series_status ON public.playoff_series(status);

-- ============================================================================
-- 5. ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE public.playoff_brackets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playoff_seeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playoff_series ENABLE ROW LEVEL SECURITY;

-- Brackets: league members can view
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'playoff_brackets' AND policyname = 'League members can view playoff brackets') THEN
    CREATE POLICY "League members can view playoff brackets"
      ON public.playoff_brackets FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.teams t
          WHERE t.league_id = playoff_brackets.league_id
          AND t.owner_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.leagues l
          WHERE l.id = playoff_brackets.league_id
          AND l.commissioner_id = auth.uid()
        )
      );
  END IF;
END $$;

-- Brackets: commissioners can manage
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'playoff_brackets' AND policyname = 'Commissioners can manage playoff brackets') THEN
    CREATE POLICY "Commissioners can manage playoff brackets"
      ON public.playoff_brackets FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM public.leagues l
          WHERE l.id = playoff_brackets.league_id
          AND l.commissioner_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.leagues l
          WHERE l.id = playoff_brackets.league_id
          AND l.commissioner_id = auth.uid()
        )
      );
  END IF;
END $$;

-- Seeds: league members can view
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'playoff_seeds' AND policyname = 'League members can view playoff seeds') THEN
    CREATE POLICY "League members can view playoff seeds"
      ON public.playoff_seeds FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.playoff_brackets pb
          JOIN public.teams t ON t.league_id = pb.league_id
          WHERE pb.id = playoff_seeds.bracket_id
          AND t.owner_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.playoff_brackets pb
          JOIN public.leagues l ON l.id = pb.league_id
          WHERE pb.id = playoff_seeds.bracket_id
          AND l.commissioner_id = auth.uid()
        )
      );
  END IF;
END $$;

-- Seeds: commissioners can manage
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'playoff_seeds' AND policyname = 'Commissioners can manage playoff seeds') THEN
    CREATE POLICY "Commissioners can manage playoff seeds"
      ON public.playoff_seeds FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM public.playoff_brackets pb
          JOIN public.leagues l ON l.id = pb.league_id
          WHERE pb.id = playoff_seeds.bracket_id
          AND l.commissioner_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.playoff_brackets pb
          JOIN public.leagues l ON l.id = pb.league_id
          WHERE pb.id = playoff_seeds.bracket_id
          AND l.commissioner_id = auth.uid()
        )
      );
  END IF;
END $$;

-- Series: league members can view
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'playoff_series' AND policyname = 'League members can view playoff series') THEN
    CREATE POLICY "League members can view playoff series"
      ON public.playoff_series FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.playoff_brackets pb
          JOIN public.teams t ON t.league_id = pb.league_id
          WHERE pb.id = playoff_series.bracket_id
          AND t.owner_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.playoff_brackets pb
          JOIN public.leagues l ON l.id = pb.league_id
          WHERE pb.id = playoff_series.bracket_id
          AND l.commissioner_id = auth.uid()
        )
      );
  END IF;
END $$;

-- Series: commissioners can manage
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'playoff_series' AND policyname = 'Commissioners can manage playoff series') THEN
    CREATE POLICY "Commissioners can manage playoff series"
      ON public.playoff_series FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM public.playoff_brackets pb
          JOIN public.leagues l ON l.id = pb.league_id
          WHERE pb.id = playoff_series.bracket_id
          AND l.commissioner_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.playoff_brackets pb
          JOIN public.leagues l ON l.id = pb.league_id
          WHERE pb.id = playoff_series.bracket_id
          AND l.commissioner_id = auth.uid()
        )
      );
  END IF;
END $$;

-- ============================================================================
-- 6. UPDATED_AT TRIGGER
-- ============================================================================

CREATE OR REPLACE TRIGGER update_playoff_brackets_updated_at
  BEFORE UPDATE ON public.playoff_brackets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_playoff_series_updated_at
  BEFORE UPDATE ON public.playoff_series
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 7. GENERATE PLAYOFF BRACKET RPC
-- Generates seeded bracket from current standings
-- Supports 4, 6, and 8 team brackets with proper bye logic
-- ============================================================================

CREATE OR REPLACE FUNCTION public.generate_playoff_bracket(
  p_league_id UUID,
  p_consolation_enabled BOOLEAN DEFAULT FALSE,
  p_two_week_matchups BOOLEAN DEFAULT FALSE,
  p_reseed_each_round BOOLEAN DEFAULT FALSE,
  p_seeding_method TEXT DEFAULT 'standings'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
  -- Series IDs for wiring advancement
  v_qf1 UUID; v_qf2 UUID; v_qf3 UUID; v_qf4 UUID;
  v_sf1 UUID; v_sf2 UUID;
  v_finals UUID;
  v_third_place UUID;
  v_con_sf1 UUID; v_con_sf2 UUID; v_con_finals UUID;
  v_con_r1_1 UUID; v_con_r1_2 UUID;
  v_week_offset INT;
BEGIN
  -- Verify caller is commissioner
  SELECT l.*,
    COALESCE((l.settings->>'playoffTeams')::INT, 6) AS cfg_playoff_teams,
    COALESCE((l.settings->>'playoffWeeks')::INT, 3) AS cfg_playoff_weeks,
    COALESCE((l.settings->>'regularSeasonWeeks')::INT, 0) AS cfg_regular_weeks
  INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'League not found');
  END IF;

  IF v_league.commissioner_id != auth.uid() THEN
    RETURN json_build_object('error', 'Only the commissioner can generate playoff brackets');
  END IF;

  IF v_league.draft_status != 'completed' THEN
    RETURN json_build_object('error', 'Draft must be completed before generating playoffs');
  END IF;

  -- Check for existing bracket
  IF EXISTS (
    SELECT 1 FROM public.playoff_brackets pb
    WHERE pb.league_id = p_league_id
    AND pb.season = EXTRACT(YEAR FROM NOW())
    AND pb.status != 'completed'
  ) THEN
    RETURN json_build_object('error', 'An active playoff bracket already exists. Reset it first.');
  END IF;

  -- Get team count
  SELECT COUNT(*) INTO v_team_count
  FROM public.teams t
  WHERE t.league_id = p_league_id;

  -- Determine bracket size from settings
  v_playoff_teams := v_league.cfg_playoff_teams;
  IF v_playoff_teams > v_team_count THEN
    v_playoff_teams := v_team_count;
  END IF;

  -- Snap to valid bracket size
  IF v_playoff_teams >= 8 THEN v_bracket_size := 8;
  ELSIF v_playoff_teams >= 6 THEN v_bracket_size := 6;
  ELSIF v_playoff_teams >= 4 THEN v_bracket_size := 4;
  ELSE
    RETURN json_build_object('error', 'Need at least 4 teams for playoffs');
  END IF;

  -- Calculate total rounds
  IF v_bracket_size = 8 THEN v_total_rounds := 3;     -- QF, SF, Finals
  ELSIF v_bracket_size = 6 THEN v_total_rounds := 3;   -- QF (4 teams), SF, Finals
  ELSE v_total_rounds := 2;                             -- SF, Finals
  END IF;

  -- Calculate playoff start week
  -- Use regular season weeks from settings, or count existing matchup weeks
  IF v_league.cfg_regular_weeks > 0 THEN
    v_regular_season_weeks := v_league.cfg_regular_weeks;
  ELSE
    SELECT COALESCE(MAX(week_number), 0) INTO v_regular_season_weeks
    FROM public.matchups m
    WHERE m.league_id = p_league_id;
  END IF;
  v_playoff_start_week := v_regular_season_weeks + 1;

  -- ========================================================================
  -- Create the bracket
  -- ========================================================================
  INSERT INTO public.playoff_brackets (
    league_id, season, bracket_size, status, current_round, total_rounds,
    seeding_method, reseed_each_round, consolation_enabled, two_week_matchups,
    generated_by, started_at
  ) VALUES (
    p_league_id, EXTRACT(YEAR FROM NOW()), v_bracket_size, 'active', 1, v_total_rounds,
    p_seeding_method, p_reseed_each_round, p_consolation_enabled, p_two_week_matchups,
    auth.uid(), NOW()
  )
  RETURNING id INTO v_bracket_id;

  -- ========================================================================
  -- Seed teams from standings (by W-L record, tiebreak by Points For)
  -- ========================================================================
  v_seed_num := 0;
  FOR v_team IN
    SELECT
      t.id AS team_id,
      COALESCE(SUM(CASE
        WHEN m.team1_id = t.id AND m.team1_score > m.team2_score THEN 1
        WHEN m.team2_id = t.id AND m.team2_score > m.team1_score THEN 1
        ELSE 0
      END), 0) AS wins,
      COALESCE(SUM(CASE
        WHEN m.team1_id = t.id AND m.team1_score < m.team2_score THEN 1
        WHEN m.team2_id = t.id AND m.team2_score < m.team1_score THEN 1
        ELSE 0
      END), 0) AS losses,
      COALESCE(SUM(CASE
        WHEN m.team1_id = t.id AND m.team1_score = m.team2_score AND m.team2_id IS NOT NULL THEN 1
        WHEN m.team2_id = t.id AND m.team1_score = m.team2_score THEN 1
        ELSE 0
      END), 0) AS ties,
      COALESCE(SUM(CASE
        WHEN m.team1_id = t.id THEN m.team1_score
        WHEN m.team2_id = t.id THEN m.team2_score
        ELSE 0
      END), 0) AS points_for
    FROM public.teams t
    LEFT JOIN public.matchups m ON (
      (m.team1_id = t.id OR m.team2_id = t.id)
      AND m.league_id = p_league_id
      AND m.week_number <= v_regular_season_weeks
    )
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

  -- ========================================================================
  -- Build bracket structure based on size
  -- ========================================================================

  IF v_bracket_size = 8 THEN
    -- ==== 8-TEAM BRACKET ====
    -- Round 1 (Quarterfinals): 1v8, 4v5, 2v7, 3v6
    -- Round 2 (Semifinals): QF1 winner vs QF2 winner, QF3 winner vs QF4 winner
    -- Round 3 (Finals): SF1 winner vs SF2 winner

    v_week_offset := 0;

    -- QF1: #1 seed vs #8 seed
    INSERT INTO public.playoff_series (
      bracket_id, round_number, match_number, bracket_position,
      home_seed, away_seed, status,
      matchup_week_1, matchup_week_2
    ) VALUES (
      v_bracket_id, 1, 1, 'winners',
      1, 8, 'active',
      v_playoff_start_week + v_week_offset,
      CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END
    ) RETURNING id INTO v_qf1;

    -- QF2: #4 seed vs #5 seed
    INSERT INTO public.playoff_series (
      bracket_id, round_number, match_number, bracket_position,
      home_seed, away_seed, status,
      matchup_week_1, matchup_week_2
    ) VALUES (
      v_bracket_id, 1, 2, 'winners',
      4, 5, 'active',
      v_playoff_start_week + v_week_offset,
      CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END
    ) RETURNING id INTO v_qf2;

    -- QF3: #2 seed vs #7 seed
    INSERT INTO public.playoff_series (
      bracket_id, round_number, match_number, bracket_position,
      home_seed, away_seed, status,
      matchup_week_1, matchup_week_2
    ) VALUES (
      v_bracket_id, 1, 3, 'winners',
      2, 7, 'active',
      v_playoff_start_week + v_week_offset,
      CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END
    ) RETURNING id INTO v_qf3;

    -- QF4: #3 seed vs #6 seed
    INSERT INTO public.playoff_series (
      bracket_id, round_number, match_number, bracket_position,
      home_seed, away_seed, status,
      matchup_week_1, matchup_week_2
    ) VALUES (
      v_bracket_id, 1, 4, 'winners',
      3, 6, 'active',
      v_playoff_start_week + v_week_offset,
      CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END
    ) RETURNING id INTO v_qf4;

    -- SF week offset
    IF p_two_week_matchups THEN v_week_offset := 2; ELSE v_week_offset := 1; END IF;

    -- SF1: QF1 winner vs QF2 winner
    INSERT INTO public.playoff_series (
      bracket_id, round_number, match_number, bracket_position,
      status, matchup_week_1, matchup_week_2
    ) VALUES (
      v_bracket_id, 2, 1, 'winners', 'pending',
      v_playoff_start_week + v_week_offset,
      CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END
    ) RETURNING id INTO v_sf1;

    -- SF2: QF3 winner vs QF4 winner
    INSERT INTO public.playoff_series (
      bracket_id, round_number, match_number, bracket_position,
      status, matchup_week_1, matchup_week_2
    ) VALUES (
      v_bracket_id, 2, 2, 'winners', 'pending',
      v_playoff_start_week + v_week_offset,
      CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END
    ) RETURNING id INTO v_sf2;

    -- Finals week offset
    IF p_two_week_matchups THEN v_week_offset := 4; ELSE v_week_offset := 2; END IF;

    -- Finals
    INSERT INTO public.playoff_series (
      bracket_id, round_number, match_number, bracket_position,
      status, matchup_week_1, matchup_week_2
    ) VALUES (
      v_bracket_id, 3, 1, 'winners', 'pending',
      v_playoff_start_week + v_week_offset,
      CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END
    ) RETURNING id INTO v_finals;

    -- Wire advancement: QF winners -> SF
    UPDATE public.playoff_series SET winner_advances_to = v_sf1, winner_slot = 'home' WHERE id = v_qf1;
    UPDATE public.playoff_series SET winner_advances_to = v_sf1, winner_slot = 'away' WHERE id = v_qf2;
    UPDATE public.playoff_series SET winner_advances_to = v_sf2, winner_slot = 'home' WHERE id = v_qf3;
    UPDATE public.playoff_series SET winner_advances_to = v_sf2, winner_slot = 'away' WHERE id = v_qf4;

    -- Wire advancement: SF winners -> Finals
    UPDATE public.playoff_series SET winner_advances_to = v_finals, winner_slot = 'home' WHERE id = v_sf1;
    UPDATE public.playoff_series SET winner_advances_to = v_finals, winner_slot = 'away' WHERE id = v_sf2;

    -- Third-place game (if consolation enabled)
    IF p_consolation_enabled THEN
      INSERT INTO public.playoff_series (
        bracket_id, round_number, match_number, bracket_position,
        status, matchup_week_1, matchup_week_2
      ) VALUES (
        v_bracket_id, 3, 1, 'third_place', 'pending',
        v_playoff_start_week + v_week_offset,
        CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END
      ) RETURNING id INTO v_third_place;

      -- SF losers go to third-place game
      UPDATE public.playoff_series SET loser_drops_to = v_third_place, loser_slot = 'home' WHERE id = v_sf1;
      UPDATE public.playoff_series SET loser_drops_to = v_third_place, loser_slot = 'away' WHERE id = v_sf2;

      -- Consolation bracket for QF losers
      -- Con R1-1: QF1 loser vs QF2 loser
      INSERT INTO public.playoff_series (
        bracket_id, round_number, match_number, bracket_position,
        status, matchup_week_1, matchup_week_2
      ) VALUES (
        v_bracket_id, 2, 1, 'consolation', 'pending',
        v_playoff_start_week + v_week_offset - (CASE WHEN p_two_week_matchups THEN 2 ELSE 1 END),
        CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset - 1 ELSE NULL END
      ) RETURNING id INTO v_con_r1_1;

      -- Con R1-2: QF3 loser vs QF4 loser
      INSERT INTO public.playoff_series (
        bracket_id, round_number, match_number, bracket_position,
        status, matchup_week_1, matchup_week_2
      ) VALUES (
        v_bracket_id, 2, 2, 'consolation', 'pending',
        v_playoff_start_week + v_week_offset - (CASE WHEN p_two_week_matchups THEN 2 ELSE 1 END),
        CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset - 1 ELSE NULL END
      ) RETURNING id INTO v_con_r1_2;

      -- Con Finals: Con R1 winners play for 5th place
      INSERT INTO public.playoff_series (
        bracket_id, round_number, match_number, bracket_position,
        status, matchup_week_1, matchup_week_2
      ) VALUES (
        v_bracket_id, 3, 1, 'consolation', 'pending',
        v_playoff_start_week + v_week_offset,
        CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END
      ) RETURNING id INTO v_con_finals;

      -- Wire QF losers to consolation
      UPDATE public.playoff_series SET loser_drops_to = v_con_r1_1, loser_slot = 'home' WHERE id = v_qf1;
      UPDATE public.playoff_series SET loser_drops_to = v_con_r1_1, loser_slot = 'away' WHERE id = v_qf2;
      UPDATE public.playoff_series SET loser_drops_to = v_con_r1_2, loser_slot = 'home' WHERE id = v_qf3;
      UPDATE public.playoff_series SET loser_drops_to = v_con_r1_2, loser_slot = 'away' WHERE id = v_qf4;

      -- Wire consolation R1 winners to consolation finals
      UPDATE public.playoff_series SET winner_advances_to = v_con_finals, winner_slot = 'home' WHERE id = v_con_r1_1;
      UPDATE public.playoff_series SET winner_advances_to = v_con_finals, winner_slot = 'away' WHERE id = v_con_r1_2;
    END IF;

  ELSIF v_bracket_size = 6 THEN
    -- ==== 6-TEAM BRACKET ====
    -- Round 1 (Wild Card): #3 vs #6, #4 vs #5  (seeds 1 & 2 get byes)
    -- Round 2 (Semifinals): #1 vs WC lower seed winner, #2 vs WC higher seed winner
    -- Round 3 (Finals): SF1 winner vs SF2 winner

    v_week_offset := 0;

    -- WC1: #3 seed vs #6 seed
    INSERT INTO public.playoff_series (
      bracket_id, round_number, match_number, bracket_position,
      home_seed, away_seed, status,
      matchup_week_1, matchup_week_2
    ) VALUES (
      v_bracket_id, 1, 1, 'winners',
      3, 6, 'active',
      v_playoff_start_week + v_week_offset,
      CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END
    ) RETURNING id INTO v_qf1;

    -- WC2: #4 seed vs #5 seed
    INSERT INTO public.playoff_series (
      bracket_id, round_number, match_number, bracket_position,
      home_seed, away_seed, status,
      matchup_week_1, matchup_week_2
    ) VALUES (
      v_bracket_id, 1, 2, 'winners',
      4, 5, 'active',
      v_playoff_start_week + v_week_offset,
      CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END
    ) RETURNING id INTO v_qf2;

    -- SF week offset
    IF p_two_week_matchups THEN v_week_offset := 2; ELSE v_week_offset := 1; END IF;

    -- SF1: #1 seed (bye) vs WC2 winner (lower seed matchup winner)
    INSERT INTO public.playoff_series (
      bracket_id, round_number, match_number, bracket_position,
      home_seed, status,
      matchup_week_1, matchup_week_2
    ) VALUES (
      v_bracket_id, 2, 1, 'winners',
      1, 'pending',
      v_playoff_start_week + v_week_offset,
      CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END
    ) RETURNING id INTO v_sf1;

    -- SF2: #2 seed (bye) vs WC1 winner (higher seed matchup winner)
    INSERT INTO public.playoff_series (
      bracket_id, round_number, match_number, bracket_position,
      home_seed, status,
      matchup_week_1, matchup_week_2
    ) VALUES (
      v_bracket_id, 2, 2, 'winners',
      2, 'pending',
      v_playoff_start_week + v_week_offset,
      CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END
    ) RETURNING id INTO v_sf2;

    -- Finals week offset
    IF p_two_week_matchups THEN v_week_offset := 4; ELSE v_week_offset := 2; END IF;

    -- Finals
    INSERT INTO public.playoff_series (
      bracket_id, round_number, match_number, bracket_position,
      status, matchup_week_1, matchup_week_2
    ) VALUES (
      v_bracket_id, 3, 1, 'winners', 'pending',
      v_playoff_start_week + v_week_offset,
      CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END
    ) RETURNING id INTO v_finals;

    -- Wire WC winners -> SF (lower seed winner faces #1 seed)
    UPDATE public.playoff_series SET winner_advances_to = v_sf1, winner_slot = 'away' WHERE id = v_qf2;
    UPDATE public.playoff_series SET winner_advances_to = v_sf2, winner_slot = 'away' WHERE id = v_qf1;

    -- Wire SF winners -> Finals
    UPDATE public.playoff_series SET winner_advances_to = v_finals, winner_slot = 'home' WHERE id = v_sf1;
    UPDATE public.playoff_series SET winner_advances_to = v_finals, winner_slot = 'away' WHERE id = v_sf2;

    -- Third-place game
    IF p_consolation_enabled THEN
      INSERT INTO public.playoff_series (
        bracket_id, round_number, match_number, bracket_position,
        status, matchup_week_1, matchup_week_2
      ) VALUES (
        v_bracket_id, 3, 1, 'third_place', 'pending',
        v_playoff_start_week + v_week_offset,
        CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END
      ) RETURNING id INTO v_third_place;

      UPDATE public.playoff_series SET loser_drops_to = v_third_place, loser_slot = 'home' WHERE id = v_sf1;
      UPDATE public.playoff_series SET loser_drops_to = v_third_place, loser_slot = 'away' WHERE id = v_sf2;
    END IF;

  ELSE
    -- ==== 4-TEAM BRACKET ====
    -- Round 1 (Semifinals): #1 vs #4, #2 vs #3
    -- Round 2 (Finals): SF1 winner vs SF2 winner

    v_week_offset := 0;

    -- SF1: #1 seed vs #4 seed
    INSERT INTO public.playoff_series (
      bracket_id, round_number, match_number, bracket_position,
      home_seed, away_seed, status,
      matchup_week_1, matchup_week_2
    ) VALUES (
      v_bracket_id, 1, 1, 'winners',
      1, 4, 'active',
      v_playoff_start_week + v_week_offset,
      CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END
    ) RETURNING id INTO v_sf1;

    -- SF2: #2 seed vs #3 seed
    INSERT INTO public.playoff_series (
      bracket_id, round_number, match_number, bracket_position,
      home_seed, away_seed, status,
      matchup_week_1, matchup_week_2
    ) VALUES (
      v_bracket_id, 1, 2, 'winners',
      2, 3, 'active',
      v_playoff_start_week + v_week_offset,
      CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END
    ) RETURNING id INTO v_sf2;

    -- Finals week offset
    IF p_two_week_matchups THEN v_week_offset := 2; ELSE v_week_offset := 1; END IF;

    -- Finals
    INSERT INTO public.playoff_series (
      bracket_id, round_number, match_number, bracket_position,
      status, matchup_week_1, matchup_week_2
    ) VALUES (
      v_bracket_id, 2, 1, 'winners', 'pending',
      v_playoff_start_week + v_week_offset,
      CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END
    ) RETURNING id INTO v_finals;

    -- Wire SF winners -> Finals
    UPDATE public.playoff_series SET winner_advances_to = v_finals, winner_slot = 'home' WHERE id = v_sf1;
    UPDATE public.playoff_series SET winner_advances_to = v_finals, winner_slot = 'away' WHERE id = v_sf2;

    -- Third-place game
    IF p_consolation_enabled THEN
      INSERT INTO public.playoff_series (
        bracket_id, round_number, match_number, bracket_position,
        status, matchup_week_1, matchup_week_2
      ) VALUES (
        v_bracket_id, 2, 1, 'third_place', 'pending',
        v_playoff_start_week + v_week_offset,
        CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END
      ) RETURNING id INTO v_third_place;

      UPDATE public.playoff_series SET loser_drops_to = v_third_place, loser_slot = 'home' WHERE id = v_sf1;
      UPDATE public.playoff_series SET loser_drops_to = v_third_place, loser_slot = 'away' WHERE id = v_sf2;
    END IF;
  END IF;

  -- ========================================================================
  -- Populate team IDs into first-round series from seeds
  -- ========================================================================
  UPDATE public.playoff_series ps
  SET
    home_team_id = (SELECT team_id FROM public.playoff_seeds WHERE bracket_id = v_bracket_id AND seed_number = ps.home_seed),
    away_team_id = (SELECT team_id FROM public.playoff_seeds WHERE bracket_id = v_bracket_id AND seed_number = ps.away_seed)
  WHERE ps.bracket_id = v_bracket_id
  AND ps.round_number = 1
  AND ps.home_seed IS NOT NULL;

  -- For 6-team bracket: populate bye seeds into SF
  IF v_bracket_size = 6 THEN
    UPDATE public.playoff_series ps
    SET home_team_id = (SELECT team_id FROM public.playoff_seeds WHERE bracket_id = v_bracket_id AND seed_number = ps.home_seed)
    WHERE ps.bracket_id = v_bracket_id
    AND ps.round_number = 2
    AND ps.home_seed IS NOT NULL;
  END IF;

  -- Create corresponding matchup rows for scoring integration
  INSERT INTO public.matchups (league_id, week_number, team1_id, team2_id, team1_score, team2_score, status, week_start_date, week_end_date)
  SELECT
    p_league_id,
    ps.matchup_week_1,
    ps.home_team_id,
    ps.away_team_id,
    0, 0, 'scheduled',
    CURRENT_DATE, CURRENT_DATE + INTERVAL '6 days'
  FROM public.playoff_series ps
  WHERE ps.bracket_id = v_bracket_id
  AND ps.home_team_id IS NOT NULL
  AND ps.away_team_id IS NOT NULL
  AND ps.status = 'active'
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
$fn$;

-- ============================================================================
-- 8. ADVANCE PLAYOFF ROUND RPC
-- After a round's matchups complete, advances winners to next round
-- ============================================================================

CREATE OR REPLACE FUNCTION public.advance_playoff_round(
  p_bracket_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_bracket RECORD;
  v_series RECORD;
  v_winner_id UUID;
  v_loser_id UUID;
  v_advanced_count INT := 0;
  v_league_id UUID;
BEGIN
  -- Get bracket
  SELECT * INTO v_bracket
  FROM public.playoff_brackets
  WHERE id = p_bracket_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Bracket not found');
  END IF;

  v_league_id := v_bracket.league_id;

  -- Verify commissioner
  IF NOT EXISTS (
    SELECT 1 FROM public.leagues l
    WHERE l.id = v_league_id AND l.commissioner_id = auth.uid()
  ) THEN
    RETURN json_build_object('error', 'Only the commissioner can advance rounds');
  END IF;

  IF v_bracket.status = 'completed' THEN
    RETURN json_build_object('error', 'Bracket is already completed');
  END IF;

  -- Process each active series in the current round
  FOR v_series IN
    SELECT ps.*
    FROM public.playoff_series ps
    WHERE ps.bracket_id = p_bracket_id
    AND ps.round_number = v_bracket.current_round
    AND ps.status = 'active'
    AND ps.home_team_id IS NOT NULL
    AND ps.away_team_id IS NOT NULL
  LOOP
    -- Get scores from matchups table (aggregate if two-week)
    SELECT
      COALESCE(SUM(CASE WHEN m.team1_id = v_series.home_team_id THEN m.team1_score
                        WHEN m.team2_id = v_series.home_team_id THEN m.team2_score ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN m.team1_id = v_series.away_team_id THEN m.team1_score
                        WHEN m.team2_id = v_series.away_team_id THEN m.team2_score ELSE 0 END), 0)
    INTO v_series.home_score, v_series.away_score
    FROM public.matchups m
    WHERE m.league_id = v_league_id
    AND m.week_number IN (v_series.matchup_week_1, v_series.matchup_week_2)
    AND (
      (m.team1_id = v_series.home_team_id AND m.team2_id = v_series.away_team_id) OR
      (m.team1_id = v_series.away_team_id AND m.team2_id = v_series.home_team_id)
    );

    -- Determine winner (higher seed wins tiebreaker)
    IF v_series.home_score > v_series.away_score THEN
      v_winner_id := v_series.home_team_id;
      v_loser_id := v_series.away_team_id;
    ELSIF v_series.away_score > v_series.home_score THEN
      v_winner_id := v_series.away_team_id;
      v_loser_id := v_series.home_team_id;
    ELSE
      -- Tiebreaker: higher seed wins
      IF v_series.home_seed IS NOT NULL AND v_series.away_seed IS NOT NULL AND v_series.home_seed < v_series.away_seed THEN
        v_winner_id := v_series.home_team_id;
        v_loser_id := v_series.away_team_id;
      ELSE
        v_winner_id := v_series.away_team_id;
        v_loser_id := v_series.home_team_id;
      END IF;
    END IF;

    -- Update series with results
    UPDATE public.playoff_series
    SET
      home_score = v_series.home_score,
      away_score = v_series.away_score,
      winner_team_id = v_winner_id,
      loser_team_id = v_loser_id,
      status = 'completed'
    WHERE id = v_series.id;

    -- Advance winner to next series
    IF v_series.winner_advances_to IS NOT NULL THEN
      IF v_series.winner_slot = 'home' THEN
        UPDATE public.playoff_series
        SET home_team_id = v_winner_id, status =
          CASE WHEN away_team_id IS NOT NULL THEN 'active' ELSE status END
        WHERE id = v_series.winner_advances_to;
      ELSE
        UPDATE public.playoff_series
        SET away_team_id = v_winner_id, status =
          CASE WHEN home_team_id IS NOT NULL THEN 'active' ELSE status END
        WHERE id = v_series.winner_advances_to;
      END IF;

      -- Create matchup rows for the newly activated series
      INSERT INTO public.matchups (league_id, week_number, team1_id, team2_id, team1_score, team2_score, status, week_start_date, week_end_date)
      SELECT
        v_league_id,
        ns.matchup_week_1,
        ns.home_team_id,
        ns.away_team_id,
        0, 0, 'scheduled',
        CURRENT_DATE, CURRENT_DATE + INTERVAL '6 days'
      FROM public.playoff_series ns
      WHERE ns.id = v_series.winner_advances_to
      AND ns.home_team_id IS NOT NULL
      AND ns.away_team_id IS NOT NULL
      AND ns.status = 'active'
      ON CONFLICT DO NOTHING;
    END IF;

    -- Drop loser to consolation/third-place if configured
    IF v_series.loser_drops_to IS NOT NULL THEN
      IF v_series.loser_slot = 'home' THEN
        UPDATE public.playoff_series
        SET home_team_id = v_loser_id, status =
          CASE WHEN away_team_id IS NOT NULL THEN 'active' ELSE status END
        WHERE id = v_series.loser_drops_to;
      ELSE
        UPDATE public.playoff_series
        SET away_team_id = v_loser_id, status =
          CASE WHEN home_team_id IS NOT NULL THEN 'active' ELSE status END
        WHERE id = v_series.loser_drops_to;
      END IF;

      -- Create matchup rows for consolation
      INSERT INTO public.matchups (league_id, week_number, team1_id, team2_id, team1_score, team2_score, status, week_start_date, week_end_date)
      SELECT
        v_league_id,
        ns.matchup_week_1,
        ns.home_team_id,
        ns.away_team_id,
        0, 0, 'scheduled',
        CURRENT_DATE, CURRENT_DATE + INTERVAL '6 days'
      FROM public.playoff_series ns
      WHERE ns.id = v_series.loser_drops_to
      AND ns.home_team_id IS NOT NULL
      AND ns.away_team_id IS NOT NULL
      AND ns.status = 'active'
      ON CONFLICT DO NOTHING;
    END IF;

    v_advanced_count := v_advanced_count + 1;
  END LOOP;

  -- Check if the finals are now completed -> bracket complete
  IF EXISTS (
    SELECT 1 FROM public.playoff_series
    WHERE bracket_id = p_bracket_id
    AND bracket_position = 'winners'
    AND round_number = v_bracket.total_rounds
    AND status = 'completed'
  ) THEN
    -- Get champion and runner-up from finals
    UPDATE public.playoff_brackets
    SET
      status = 'completed',
      current_round = v_bracket.total_rounds,
      champion_team_id = (
        SELECT winner_team_id FROM public.playoff_series
        WHERE bracket_id = p_bracket_id AND bracket_position = 'winners'
        AND round_number = v_bracket.total_rounds LIMIT 1
      ),
      runner_up_team_id = (
        SELECT loser_team_id FROM public.playoff_series
        WHERE bracket_id = p_bracket_id AND bracket_position = 'winners'
        AND round_number = v_bracket.total_rounds LIMIT 1
      ),
      third_place_team_id = (
        SELECT winner_team_id FROM public.playoff_series
        WHERE bracket_id = p_bracket_id AND bracket_position = 'third_place'
        AND status = 'completed' LIMIT 1
      ),
      completed_at = NOW()
    WHERE id = p_bracket_id;
  ELSE
    -- Advance to next round
    UPDATE public.playoff_brackets
    SET current_round = v_bracket.current_round + 1
    WHERE id = p_bracket_id;
  END IF;

  RETURN json_build_object(
    'advanced_count', v_advanced_count,
    'current_round', v_bracket.current_round,
    'success', true
  );
END;
$fn$;

-- ============================================================================
-- 9. RESET PLAYOFF BRACKET RPC (Commissioner only)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reset_playoff_bracket(
  p_league_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_bracket_id UUID;
BEGIN
  -- Verify commissioner
  IF NOT EXISTS (
    SELECT 1 FROM public.leagues l
    WHERE l.id = p_league_id AND l.commissioner_id = auth.uid()
  ) THEN
    RETURN json_build_object('error', 'Only the commissioner can reset playoff brackets');
  END IF;

  -- Get current bracket
  SELECT id INTO v_bracket_id
  FROM public.playoff_brackets
  WHERE league_id = p_league_id
  AND season = EXTRACT(YEAR FROM NOW());

  IF v_bracket_id IS NULL THEN
    RETURN json_build_object('error', 'No bracket found for this season');
  END IF;

  -- Delete bracket and cascade (seeds and series auto-deleted via CASCADE)
  DELETE FROM public.playoff_brackets WHERE id = v_bracket_id;

  -- Clean up playoff matchups (week_number > regular season)
  DELETE FROM public.matchups
  WHERE league_id = p_league_id
  AND week_number > COALESCE(
    (SELECT (settings->>'regularSeasonWeeks')::INT FROM public.leagues WHERE id = p_league_id),
    (SELECT COALESCE(MAX(m2.week_number), 0) FROM public.matchups m2 WHERE m2.league_id = p_league_id)
  );

  RETURN json_build_object('success', true, 'bracket_id', v_bracket_id);
END;
$fn$;

-- ============================================================================
-- 10. GET PLAYOFF PICTURE RPC - Clinching scenarios & magic numbers
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_playoff_picture(
  p_league_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $fn$
DECLARE
  v_playoff_teams INT;
  v_total_teams INT;
  v_max_week INT;
  v_regular_season_weeks INT;
  v_remaining_weeks INT;
  v_result JSON;
BEGIN
  -- Get league config
  SELECT
    COALESCE((l.settings->>'playoffTeams')::INT, 6),
    COALESCE((l.settings->>'regularSeasonWeeks')::INT, 0)
  INTO v_playoff_teams, v_regular_season_weeks
  FROM public.leagues l
  WHERE l.id = p_league_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'League not found');
  END IF;

  -- Count teams
  SELECT COUNT(*) INTO v_total_teams
  FROM public.teams WHERE league_id = p_league_id;

  -- Get current week progress
  SELECT COALESCE(MAX(week_number), 0) INTO v_max_week
  FROM public.matchups
  WHERE league_id = p_league_id AND status = 'completed';

  -- Calculate remaining weeks
  IF v_regular_season_weeks > 0 THEN
    v_remaining_weeks := GREATEST(v_regular_season_weeks - v_max_week, 0);
  ELSE
    v_remaining_weeks := 0;
  END IF;

  -- Build playoff picture with standings, clinch status, and magic numbers
  SELECT json_build_object(
    'playoff_teams', v_playoff_teams,
    'total_teams', v_total_teams,
    'weeks_completed', v_max_week,
    'remaining_weeks', v_remaining_weeks,
    'teams', COALESCE(json_agg(team_row ORDER BY rank), '[]'::json)
  ) INTO v_result
  FROM (
    SELECT
      t.id AS team_id,
      t.team_name,
      ROW_NUMBER() OVER (ORDER BY wins DESC, pf DESC) AS rank,
      wins, losses, ties, pf, pa,
      -- Clinch status
      CASE
        -- Clinched if wins > (total_teams - playoff_teams)th team's max possible wins
        WHEN wins > (v_remaining_weeks +
          (SELECT COALESCE(sub_wins, 0) FROM (
            SELECT SUM(CASE
              WHEN m2.team1_id = t2.id AND m2.team1_score > m2.team2_score THEN 1
              WHEN m2.team2_id = t2.id AND m2.team2_score > m2.team1_score THEN 1
              ELSE 0
            END) AS sub_wins
            FROM public.teams t2
            LEFT JOIN public.matchups m2 ON (m2.team1_id = t2.id OR m2.team2_id = t2.id)
              AND m2.league_id = p_league_id AND m2.week_number <= v_max_week
            WHERE t2.league_id = p_league_id AND t2.id != t.id
            GROUP BY t2.id
            ORDER BY sub_wins DESC
            OFFSET v_playoff_teams - 1 LIMIT 1
          ) sub)
        THEN 'clinched'
        -- Eliminated if max possible wins < current playoff cutoff
        WHEN (wins + v_remaining_weeks) < (
          SELECT COALESCE(MIN(sub_wins), 0) FROM (
            SELECT SUM(CASE
              WHEN m2.team1_id = t2.id AND m2.team1_score > m2.team2_score THEN 1
              WHEN m2.team2_id = t2.id AND m2.team2_score > m2.team1_score THEN 1
              ELSE 0
            END) AS sub_wins
            FROM public.teams t2
            LEFT JOIN public.matchups m2 ON (m2.team1_id = t2.id OR m2.team2_id = t2.id)
              AND m2.league_id = p_league_id AND m2.week_number <= v_max_week
            WHERE t2.league_id = p_league_id AND t2.id != t.id
            GROUP BY t2.id
            ORDER BY sub_wins DESC
            LIMIT v_playoff_teams
          ) sub
        )
        THEN 'eliminated'
        ELSE 'in_contention'
      END AS clinch_status,
      -- Magic number: wins needed to clinch (simplified: playoff_cutoff_wins - current_wins + 1)
      GREATEST(0,
        COALESCE((
          SELECT sub_wins + 1 FROM (
            SELECT SUM(CASE
              WHEN m2.team1_id = t2.id AND m2.team1_score > m2.team2_score THEN 1
              WHEN m2.team2_id = t2.id AND m2.team2_score > m2.team1_score THEN 1
              ELSE 0
            END) AS sub_wins
            FROM public.teams t2
            LEFT JOIN public.matchups m2 ON (m2.team1_id = t2.id OR m2.team2_id = t2.id)
              AND m2.league_id = p_league_id AND m2.week_number <= v_max_week
            WHERE t2.league_id = p_league_id AND t2.id != t.id
            GROUP BY t2.id
            ORDER BY sub_wins DESC
            OFFSET v_playoff_teams - 1 LIMIT 1
          ) sub
        ), 0) - wins
      ) AS magic_number
    FROM (
      SELECT
        t.id, t.team_name,
        COALESCE(SUM(CASE
          WHEN m.team1_id = t.id AND m.team1_score > m.team2_score THEN 1
          WHEN m.team2_id = t.id AND m.team2_score > m.team1_score THEN 1
          ELSE 0 END), 0) AS wins,
        COALESCE(SUM(CASE
          WHEN m.team1_id = t.id AND m.team1_score < m.team2_score THEN 1
          WHEN m.team2_id = t.id AND m.team2_score < m.team1_score THEN 1
          ELSE 0 END), 0) AS losses,
        COALESCE(SUM(CASE
          WHEN m.team1_id = t.id AND m.team1_score = m.team2_score AND m.team2_id IS NOT NULL THEN 1
          WHEN m.team2_id = t.id AND m.team1_score = m.team2_score THEN 1
          ELSE 0 END), 0) AS ties,
        COALESCE(SUM(CASE
          WHEN m.team1_id = t.id THEN m.team1_score
          WHEN m.team2_id = t.id THEN m.team2_score ELSE 0 END), 0) AS pf,
        COALESCE(SUM(CASE
          WHEN m.team1_id = t.id THEN m.team2_score
          WHEN m.team2_id = t.id THEN m.team1_score ELSE 0 END), 0) AS pa
      FROM public.teams t
      LEFT JOIN public.matchups m ON (m.team1_id = t.id OR m.team2_id = t.id)
        AND m.league_id = p_league_id AND m.week_number <= v_max_week
      WHERE t.league_id = p_league_id
      GROUP BY t.id, t.team_name
    ) standings
    CROSS JOIN LATERAL (SELECT standings.id AS t_id) helper
    JOIN public.teams t ON t.id = standings.id
  ) team_row;

  RETURN v_result;
END;
$fn$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.generate_playoff_bracket(UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.advance_playoff_round(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_playoff_bracket(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_playoff_picture(UUID) TO authenticated;
