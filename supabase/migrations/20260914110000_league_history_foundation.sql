-- =====================================================================
-- League history foundation: identity spine, seasons, standings, honours
-- 2026-09-13
--
-- WHY THIS FILE EXISTS WITH TODAY'S DATE
-- The objects below were applied to PRODUCTION through the Supabase MCP on
-- 2026-08-26 (see the original header, preserved verbatim underneath) but
-- the migration file never reached master. Staging has none of them. This
-- file carries that consolidated final state into the migration history so
-- a branch database, staging and production all converge on one definition.
-- Every statement is idempotent (create ... if not exists, create or replace,
-- drop policy if exists) so re-applying it to production is a no-op.
--
-- Backup: no destructive statements. Existing rows are never touched except
-- the additive seed at the bottom, which is `on conflict do nothing`.
-- Rollback: drop view public.league_member_honours;
--           drop function public.citrus_import_league_history(uuid, text, jsonb);
--           drop function public.citrus_preview_league_history(uuid, jsonb);
--           drop function public.citrus_norm_name(text);
--           drop table public.league_season_teams; drop table public.league_seasons;
--           drop table public.league_members;
--           (only on a database where they did not exist before this file)
-- =====================================================================

-- =====================================================================
-- Citrus Fantasy Sports — league history / trophy case
-- 2026-08-26
--
-- Applied to production via the Supabase MCP in six steps, in this order:
--   league_history_trophy_case_schema
--   league_history_import_and_trophy_case
--   seed_league_members_from_existing_teams
--   preview_league_history_without_temp_tables
--   import_league_history_champion_pick_without_max_uuid
--   import_picks_the_spelling_people_actually_use
--   import_survives_duplicate_pasted_rows
-- This file is the consolidated FINAL state, not a replay of those steps.
--
-- WHY THIS EXISTS
-- A Citrus league was a single-season object. Nothing on the league side
-- carried a season — not leagues, teams, matchups, draft_picks,
-- trade_history, roster_assignments or team_lineups. Only team_stats did.
-- All 53 leagues were created since January 2026 and none had rolled over.
-- So a commissioner bringing a ten-year Yahoo league across had nowhere to
-- put "who won in 2019", which is the thing they actually care about.
--
-- THE IDENTITY SPINE IS THE POINT
-- A trophy case is not a list of team names. Team names change every year,
-- and half the owners in an imported history never had a Citrus account.
-- "You have beaten Dave 14-9" needs a stable person key that survives
-- renames and predates signup. That is league_members: one row per human
-- per league, for all time, owner_id NULL until claimed.
--
-- SEASON CONVENTION: the START year. 2015 = 2015-16, matching
-- raw_shots.season and player_game_stats.season.
--
-- SOURCE DECISION: paste/upload, not an API. For a trophy case the payload
-- is a few dozen rows per league; building OAuth for that is
-- disproportionate, and Yahoo's app review is unbounded time. Paste works
-- for Yahoo, ESPN, Fantrax and CBS on day one, cannot break when a platform
-- changes its markup, and carries no ToS exposure. A Yahoo one-click can be
-- added later over this same schema.
-- =====================================================================

