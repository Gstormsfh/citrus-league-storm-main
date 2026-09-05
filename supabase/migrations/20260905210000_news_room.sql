-- THE CITRUS NEWS ROOM (2026-09-05). Garrett: "we have access to ESPN, NHL,
-- etc. There will be articles written about our players and it should come
-- through like Sleeper and Yahoo do, where it summarizes and links the
-- source." Until tonight /api/news proxied two wires straight through and
-- kept nothing; the player card's NEWS tab read only our own citrus_news
-- notes, so every card said "NEWS · 1".
--
-- Three tables:
--   news_sources      the wires we read (NHL.com content API, ESPN, RSS
--                     feeds, Bluesky beat writers), enabled per row.
--   news_items        one row per story: title, snippet, a one-sentence
--                     summary, the link out, the players it names
--                     (matched against player_directory by full name), the
--                     team. Unique on url, so a story is one row however
--                     many runs see it. We store the headline and the first
--                     paragraph and link to the source; never the article.
--   news_ingest_runs  one row per source per run: seen / inserted /
--                     matched / errors. The day the job dies silently the
--                     News Room header reads "updated 3 days ago" instead of
--                     nothing - the seven-months lesson.
--
-- Access: anyone signed in reads sources and items (news is not league
-- data); runs are read by signed-in users too, so the client can print the
-- freshness. Nothing here is written from the client - the ingest runs on
-- the API with the service role, which bypasses RLS - so there are no
-- insert/update policies at all.
--
-- Reversible: drop the three tables.

begin;

create table if not exists public.news_sources (
  id text primary key,
  name text not null,
  kind text not null check (kind in ('nhl', 'espn', 'rss', 'bluesky')),
  url text not null,
  team_abbrev text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.news_items (
  id uuid primary key default gen_random_uuid(),
  source_id text not null references public.news_sources(id),
  external_id text,
  url text not null unique,
  title text not null,
  snippet text,
  summary text,
  author text,
  image_url text,
  team_abbrev text,
  player_ids integer[] not null default '{}',
  published_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists news_items_published_idx on public.news_items (published_at desc);
create index if not exists news_items_players_idx on public.news_items using gin (player_ids);
create index if not exists news_items_team_idx on public.news_items (team_abbrev, published_at desc);

create table if not exists public.news_ingest_runs (
  id bigserial primary key,
  source_id text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  seen integer not null default 0,
  inserted integer not null default 0,
  matched integer not null default 0,
  errors integer not null default 0,
  error text
);
create index if not exists news_ingest_runs_started_idx on public.news_ingest_runs (started_at desc);

alter table public.news_sources enable row level security;
alter table public.news_items enable row level security;
alter table public.news_ingest_runs enable row level security;

drop policy if exists news_sources_read on public.news_sources;
create policy news_sources_read on public.news_sources for select to authenticated using (true);
drop policy if exists news_items_read on public.news_items;
create policy news_items_read on public.news_items for select to authenticated using (true);
drop policy if exists news_ingest_runs_read on public.news_ingest_runs;
create policy news_ingest_runs_read on public.news_ingest_runs for select to authenticated using (true);

-- The wires. Enabled rows are what the ingest reads; flip `enabled` to
-- drop one without a deploy. RSS URLs are the publishers' own feeds.
insert into public.news_sources (id, name, kind, url) values
  ('nhl',        'NHL.com',        'nhl',  'https://forge-dapi.d3.nhle.com/v2/content/en-us/stories?context.slug=nhl&$skip=0&$top=40'),
  ('espn',       'ESPN',           'espn', 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/news'),
  ('dailyfaceoff','Daily Faceoff', 'rss',  'https://www.dailyfaceoff.com/feed/'),
  ('dobber',     'DobberHockey',   'rss',  'https://dobberhockey.com/feed/'),
  ('tsn',        'TSN',            'rss',  'https://www.tsn.ca/rss/nhl'),
  ('sportsnet',  'Sportsnet',      'rss',  'https://www.sportsnet.ca/hockey/nhl/feed/'),
  ('thn',        'The Hockey News','rss',  'https://thehockeynews.com/rss')
on conflict (id) do nothing;

commit;
