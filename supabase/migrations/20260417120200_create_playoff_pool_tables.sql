-- Playoff Pool Tables
-- Bracket Pickem picks, Confidence picks, Roster picks, Standings

-- Bracket Pickem: pick winner + predicted games for each series
CREATE TABLE IF NOT EXISTS public.playoff_bracket_picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  series_slot SMALLINT NOT NULL,
  picked_team_id INTEGER NOT NULL REFERENCES public.nhl_teams(team_id),
  predicted_games SMALLINT CHECK (predicted_games BETWEEN 4 AND 7),
  is_correct BOOLEAN,
  points_earned NUMERIC(10,2) DEFAULT 0,
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (league_id, user_id, series_slot)
);

CREATE INDEX IF NOT EXISTS idx_playoff_bracket_picks_league ON public.playoff_bracket_picks(league_id, user_id);
CREATE INDEX IF NOT EXISTS idx_playoff_bracket_picks_slot ON public.playoff_bracket_picks(series_slot, picked_team_id);

-- Confidence Pool: pick winner + assign unique confidence value per series
CREATE TABLE IF NOT EXISTS public.playoff_confidence_picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  series_slot SMALLINT NOT NULL,
  picked_team_id INTEGER NOT NULL REFERENCES public.nhl_teams(team_id),
  confidence_value SMALLINT NOT NULL CHECK (confidence_value >= 1),
  is_correct BOOLEAN,
  points_earned NUMERIC(10,2) DEFAULT 0,
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (league_id, user_id, series_slot),
  UNIQUE (league_id, user_id, confidence_value)
);

CREATE INDEX IF NOT EXISTS idx_playoff_confidence_picks_league ON public.playoff_confidence_picks(league_id, user_id);

-- Roster Pool: each user picks N players from playoff teams (NOT exclusive — same player on multiple rosters)
CREATE TABLE IF NOT EXISTS public.playoff_roster_picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  player_id INTEGER NOT NULL,
  position_slot TEXT NOT NULL,
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (league_id, user_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_playoff_roster_picks_league ON public.playoff_roster_picks(league_id, user_id);

-- Shared standings table across all playoff pool types
CREATE TABLE IF NOT EXISTS public.playoff_pool_standings (
  league_id UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  total_points NUMERIC(10,2) NOT NULL DEFAULT 0,
  correct_picks INTEGER NOT NULL DEFAULT 0,
  current_rank INTEGER,
  last_updated TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (league_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_playoff_pool_standings_rank ON public.playoff_pool_standings(league_id, current_rank);

-- Player playoff-only stats (aggregated from game_stats where game_type=playoff)
CREATE TABLE IF NOT EXISTS public.player_playoff_stats (
  player_id INTEGER NOT NULL,
  season INTEGER NOT NULL,
  games_played SMALLINT DEFAULT 0,
  goals SMALLINT DEFAULT 0,
  assists SMALLINT DEFAULT 0,
  points SMALLINT DEFAULT 0,
  ppp SMALLINT DEFAULT 0,
  shp SMALLINT DEFAULT 0,
  shots SMALLINT DEFAULT 0,
  hits SMALLINT DEFAULT 0,
  blocks SMALLINT DEFAULT 0,
  pim SMALLINT DEFAULT 0,
  plus_minus SMALLINT DEFAULT 0,
  wins SMALLINT DEFAULT 0,
  saves INTEGER DEFAULT 0,
  shutouts SMALLINT DEFAULT 0,
  goals_against SMALLINT DEFAULT 0,
  is_goalie BOOLEAN DEFAULT false,
  team_abbrev TEXT,
  last_game_id INTEGER,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (player_id, season)
);

CREATE INDEX IF NOT EXISTS idx_player_playoff_stats_updated ON public.player_playoff_stats(updated_at DESC);

-- RLS for all new tables
ALTER TABLE public.playoff_bracket_picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playoff_confidence_picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playoff_roster_picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playoff_pool_standings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_playoff_stats ENABLE ROW LEVEL SECURITY;

-- Read: league members can see picks (own picks always visible)
CREATE POLICY "League members read bracket picks" ON public.playoff_bracket_picks
  FOR SELECT USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM public.teams t WHERE t.league_id = playoff_bracket_picks.league_id AND t.owner_id = auth.uid())
  );

CREATE POLICY "Users manage own bracket picks" ON public.playoff_bracket_picks
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "League members read confidence picks" ON public.playoff_confidence_picks
  FOR SELECT USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM public.teams t WHERE t.league_id = playoff_confidence_picks.league_id AND t.owner_id = auth.uid())
  );

CREATE POLICY "Users manage own confidence picks" ON public.playoff_confidence_picks
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "League members read roster picks" ON public.playoff_roster_picks
  FOR SELECT USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM public.teams t WHERE t.league_id = playoff_roster_picks.league_id AND t.owner_id = auth.uid())
  );

CREATE POLICY "Users manage own roster picks" ON public.playoff_roster_picks
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "League members read standings" ON public.playoff_pool_standings
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.teams t WHERE t.league_id = playoff_pool_standings.league_id AND t.owner_id = auth.uid())
  );

CREATE POLICY "Service role writes standings" ON public.playoff_pool_standings
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Anyone can read player playoff stats" ON public.player_playoff_stats
  FOR SELECT USING (true);

CREATE POLICY "Service role writes player playoff stats" ON public.player_playoff_stats
  FOR ALL USING (auth.role() = 'service_role');