create table if not exists public.league_members (
  id           uuid primary key default gen_random_uuid(),
  league_id    uuid not null references public.leagues(id) on delete cascade,
  display_name text not null,
  owner_id     uuid references public.profiles(id) on delete set null,
  first_season smallint,
  last_season  smallint,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists league_members_one_per_owner
  on public.league_members (league_id, owner_id) where owner_id is not null;
create index if not exists league_members_by_league
  on public.league_members (league_id);
create index if not exists league_members_by_norm_name
  on public.league_members (league_id, lower(btrim(display_name)));

comment on table public.league_members is
  'One row per human per league, across every season. The stable key that lets a trophy case survive team renames and owners who never had a Citrus account.';

create table if not exists public.league_seasons (
  league_id           uuid     not null references public.leagues(id) on delete cascade,
  season              smallint not null,
  platform            text     not null default 'manual',
  external_league_id  text,
  team_count          smallint,
  champion_member_id  uuid references public.league_members(id) on delete set null,
  runner_up_member_id uuid references public.league_members(id) on delete set null,
  regular_winner_id   uuid references public.league_members(id) on delete set null,
  note                text,
  imported_at         timestamptz not null default now(),
  imported_by         uuid,
  primary key (league_id, season),
  constraint league_seasons_platform_known
    check (platform in ('yahoo','espn','fantrax','cbs','sleeper','manual','citrus')),
  constraint league_seasons_sane_year check (season between 1990 and 2100)
);

comment on table public.league_seasons is
  'One row per completed season per league. Written on import, or by Citrus when a season it ran finishes. A season with no row has not been played or imported.';

create table if not exists public.league_season_teams (
  league_id      uuid     not null,
  season         smallint not null,
  member_id      uuid     not null references public.league_members(id) on delete cascade,
  team_name      text,
  rank           smallint,
  wins           smallint,
  losses         smallint,
  ties           smallint,
  points_for     numeric,
  points_against numeric,
  made_playoffs  boolean,
  playoff_finish smallint,          -- 1 = won it, 2 = lost the final, NULL = unknown
  primary key (league_id, season, member_id),
  foreign key (league_id, season)
    references public.league_seasons(league_id, season) on delete cascade,
  constraint league_season_teams_sane_record
    check (coalesce(wins,0) >= 0 and coalesce(losses,0) >= 0 and coalesce(ties,0) >= 0)
);

create index if not exists league_season_teams_by_member
  on public.league_season_teams (member_id);

comment on table public.league_season_teams is
  'Final standings, one row per member per season. Season-level only: imported history rarely includes every matchup, so head-to-head is not derivable from this and is not claimed.';

-- ---------------------------------------------------------------------
-- RLS: same shape as matchups and draft_picks. Read for anyone in the
-- league, write for the commissioner. Getting this wrong exposes every
-- league at once.
-- ---------------------------------------------------------------------

alter table public.league_members      enable row level security;
alter table public.league_seasons      enable row level security;
alter table public.league_season_teams enable row level security;

drop policy if exists league_members_select on public.league_members;
create policy league_members_select on public.league_members for select
  using (public.is_commissioner_of_league(league_id)
         or public.user_owns_team_in_league_simple(league_id));
drop policy if exists league_members_write on public.league_members;
create policy league_members_write on public.league_members for all
  using (public.is_commissioner_of_league(league_id))
  with check (public.is_commissioner_of_league(league_id));

drop policy if exists league_seasons_select on public.league_seasons;
create policy league_seasons_select on public.league_seasons for select
  using (public.is_commissioner_of_league(league_id)
         or public.user_owns_team_in_league_simple(league_id));
drop policy if exists league_seasons_write on public.league_seasons;
create policy league_seasons_write on public.league_seasons for all
  using (public.is_commissioner_of_league(league_id))
  with check (public.is_commissioner_of_league(league_id));

drop policy if exists league_season_teams_select on public.league_season_teams;
create policy league_season_teams_select on public.league_season_teams for select
  using (public.is_commissioner_of_league(league_id)
         or public.user_owns_team_in_league_simple(league_id));
drop policy if exists league_season_teams_write on public.league_season_teams;
create policy league_season_teams_write on public.league_season_teams for all
  using (public.is_commissioner_of_league(league_id))
  with check (public.is_commissioner_of_league(league_id));

create or replace function public.citrus_norm_name(p text)
returns text language sql immutable parallel safe as $fn$
  select nullif(lower(btrim(regexp_replace(coalesce(p,''), '\s+', ' ', 'g'))), '')
$fn$;

-- ---------------------------------------------------------------------
-- Import is two calls, deliberately. A commissioner pasting ten years of
-- standings out of Yahoo will have a typo in it somewhere, and finding out
-- after it is written is the wrong time. The preview writes nothing and
-- reports exactly what would happen; both take the same payload, so the
-- preview is a real rehearsal.
--
-- Payload: one JSON array, one object per team per season.
--   [{"season":2015,"owner_name":"Dave","team_name":"Dangle Dynasty",
--     "rank":1,"wins":14,"losses":5,"ties":1,
--     "points_for":1234.5,"points_against":1100.2,"playoff_finish":1}, ...]
--
-- Only season and owner_name are required. What a commissioner can copy out
-- varies enormously by platform — some give points for and against, some
-- give nothing but a final rank.
-- ---------------------------------------------------------------------

create or replace function public.citrus_preview_league_history(
  p_league_id uuid,
  p_rows      jsonb
)
returns table(check_name text, status text, detail text)
language plpgsql stable
set search_path to 'public', 'pg_temp'
as $fn$
declare v_rows integer; v_bad_season integer; v_no_owner integer;
        v_seasons integer; v_people integer; v_new_people integer;
        v_existing integer; v_dupes integer; v_champ integer;
begin
  if not public.is_commissioner_of_league(p_league_id) then
    raise exception 'Only the commissioner of this league can import its history.';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array of season rows.';
  end if;

  with r as (
    select (e->>'season')::int                      as season,
           public.citrus_norm_name(e->>'owner_name') as norm,
           (e->>'playoff_finish')::int               as finish
    from jsonb_array_elements(p_rows) e
  )
  select count(*),
         count(*) filter (where season is null or season not between 1990 and 2100),
         count(*) filter (where norm is null),
         count(distinct season) filter (where season is not null),
         count(distinct norm)   filter (where norm is not null),
         count(*) filter (where finish = 1)
    into v_rows, v_bad_season, v_no_owner, v_seasons, v_people, v_champ
  from r;

  with r as (
    select (e->>'season')::int as season,
           public.citrus_norm_name(e->>'owner_name') as norm
    from jsonb_array_elements(p_rows) e
  )
  select count(*) into v_dupes
  from (select season, norm from r where norm is not null
        group by 1,2 having count(*) > 1) d;

  with r as (
    select distinct public.citrus_norm_name(e->>'owner_name') as norm
    from jsonb_array_elements(p_rows) e
  )
  select count(*) into v_existing
  from r join public.league_members m
    on m.league_id = p_league_id
   and public.citrus_norm_name(m.display_name) = r.norm
  where r.norm is not null;

  v_new_people := v_people - coalesce(v_existing, 0);

  return query values
    ('rows_parsed', case when v_rows > 0 then 'pass' else 'fail' end,
     v_rows::text || ' rows across ' || v_seasons::text || ' seasons'),
    ('season_valid', case when v_bad_season = 0 then 'pass' else 'fail' end,
     v_bad_season::text || ' rows with a missing or implausible season'),
    ('owner_named', case when v_no_owner = 0 then 'pass' else 'fail' end,
     v_no_owner::text || ' rows with no owner_name (required - it is the identity key)'),
    ('one_row_per_owner_per_season', case when v_dupes = 0 then 'pass' else 'fail' end,
     v_dupes::text || ' owner/season pairs appear more than once'),
    ('people', 'info',
     v_people::text || ' distinct owners: ' || coalesce(v_existing,0)::text
     || ' already known to this league, ' || v_new_people::text || ' would be created'),
    ('champions_derivable', 'info',
     v_champ::text || ' seasons name a winner via playoff_finish=1; the rest fall back to rank=1');
end;
$fn$;

drop function if exists public.citrus_import_league_history(uuid, text, jsonb);

create or replace function public.citrus_import_league_history(
  p_league_id uuid,
  p_platform  text,
  p_rows      jsonb
)
returns table(seasons_written integer, teams_written integer,
              members_created integer, rows_deduped integer)
language plpgsql
set search_path to 'public', 'pg_temp'
as $fn$
declare v_seasons integer := 0; v_teams integer := 0; v_members integer := 0;
        v_raw integer := 0; v_dedup integer := 0;
begin
  if not public.is_commissioner_of_league(p_league_id) then
    raise exception 'Only the commissioner of this league can import its history.';
  end if;
  if p_platform not in ('yahoo','espn','fantrax','cbs','sleeper','manual','citrus') then
    raise exception 'Unknown platform %. Use yahoo, espn, fantrax, cbs, sleeper or manual.', p_platform;
  end if;

  create temporary table _raw on commit drop as
  select (e->>'season')::smallint                     as season,
         public.citrus_norm_name(e->>'owner_name')     as norm,
         btrim(e->>'owner_name')                       as owner_name,
         nullif(btrim(e->>'team_name'), '')            as team_name,
         (e->>'rank')::smallint                        as rank,
         (e->>'wins')::smallint                        as wins,
         (e->>'losses')::smallint                      as losses,
         (e->>'ties')::smallint                        as ties,
         (e->>'points_for')::numeric                   as points_for,
         (e->>'points_against')::numeric               as points_against,
         (e->>'playoff_finish')::smallint              as finish
  from jsonb_array_elements(p_rows) e;

  if exists (select 1 from _raw where norm is null or season is null) then
    raise exception 'Every row needs a season and an owner_name. Run citrus_preview_league_history first.';
  end if;

  select count(*)::integer into v_raw from _raw;

  -- Collapse a duplicated paste on (season, owner), keeping the most COMPLETE
  -- row rather than an arbitrary one. Refusing the whole import over one
  -- stray line in ten years of standings would be the wrong trade.
  create temporary table _r on commit drop as
  select distinct on (season, norm) *
  from _raw
  order by season, norm,
           (finish is not null) desc,
           (points_for is not null) desc,
           (rank is not null) desc,
           (wins is not null) desc;

  select v_raw - count(*)::integer into v_dedup from _r;

  -- Names match case- and whitespace-insensitively, but the spelling we STORE
  -- is the one that appears most often — otherwise min() picks alphabetically
  -- and "dave" beats "Dave" in his own trophy case.
  with spellings as (select norm, owner_name, count(*) n from _raw group by norm, owner_name),
  best as (
    select distinct on (norm) norm, owner_name as nm from spellings
    order by norm, n desc, (owner_name ~ '[A-Z]') desc, length(owner_name) desc, owner_name
  ),
  ins as (
    insert into public.league_members (league_id, display_name)
    select p_league_id, b.nm from best b
    where not exists (select 1 from public.league_members m
                       where m.league_id = p_league_id
                         and public.citrus_norm_name(m.display_name) = b.norm)
    returning 1
  )
  select count(*)::integer into v_members from ins;

  create temporary table _m on commit drop as
  select m.id, public.citrus_norm_name(m.display_name) as norm
  from public.league_members m where m.league_id = p_league_id;

  with s as (select r.season, count(*)::smallint as team_count from _r r group by r.season),
  up as (
    insert into public.league_seasons (league_id, season, platform, team_count, imported_by)
    select p_league_id, s.season, p_platform, s.team_count, auth.uid() from s
    on conflict (league_id, season) do update
      set platform = excluded.platform, team_count = excluded.team_count,
          imported_at = now(), imported_by = excluded.imported_by
    returning 1
  )
  select count(*)::integer into v_seasons from up;

  with up as (
    insert into public.league_season_teams
          (league_id, season, member_id, team_name, rank, wins, losses, ties,
           points_for, points_against, made_playoffs, playoff_finish)
    select p_league_id, r.season, m.id, r.team_name, r.rank, r.wins, r.losses, r.ties,
           r.points_for, r.points_against,
           case when r.finish is not null then true else null end, r.finish
    from _r r join _m m on m.norm = r.norm
    on conflict (league_id, season, member_id) do update
      set team_name = excluded.team_name, rank = excluded.rank,
          wins = excluded.wins, losses = excluded.losses, ties = excluded.ties,
          points_for = excluded.points_for, points_against = excluded.points_against,
          made_playoffs = excluded.made_playoffs, playoff_finish = excluded.playoff_finish
    returning 1
  )
  select count(*)::integer into v_teams from up;

  -- Champion from the playoff result if the platform gave us one, else the
  -- regular-season leader. array_agg(...)[1] because there is no max(uuid).
  update public.league_seasons ls
     set champion_member_id  = c.champ,
         runner_up_member_id = c.runner,
         regular_winner_id   = c.regular
  from (
    select t.season,
           (array_agg(t.member_id) filter (where t.playoff_finish = 2))[1] as runner,
           (array_agg(t.member_id) filter (where t.rank = 1))[1]           as regular,
           coalesce((array_agg(t.member_id) filter (where t.playoff_finish = 1))[1],
                    (array_agg(t.member_id) filter (where t.rank = 1))[1]) as champ
    from public.league_season_teams t
    where t.league_id = p_league_id group by t.season
  ) c
  where ls.league_id = p_league_id and ls.season = c.season;

  update public.league_members m
     set first_season = x.lo, last_season = x.hi, updated_at = now()
  from (select member_id, min(season) lo, max(season) hi
        from public.league_season_teams where league_id = p_league_id
        group by member_id) x
  where m.id = x.member_id;

  return query select v_seasons, v_teams, v_members, v_dedup;
end;
$fn$;

-- ---------------------------------------------------------------------
-- What the trophy case renders. security_invoker so RLS on the base tables
-- still applies — a view without it hands every league's history to anyone
-- who can reach the view.
-- ---------------------------------------------------------------------

create or replace view public.league_season_results
with (security_invoker = true) as
select ls.league_id, ls.season, ls.platform, ls.team_count,
       cm.display_name as champion,
       rm.display_name as runner_up,
       gm.display_name as regular_season_winner
from public.league_seasons ls
left join public.league_members cm on cm.id = ls.champion_member_id
left join public.league_members rm on rm.id = ls.runner_up_member_id
left join public.league_members gm on gm.id = ls.regular_winner_id;

-- 20260914110100 replaces this view with the same columns plus
-- merged_into_member_id at the end. Keep these two files in this order:
-- CREATE OR REPLACE VIEW can add a trailing column, never drop one.
create or replace view public.league_member_honours
with (security_invoker = true) as
select m.league_id, m.id as member_id, m.display_name, m.owner_id,
       m.first_season, m.last_season,
       count(t.season)                              as seasons_played,
       count(*) filter (where t.playoff_finish = 1) as titles,
       count(*) filter (where t.playoff_finish = 2) as finals_lost,
       count(*) filter (where t.made_playoffs)      as playoff_seasons,
       min(t.rank)                                  as best_finish,
       sum(coalesce(t.wins,0))                      as career_wins,
       sum(coalesce(t.losses,0))                    as career_losses,
       sum(coalesce(t.ties,0))                      as career_ties
from public.league_members m
left join public.league_season_teams t
       on t.member_id = m.id and t.league_id = m.league_id
group by m.league_id, m.id, m.display_name, m.owner_id, m.first_season, m.last_season;

comment on view public.league_member_honours is
  'Career line per person per league. Head-to-head is deliberately absent: imported history is season-level, and claiming an all-time record we cannot derive would be worse than showing none.';

-- ---------------------------------------------------------------------
-- Seed the identity spine for leagues that already exist, so the season
-- they are about to play is continuous with anything imported later.
-- No league_seasons rows: a season row means a season PLAYED or IMPORTED,
-- and none of these has finished one. Writing a 2026 row now would put an
-- empty season in every trophy case.
-- ---------------------------------------------------------------------

-- profiles.display_name arrived after some migration baselines; read it
-- through to_jsonb so this seed also applies on a database that lacks the
-- column (a branch built from a partial replay) instead of failing outright.
insert into public.league_members (league_id, display_name, owner_id)
select t.league_id,
       coalesce(nullif(btrim(to_jsonb(p) ->> 'display_name'), ''),
                nullif(btrim(p.username), ''),
                nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
                nullif(btrim(t.team_name), ''),
                'Unknown owner') as display_name,
       t.owner_id
from public.teams t
left join public.profiles p on p.id = t.owner_id
where t.owner_id is not null
  and not exists (select 1 from public.league_members m
                   where m.league_id = t.league_id and m.owner_id = t.owner_id)
on conflict do nothing;
