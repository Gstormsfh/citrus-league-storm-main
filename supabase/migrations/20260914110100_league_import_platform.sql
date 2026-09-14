-- =====================================================================
-- League import platform: Yahoo / ESPN import jobs, raw payloads, external
-- identities, matchup and draft history, player crosswalk, trophies, claims
-- 2026-09-13
--
-- Builds on 20260914110000_league_history_foundation.sql (league_members,
-- league_seasons, league_season_teams). That layer was designed for a
-- commissioner PASTING standings. This layer is what an automated import
-- writes: every season's weekly results, drafts and keepers, keyed on the
-- source platform's stable manager and player ids rather than on names, plus
-- the trophy rows the app renders and the claim mechanism that attaches a
-- person to their own history the day they sign up.
--
-- PRINCIPLES (mirrored in server/src/services/import/*):
--   * Import is a copy, never a link. Re-running is idempotent and additive.
--   * Every raw API response is stored before it is parsed, so a source
--     changing a field name is fixed by re-parsing, never by re-fetching.
--   * Provenance on every trophy: imported | computed | manual.
--   * Managers are keyed on Yahoo guid / ESPN SWID, never on team id or name.
--   * Category leagues never get points-league records; scoring_type gates it.
--   * Nothing here is hard-deleted by the application. Soft-delete columns only.
--
-- Backup: purely additive. No existing row is modified or removed; the ALTERs
-- only add nullable columns. No backup step is needed beyond the nightly PITR.
-- Rollback: drop function public.citrus_claim_league_member(uuid, text);
--           drop function public.citrus_merge_league_members(uuid, uuid, text);
--           drop table public.league_trophies; drop table public.league_season_transactions;
--           drop table public.league_season_drafts; drop table public.league_season_matchups;
--           drop table public.external_player_ids; drop table public.league_member_identities;
--           drop table public.import_raw_payloads; drop table public.import_jobs;
--           drop table public.external_league_links; drop table public.oauth_connections;
--           re-run the league_member_honours definition from the foundation file
--             (this file adds merged_into_member_id to it), then
--           alter table public.league_members drop column claim_token, drop column claimed_at,
--             drop column claim_method, drop column merged_into_member_id;
--           alter table public.league_seasons drop column scoring_type, drop column external_season_key,
--             drop column champion_source, drop column is_verified_by_bracket, drop column is_finished,
--             drop column import_job_id;
--           alter table public.league_season_teams drop column external_team_id, drop column playoff_seed,
--             drop column category_record, drop column final_rank_source;
--           alter table public.keeper_designations drop column external_player_id,
--             drop column nhl_player_id, drop column source;
--           alter table public.leagues drop column founded_season, drop column imported_from,
--             drop column history_locked;
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Column additions to the foundation tables
-- ---------------------------------------------------------------------

alter table public.league_members
  add column if not exists claim_token           text,
  add column if not exists claimed_at            timestamptz,
  add column if not exists claim_method          text,
  add column if not exists merged_into_member_id uuid references public.league_members(id) on delete set null;

create unique index if not exists league_members_claim_token
  on public.league_members (claim_token) where claim_token is not null;

do $$ begin
  alter table public.league_members
    add constraint league_members_claim_method_known
    check (claim_method is null or claim_method in ('oauth_match','email_link','list_pick','commissioner_assign','seeded'));
exception when duplicate_object then null; end $$;

comment on column public.league_members.claim_token is
  'Random token carried by an invite link so a person can claim their imported history in one tap. Null once claimed.';
comment on column public.league_members.merged_into_member_id is
  'Set when a commissioner merges two members that are the same person (a co-manager, or someone who changed accounts). The merged row is kept for provenance; reads follow the pointer.';

-- The honours view is the app's manager list and its "which one is you?"
-- list. A merged row keeps its league_members row for provenance but has no
-- seasons left (the merge re-points them), so without this column every
-- claim would leave a ghost "Unclaimed · no seasons" manager on the shelf.
-- Same columns as the foundation's definition plus merged_into_member_id at
-- the end, which is the one shape CREATE OR REPLACE VIEW accepts.
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
       sum(coalesce(t.ties,0))                      as career_ties,
       m.merged_into_member_id
from public.league_members m
left join public.league_season_teams t
       on t.member_id = m.id and t.league_id = m.league_id
group by m.league_id, m.id, m.display_name, m.owner_id, m.first_season, m.last_season,
         m.merged_into_member_id;

alter table public.league_seasons
  add column if not exists scoring_type           text,
  add column if not exists external_season_key    text,
  add column if not exists champion_source        text,
  add column if not exists is_verified_by_bracket boolean,
  add column if not exists is_finished            boolean,
  add column if not exists import_job_id          uuid;

do $$ begin
  alter table public.league_seasons
    add constraint league_seasons_scoring_type_known
    check (scoring_type is null or scoring_type in ('points','h2h_points','h2h_categories','h2h_one_win','roto','unknown'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.league_seasons
    add constraint league_seasons_champion_source_known
    check (champion_source is null or champion_source in ('imported','computed','manual'));
exception when duplicate_object then null; end $$;

comment on column public.league_seasons.is_verified_by_bracket is
  'True when the champion from the source''s final standings and the winner of the playoff final matchup agree. Null when the source gave no bracket.';
comment on column public.league_seasons.is_finished is
  'False while the source says the season is still being played: no champion, no toilet bowl, no drought year from it until a re-import sees it finished. Null on rows written before this column existed (treated as finished).';

alter table public.league_season_teams
  add column if not exists external_team_id  text,
  add column if not exists playoff_seed      smallint,
  add column if not exists category_record   text,
  add column if not exists final_rank_source text;

comment on column public.league_season_teams.category_record is
  'For category leagues the source record counts categories, not matchups (e.g. 132-69-9 = 21 weeks x 10 categories). Stored verbatim so it is never mistaken for a matchup record.';

-- keeper_designations predates this layer on production and staging but a
-- branch database built from a partial replay may not have it. Extend it
-- where it exists; the import writes keeper facts to league_season_drafts
-- regardless, so nothing downstream depends on these columns being present.
do $$ begin
  if to_regclass('public.keeper_designations') is not null then
    alter table public.keeper_designations
      add column if not exists external_player_id text,
      add column if not exists nhl_player_id      integer,
      add column if not exists source             text;
  end if;
end $$;

alter table public.leagues
  add column if not exists founded_season smallint,
  add column if not exists imported_from  text,
  add column if not exists history_locked boolean not null default false;

comment on column public.leagues.history_locked is
  'Set by the commissioner once imported history has been verified. A locked league refuses re-import overwrites of league_seasons and league_season_teams.';

-- ---------------------------------------------------------------------
-- 2. OAuth connections (Yahoo): metadata only. The refresh token itself
--    lives in a server-only table beside it (yahoo_provider_tokens, same
--    posture as apple_provider_tokens), sealed with a key only the API
--    server holds. Access tokens are never persisted anywhere.
-- ---------------------------------------------------------------------

create table if not exists public.oauth_connections (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references public.profiles(id) on delete cascade,
  platform                 text not null,
  external_user_id         text not null,
  access_token_expires_at  timestamptz,
  scopes                   text,
  granted_at               timestamptz not null default now(),
  revoked_at               timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint oauth_connections_platform_known check (platform in ('yahoo')),
  constraint oauth_connections_one_per_user_platform unique (user_id, platform)
);

comment on table public.oauth_connections is
  'One row per user per platform: who is connected and whether the connection is live. No token material here; the sealed refresh token is in a service-role-only table. revoked_at set means the connection is dead and the user must reconnect.';

alter table public.oauth_connections enable row level security;

-- Users may see their own connection status. Only the API server (service
-- role, after proving the caller's JWT) writes rows, so a client cannot forge
-- a connection it never authorised.
drop policy if exists oauth_connections_write_own on public.oauth_connections;
drop policy if exists oauth_connections_select_own on public.oauth_connections;
create policy oauth_connections_select_own on public.oauth_connections for select
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 3. External league links: which source seasons a Citrus league came from
-- ---------------------------------------------------------------------

create table if not exists public.external_league_links (
  league_id            uuid not null references public.leagues(id) on delete cascade,
  platform             text not null,
  external_league_id   text not null,
  external_season_key  text not null,
  season               smallint not null,
  scoring_type         text,
  is_public_source     boolean,
  settings             jsonb,
  imported_at          timestamptz not null default now(),
  imported_by          uuid references public.profiles(id) on delete set null,
  primary key (league_id, platform, external_league_id, external_season_key),
  constraint external_league_links_platform_known
    check (platform in ('yahoo','espn','fantrax','cbs','sleeper','manual')),
  constraint external_league_links_sane_year check (season between 1990 and 2100)
);

create index if not exists external_league_links_by_source
  on public.external_league_links (platform, external_league_id);
-- A database that took the earlier shape of this file before settings existed.
alter table public.external_league_links add column if not exists settings jsonb;

comment on column public.external_league_links.settings is
  'The season''s settings as the source stated them (ImportedSettings JSON: scoring type and items, roster slots, playoff and keeper settings). The commissioner''s "confirm your scoring and keeper rules" screen translates the newest season''s copy.';

comment on table public.external_league_links is
  'Yahoo: external_league_id is the numeric league id and external_season_key the numeric game_id for that season (each season is a different game). ESPN: external_league_id is the leagueId, external_season_key the seasonId.';

alter table public.external_league_links enable row level security;

drop policy if exists external_league_links_select on public.external_league_links;
create policy external_league_links_select on public.external_league_links for select
  using (public.is_commissioner_of_league(league_id)
         or public.user_owns_team_in_league_simple(league_id));

drop policy if exists external_league_links_write on public.external_league_links;
create policy external_league_links_write on public.external_league_links for all
  using (public.is_commissioner_of_league(league_id))
  with check (public.is_commissioner_of_league(league_id));

-- ---------------------------------------------------------------------
-- 4. Import jobs and raw payloads
-- ---------------------------------------------------------------------

create table if not exists public.import_jobs (
  id                  uuid primary key default gen_random_uuid(),
  league_id           uuid not null references public.leagues(id) on delete cascade,
  platform            text not null,
  external_league_id  text not null,
  requested_by        uuid not null references public.profiles(id) on delete cascade,
  status              text not null default 'queued',
  seasons_discovered  smallint[] not null default '{}',
  seasons_imported    smallint[] not null default '{}',
  seasons_needing_credentials smallint[] not null default '{}',
  progress            jsonb not null default '{}'::jsonb,
  error               jsonb,
  started_at          timestamptz,
  finished_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint import_jobs_platform_known check (platform in ('yahoo','espn','fantrax','cbs','sleeper','manual')),
  constraint import_jobs_status_known
    check (status in ('queued','discovering','importing','matching','computing','done','partial','failed','needs_credentials'))
);

create index if not exists import_jobs_by_league on public.import_jobs (league_id, created_at desc);
create index if not exists import_jobs_by_requester on public.import_jobs (requested_by, created_at desc);

comment on table public.import_jobs is
  'One row per import attempt. needs_credentials and partial are first-class outcomes, not failures: an ESPN league whose pre-2019 seasons sit behind a login lands the seasons it could reach and parks the rest with a clear message.';

alter table public.import_jobs enable row level security;

drop policy if exists import_jobs_select on public.import_jobs;
create policy import_jobs_select on public.import_jobs for select
  using (requested_by = auth.uid() or public.is_commissioner_of_league(league_id));

drop policy if exists import_jobs_write on public.import_jobs;
create policy import_jobs_write on public.import_jobs for all
  using (public.is_commissioner_of_league(league_id))
  with check (public.is_commissioner_of_league(league_id) and requested_by = auth.uid());

create table if not exists public.import_raw_payloads (
  id                   uuid primary key default gen_random_uuid(),
  job_id               uuid not null references public.import_jobs(id) on delete cascade,
  league_id            uuid not null references public.leagues(id) on delete cascade,
  platform             text not null,
  endpoint             text not null,
  external_season_key  text,
  payload              jsonb not null,
  payload_sha256       text not null,
  fetched_at           timestamptz not null default now()
);

create index if not exists import_raw_payloads_by_job on public.import_raw_payloads (job_id);
create index if not exists import_raw_payloads_by_league_season
  on public.import_raw_payloads (league_id, platform, external_season_key);

comment on table public.import_raw_payloads is
  'The exact response from the source, stored before parsing. When ESPN renames a field the fix is a re-parse of these rows, never a re-fetch that asks the user to authenticate again. Never pruned.';

alter table public.import_raw_payloads enable row level security;

drop policy if exists import_raw_payloads_select on public.import_raw_payloads;
create policy import_raw_payloads_select on public.import_raw_payloads for select
  using (public.is_commissioner_of_league(league_id));

drop policy if exists import_raw_payloads_write on public.import_raw_payloads;
create policy import_raw_payloads_write on public.import_raw_payloads for all
  using (public.is_commissioner_of_league(league_id))
  with check (public.is_commissioner_of_league(league_id));

-- ---------------------------------------------------------------------
-- 5. Manager identities: the claim key
-- ---------------------------------------------------------------------

create table if not exists public.league_member_identities (
  member_id            uuid not null references public.league_members(id) on delete cascade,
  league_id            uuid not null references public.leagues(id) on delete cascade,
  platform             text not null,
  external_manager_id  text not null,
  display_name         text,
  email_hint           text,
  first_seen_season    smallint,
  last_seen_season     smallint,
  is_co_manager        boolean not null default false,
  created_at           timestamptz not null default now(),
  primary key (league_id, platform, external_manager_id),
  constraint league_member_identities_platform_known
    check (platform in ('yahoo','espn','fantrax','cbs','sleeper'))
);

create index if not exists league_member_identities_by_member on public.league_member_identities (member_id);

comment on table public.league_member_identities is
  'Yahoo guid or ESPN SWID (with braces) for each member, per league. This is what makes one league_members row per human across every season. email_hint is stored only when the source returned it to an authenticated commissioner, and is used only to pre-select a claim.';

alter table public.league_member_identities enable row level security;

drop policy if exists league_member_identities_select on public.league_member_identities;
create policy league_member_identities_select on public.league_member_identities for select
  using (public.is_commissioner_of_league(league_id));

drop policy if exists league_member_identities_write on public.league_member_identities;
create policy league_member_identities_write on public.league_member_identities for all
  using (public.is_commissioner_of_league(league_id))
  with check (public.is_commissioner_of_league(league_id));

-- ---------------------------------------------------------------------
-- 6. Player crosswalk: league-independent, converges toward complete
-- ---------------------------------------------------------------------

create table if not exists public.external_player_ids (
  platform             text not null,
  external_player_id   text not null,
  nhl_player_id        integer,
  match_method         text not null default 'unmatched',
  confidence           numeric(4,3) not null default 0,
  is_ambiguous         boolean not null default false,
  external_name        text,
  external_team_abbr   text,
  external_number      text,
  external_position    text,
  first_seen_season    smallint,
  last_seen_season     smallint,
  resolved_by          uuid references public.profiles(id) on delete set null,
  resolved_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (platform, external_player_id),
  constraint external_player_ids_platform_known check (platform in ('yahoo','espn','fantrax','cbs','sleeper')),
  constraint external_player_ids_method_known
    check (match_method in ('exact_name_team_number','name_team','name_only','manual','unmatched')),
  constraint external_player_ids_confidence_range check (confidence between 0 and 1)
);

create index if not exists external_player_ids_by_nhl on public.external_player_ids (nhl_player_id);
create index if not exists external_player_ids_unresolved
  on public.external_player_ids (platform) where nhl_player_id is null or is_ambiguous;

comment on table public.external_player_ids is
  'Yahoo player_id / ESPN athlete id to NHL player id. Once Yahoo 6743 = NHL 8478402 is resolved for one league it is resolved for every league. An ambiguous match is flagged, never auto-resolved: the draft kit found four first-name merges in one roster file, and the same corruption exists in source data.';

alter table public.external_player_ids enable row level security;

drop policy if exists external_player_ids_select on public.external_player_ids;
create policy external_player_ids_select on public.external_player_ids for select
  using (auth.uid() is not null);
-- Writes come from the API server on the service role after it has verified
-- the caller. No authenticated write policy on purpose: this table is shared
-- across every league, so a single user must not be able to re-map a player
-- for everyone.

-- ---------------------------------------------------------------------
-- 7. Season history: matchups, drafts, transactions
-- ---------------------------------------------------------------------

create table if not exists public.league_season_matchups (
  league_id             uuid not null,
  season                smallint not null,
  week                  smallint not null,
  home_member_id        uuid not null references public.league_members(id) on delete cascade,
  away_member_id        uuid references public.league_members(id) on delete cascade,
  home_score            numeric,
  away_score            numeric,
  home_cat_wins         smallint,
  home_cat_losses       smallint,
  home_cat_ties         smallint,
  category_results      jsonb,
  is_playoff            boolean not null default false,
  is_consolation        boolean not null default false,
  is_championship       boolean not null default false,
  winner_member_id      uuid references public.league_members(id) on delete set null,
  is_tie                boolean not null default false,
  source                text not null,
  external_matchup_id   text,
  created_at            timestamptz not null default now(),
  primary key (league_id, season, week, home_member_id),
  foreign key (league_id, season) references public.league_seasons(league_id, season) on delete cascade,
  constraint league_season_matchups_source_known check (source in ('yahoo','espn','fantrax','cbs','sleeper','manual','citrus'))
);

create index if not exists league_season_matchups_by_away on public.league_season_matchups (league_id, away_member_id);
create index if not exists league_season_matchups_by_season on public.league_season_matchups (league_id, season, week);

comment on table public.league_season_matchups is
  'One row per matchup per week. Points leagues fill home_score/away_score; category leagues fill the cat_* columns and category_results and leave scores null. A bye is a row with away_member_id null. Everything in the record book derives from here.';

alter table public.league_season_matchups enable row level security;

drop policy if exists league_season_matchups_select on public.league_season_matchups;
create policy league_season_matchups_select on public.league_season_matchups for select
  using (public.is_commissioner_of_league(league_id)
         or public.user_owns_team_in_league_simple(league_id));

drop policy if exists league_season_matchups_write on public.league_season_matchups;
create policy league_season_matchups_write on public.league_season_matchups for all
  using (public.is_commissioner_of_league(league_id))
  with check (public.is_commissioner_of_league(league_id));

create table if not exists public.league_season_drafts (
  league_id             uuid not null,
  season                smallint not null,
  overall_pick          smallint not null,
  round                 smallint,
  pick_in_round         smallint,
  member_id             uuid references public.league_members(id) on delete set null,
  nhl_player_id         integer,
  external_player_id    text,
  external_player_name  text,
  is_keeper             boolean not null default false,
  keeper_cost           text,
  auction_cost          numeric,
  source                text not null,
  created_at            timestamptz not null default now(),
  primary key (league_id, season, overall_pick),
  foreign key (league_id, season) references public.league_seasons(league_id, season) on delete cascade,
  constraint league_season_drafts_source_known check (source in ('yahoo','espn','fantrax','cbs','sleeper','manual','citrus'))
);

create index if not exists league_season_drafts_by_member on public.league_season_drafts (league_id, member_id);
create index if not exists league_season_drafts_keepers
  on public.league_season_drafts (league_id, season) where is_keeper;

comment on table public.league_season_drafts is
  'Draft results per season. A keeper is a pick with is_keeper true at the round it consumed. nhl_player_id null means the crosswalk could not resolve the player; the external name is kept so the row still renders.';

alter table public.league_season_drafts enable row level security;

drop policy if exists league_season_drafts_select on public.league_season_drafts;
create policy league_season_drafts_select on public.league_season_drafts for select
  using (public.is_commissioner_of_league(league_id)
         or public.user_owns_team_in_league_simple(league_id));

drop policy if exists league_season_drafts_write on public.league_season_drafts;
create policy league_season_drafts_write on public.league_season_drafts for all
  using (public.is_commissioner_of_league(league_id))
  with check (public.is_commissioner_of_league(league_id));

create table if not exists public.league_season_transactions (
  id                     uuid primary key default gen_random_uuid(),
  league_id              uuid not null,
  season                 smallint not null,
  occurred_at            timestamptz,
  type                   text not null,
  member_id              uuid references public.league_members(id) on delete set null,
  counterparty_member_id uuid references public.league_members(id) on delete set null,
  nhl_player_id          integer,
  external_player_id     text,
  external_player_name   text,
  faab_bid               numeric,
  external_transaction_id text,
  source                 text not null,
  created_at             timestamptz not null default now(),
  foreign key (league_id, season) references public.league_seasons(league_id, season) on delete cascade,
  constraint league_season_transactions_type_known
    check (type in ('add','drop','trade','waiver','commish','keeper','unknown')),
  constraint league_season_transactions_source_known check (source in ('yahoo','espn','fantrax','cbs','sleeper','manual','citrus'))
);

create unique index if not exists league_season_transactions_dedupe
  on public.league_season_transactions (league_id, season, source, external_transaction_id, coalesce(external_player_id,''), type)
  where external_transaction_id is not null;
create index if not exists league_season_transactions_by_member on public.league_season_transactions (league_id, member_id);

alter table public.league_season_transactions enable row level security;

drop policy if exists league_season_transactions_select on public.league_season_transactions;
create policy league_season_transactions_select on public.league_season_transactions for select
  using (public.is_commissioner_of_league(league_id)
         or public.user_owns_team_in_league_simple(league_id));

drop policy if exists league_season_transactions_write on public.league_season_transactions;
create policy league_season_transactions_write on public.league_season_transactions for all
  using (public.is_commissioner_of_league(league_id))
  with check (public.is_commissioner_of_league(league_id));

-- ---------------------------------------------------------------------
-- 8. Trophies: what the person actually sees
-- ---------------------------------------------------------------------

create table if not exists public.league_trophies (
  id                    uuid primary key default gen_random_uuid(),
  league_id             uuid not null references public.leagues(id) on delete cascade,
  season                smallint,
  member_id             uuid references public.league_members(id) on delete cascade,
  trophy_key            text not null,
  rank                  smallint,
  value                 numeric,
  detail                jsonb not null default '{}'::jsonb,
  source                text not null,
  computed_from_job_id  uuid references public.import_jobs(id) on delete set null,
  computed_at           timestamptz not null default now(),
  display_name          text,
  icon_key              text,
  is_hidden             boolean not null default false,
  retired_at            timestamptz,
  created_at            timestamptz not null default now(),
  constraint league_trophies_source_known check (source in ('imported','computed','manual')),
  constraint league_trophies_key_known check (trophy_key in (
    'champion','runner_up','third','regular_season_title','playoff_appearance','toilet_bowl',
    'most_championships','championship_drought','founding_member','tenure','all_time_win_pct',
    'highest_week','lowest_week','biggest_blowout','closest_game','longest_win_streak','longest_losing_streak',
    'lifetime_h2h','toughest_opponent','favourite_victim','comeback_seed',
    'category_sweep','narrowest_category_win','category_dominance','perfect_week',
    'custom'))
);

create index if not exists league_trophies_active
  on public.league_trophies (league_id, member_id) where retired_at is null;
create index if not exists league_trophies_by_season
  on public.league_trophies (league_id, season) where retired_at is null;

comment on table public.league_trophies is
  'Immutable once written except display_name, icon_key and is_hidden. A recompute writes new rows under a new computed_from_job_id and sets retired_at on the old ones. source says whether the source platform stated it, Citrus derived it, or the commissioner typed it; the UI shows which.';

alter table public.league_trophies enable row level security;

drop policy if exists league_trophies_select on public.league_trophies;
create policy league_trophies_select on public.league_trophies for select
  using (public.is_commissioner_of_league(league_id)
         or public.user_owns_team_in_league_simple(league_id));

drop policy if exists league_trophies_write on public.league_trophies;
create policy league_trophies_write on public.league_trophies for all
  using (public.is_commissioner_of_league(league_id))
  with check (public.is_commissioner_of_league(league_id));

-- ---------------------------------------------------------------------
-- 8b. Merging two members that are the same person
--
-- Used by the claim function (seeded row + imported row) and by the
-- commissioner tools (co-managers, someone who changed Yahoo accounts, a
-- paste import that spelled a name two ways). Every history row that points
-- at p_from is re-pointed at p_into; p_from is kept with merged_into set so
-- nothing is ever deleted. A season both rows played is a genuine conflict
-- and is refused rather than guessed at.
-- ---------------------------------------------------------------------

create or replace function public.citrus_merge_league_members(
  p_from        uuid,
  p_into        uuid,
  p_claim_method text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_from  public.league_members%rowtype;
  v_into  public.league_members%rowtype;
  v_clash integer;
begin
  if p_from = p_into then
    raise exception 'Cannot merge a member into itself.';
  end if;
  select * into v_from from public.league_members where id = p_from for update;
  select * into v_into from public.league_members where id = p_into for update;
  if v_from.id is null or v_into.id is null then
    raise exception 'Both members must exist.';
  end if;
  if v_from.league_id <> v_into.league_id then
    raise exception 'Members belong to different leagues.';
  end if;
  if v_into.merged_into_member_id is not null then
    raise exception 'The target member was itself merged. Merge into its survivor instead.';
  end if;

  -- Authorisation: the commissioner, or the person merging an unclaimed row
  -- into their own claimed row (the claim path). Nobody else.
  if not public.is_commissioner_of_league(v_from.league_id) then
    if v_uid is null or v_into.owner_id is distinct from v_uid or v_from.owner_id is not null then
      raise exception 'Only the commissioner can merge members.';
    end if;
  end if;

  select count(*) into v_clash
  from public.league_season_teams a
  join public.league_season_teams b
    on b.league_id = a.league_id and b.season = a.season
  where a.member_id = p_from and b.member_id = p_into;
  if v_clash > 0 then
    raise exception 'Both members have standings in % shared season(s). Resolve those seasons first.', v_clash;
  end if;

  update public.league_season_teams   set member_id = p_into where member_id = p_from;
  update public.league_seasons        set champion_member_id  = p_into where champion_member_id  = p_from;
  update public.league_seasons        set runner_up_member_id = p_into where runner_up_member_id = p_from;
  update public.league_seasons        set regular_winner_id   = p_into where regular_winner_id   = p_from;
  update public.league_season_matchups set home_member_id   = p_into where home_member_id   = p_from;
  update public.league_season_matchups set away_member_id   = p_into where away_member_id   = p_from;
  update public.league_season_matchups set winner_member_id = p_into where winner_member_id = p_from;
  update public.league_season_drafts  set member_id = p_into where member_id = p_from;
  update public.league_season_transactions set member_id = p_into where member_id = p_from;
  update public.league_season_transactions set counterparty_member_id = p_into where counterparty_member_id = p_from;
  update public.league_trophies       set member_id = p_into where member_id = p_from;
  update public.league_member_identities set member_id = p_into where member_id = p_from;

  update public.league_members
     set first_season = least(coalesce(v_into.first_season, v_from.first_season), coalesce(v_from.first_season, v_into.first_season)),
         last_season  = greatest(coalesce(v_into.last_season, v_from.last_season), coalesce(v_from.last_season, v_into.last_season)),
         claimed_at   = coalesce(v_into.claimed_at, case when p_claim_method is not null then now() end),
         claim_method = coalesce(v_into.claim_method, p_claim_method),
         updated_at   = now()
   where id = p_into;

  update public.league_members
     set merged_into_member_id = p_into, claim_token = null, updated_at = now()
   where id = p_from;

  return p_into;
end;
$fn$;

revoke all on function public.citrus_merge_league_members(uuid, uuid, text) from public;
grant execute on function public.citrus_merge_league_members(uuid, uuid, text) to authenticated;

comment on function public.citrus_merge_league_members(uuid, uuid, text) is
  'Re-points every history row from p_from to p_into and marks p_from merged. Commissioner, or the claim path merging an unclaimed row into the caller''s own row. Refuses when both rows have standings in the same season.';

-- ---------------------------------------------------------------------
-- 9. Claiming: attach a person to their own history in one tap
--
-- SECURITY DEFINER because a joining member cannot pass the commissioner
-- write policy on league_members, and RLS cannot express "may set owner_id
-- only on an unclaimed row". Every check the route would make is inside the
-- function, so a direct PostgREST call is exactly as safe as the route.
-- ---------------------------------------------------------------------

create or replace function public.citrus_claim_league_member(
  p_member_id   uuid,
  p_claim_token text default null
)
returns table(member_id uuid, league_id uuid, display_name text, claim_method text)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid      uuid := auth.uid();
  v_row      public.league_members%rowtype;
  v_method   text;
  v_existing uuid;
begin
  if v_uid is null then
    raise exception 'Sign in to claim your history.';
  end if;

  select * into v_row from public.league_members m where m.id = p_member_id for update;
  if not found then
    raise exception 'That member does not exist.';
  end if;
  if v_row.owner_id is not null then
    if v_row.owner_id = v_uid then
      return query select v_row.id, v_row.league_id, v_row.display_name, v_row.claim_method;
      return;
    end if;
    raise exception 'That history has already been claimed. Ask your commissioner if it is yours.';
  end if;
  if v_row.merged_into_member_id is not null then
    raise exception 'That member was merged into another. Claim the other one.';
  end if;

  -- A token from an invite link proves the link was sent to this person.
  -- Without one, the caller must already own a team in the league.
  if p_claim_token is not null then
    if v_row.claim_token is null or v_row.claim_token <> p_claim_token then
      raise exception 'That claim link is not valid.';
    end if;
    v_method := 'email_link';
  else
    if not public.user_owns_team_in_league_simple(v_row.league_id) then
      raise exception 'Join the league before claiming your history.';
    end if;
    v_method := 'list_pick';
  end if;

  -- One person, one member per league. The foundation seed already gave every
  -- current team owner an owner-linked row, and an import creates a second,
  -- identity-keyed row for the same human. Claiming the imported row therefore
  -- MERGES it into the caller's existing row rather than refusing: the history
  -- moves to the row the live league already uses, and the imported row stays
  -- behind as provenance with merged_into_member_id set.
  select m.id into v_existing from public.league_members m
   where m.league_id = v_row.league_id and m.owner_id = v_uid and m.id <> v_row.id
     and m.merged_into_member_id is null
   limit 1;

  if v_existing is not null then
    perform public.citrus_merge_league_members(v_row.id, v_existing, v_method);
    return query select v_existing, v_row.league_id, v_row.display_name, v_method;
    return;
  end if;

  update public.league_members
     set owner_id = v_uid, claimed_at = now(), claim_method = v_method,
         claim_token = null, updated_at = now()
   where id = v_row.id;

  return query select v_row.id, v_row.league_id, v_row.display_name, v_method;
end;
$fn$;

revoke all on function public.citrus_claim_league_member(uuid, text) from public;
grant execute on function public.citrus_claim_league_member(uuid, text) to authenticated;

comment on function public.citrus_claim_league_member(uuid, text) is
  'Attaches auth.uid() to an unclaimed league_members row. With a token: the invite-link path. Without: list-pick, which requires the caller to already own a team in the league. Commissioner assignment goes through the ordinary write policy instead.';

-- ---------------------------------------------------------------------
-- 9b. Audit event types for the import flow
--
-- security_audit_log.event_type is a CHECK-constrained list, so AuditService
-- writes with a new type are rejected until the list grows. The list below is
-- the original set plus the four this feature emits.
-- ---------------------------------------------------------------------

do $$ begin
  if to_regclass('public.security_audit_log') is not null then
    alter table public.security_audit_log drop constraint if exists security_audit_log_event_type_check;
    alter table public.security_audit_log add constraint security_audit_log_event_type_check check (event_type in (
      'AUTH_LOGIN', 'AUTH_LOGOUT', 'AUTH_FAILED',
      'LEAGUE_CREATE', 'LEAGUE_DELETE', 'LEAGUE_JOIN', 'LEAGUE_LEAVE',
      'DRAFT_START', 'DRAFT_COMPLETE', 'DRAFT_RESET',
      'ROSTER_MOVE', 'ROSTER_MOVE_FAILED',
      'TRADE_OFFER', 'TRADE_ACCEPT', 'TRADE_REJECT',
      'WAIVER_CLAIM', 'WAIVER_PROCESS',
      'ADMIN_ACTION', 'SECURITY_VIOLATION',
      'RLS_BYPASS_ATTEMPT', 'DATA_EXPORT',
      'LEAGUE_HISTORY_IMPORT', 'LEAGUE_HISTORY_CLAIM', 'LEAGUE_HISTORY_MERGE', 'LEAGUE_HISTORY_LOCK'
    ));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 10. updated_at maintenance for the new tables
-- ---------------------------------------------------------------------

create or replace function public.citrus_touch_updated_at()
returns trigger language plpgsql as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

do $$
declare t text;
begin
  foreach t in array array['oauth_connections','import_jobs','external_player_ids']
  loop
    execute format('drop trigger if exists %I_touch_updated_at on public.%I', t, t);
    execute format('create trigger %I_touch_updated_at before update on public.%I for each row execute function public.citrus_touch_updated_at()', t, t);
  end loop;
end $$;
