-- NHL Playoff Bracket Data Tables
-- Seeds (16 playoff teams per season) + Series (15 matchups across 4 rounds)

-- Playoff seedings (one row per team per season)
CREATE TABLE IF NOT EXISTS public.nhl_playoff_seeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season INTEGER NOT NULL,
  conference TEXT NOT NULL CHECK (conference IN ('Eastern', 'Western')),
  division TEXT NOT NULL CHECK (division IN ('Atlantic', 'Metropolitan', 'Central', 'Pacific', 'WildCard')),
  seed SMALLINT NOT NULL CHECK (seed BETWEEN 1 AND 8),
  team_id INTEGER NOT NULL REFERENCES public.nhl_teams(team_id),
  team_abbrev TEXT,
  wins SMALLINT,
  losses SMALLINT,
  ot_losses SMALLINT,
  points SMALLINT,
  row_wins SMALLINT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (season, conference, seed)
);

CREATE INDEX IF NOT EXISTS idx_nhl_playoff_seeds_season ON public.nhl_playoff_seeds(season);

-- Playoff series (15 total: 8 R1 + 4 R2 + 2 CF + 1 SCF)
CREATE TABLE IF NOT EXISTS public.nhl_playoff_series (
  series_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season INTEGER NOT NULL,
  round SMALLINT NOT NULL CHECK (round BETWEEN 1 AND 4),
  conference TEXT CHECK (conference IN ('Eastern', 'Western')),
  bracket_slot SMALLINT NOT NULL,
  parent_slot_a SMALLINT,
  parent_slot_b SMALLINT,
  high_seed_team_id INTEGER REFERENCES public.nhl_teams(team_id),
  low_seed_team_id INTEGER REFERENCES public.nhl_teams(team_id),
  high_seed_wins SMALLINT NOT NULL DEFAULT 0,
  low_seed_wins SMALLINT NOT NULL DEFAULT 0,
  winner_team_id INTEGER REFERENCES public.nhl_teams(team_id),
  games_played SMALLINT NOT NULL DEFAULT 0,
  series_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (series_status IN ('pending', 'active', 'final')),
  starts_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (season, round, bracket_slot)
);

CREATE INDEX IF NOT EXISTS idx_nhl_playoff_series_season_round ON public.nhl_playoff_series(season, round);
CREATE INDEX IF NOT EXISTS idx_nhl_playoff_series_active ON public.nhl_playoff_series(series_status) WHERE series_status = 'active';

-- Pipeline freshness tracking (prevents stale data)
CREATE TABLE IF NOT EXISTS public.nhl_pipeline_meta (
  key TEXT PRIMARY KEY,
  last_refresh TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.nhl_pipeline_meta (key, last_refresh)
VALUES ('playoff_seeds', now()), ('playoff_series', now()), ('player_playoff_stats', now())
ON CONFLICT (key) DO NOTHING;

-- RLS
ALTER TABLE public.nhl_playoff_seeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nhl_playoff_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nhl_pipeline_meta ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read playoff seeds" ON public.nhl_playoff_seeds FOR SELECT USING (true);
CREATE POLICY "Anyone can read playoff series" ON public.nhl_playoff_series FOR SELECT USING (true);
CREATE POLICY "Anyone can read pipeline meta" ON public.nhl_pipeline_meta FOR SELECT USING (true);
CREATE POLICY "Service role writes playoff seeds" ON public.nhl_playoff_seeds FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role writes playoff series" ON public.nhl_playoff_series FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role writes pipeline meta" ON public.nhl_pipeline_meta FOR ALL USING (auth.role() = 'service_role');
