-- =====================================================================
-- League import from screenshots, and the keeper/dynasty carry-over
-- 2026-09-14
--
-- Builds on 20260914110100_league_import_platform.sql. A league that lives
-- on a platform with no API we can use (Yahoo until its developer review
-- clears, Fantrax, CBS, a spreadsheet) comes over as screenshots of its
-- standings, playoffs, draft results, transactions, keepers and traded
-- picks. The server reads them, the commissioner confirms what was read,
-- and the same writer, record book and claim flow as the API imports take
-- it from there. This file adds what that path needs and the platform
-- imports lacked:
--
--   * import_jobs.method            how the data came in (api, screenshot, paste)
--   * pick assets on transactions   "traded 2027 round 2 pick" is a trade fact
--   * league_season_keepers         the keeper list as the source showed it
--   * league_pick_ownership         who owns which future pick, the dynasty
--                                   state that decides next draft's order
--   * citrus_apply_imported_keepers keeper designations for the coming Citrus
--                                   season, prefilled from the source, as
--                                   'designated' rows the panel then locks
--   * 'manual' as a platform on identities and the player crosswalk, for a
--     screenshot whose platform the commissioner cannot name
--
-- Backup: additive. Two nullable-column ALTERs, one CHECK widening, one
-- new table, one function. Nightly PITR covers it.
-- Rollback: drop function public.citrus_apply_imported_keepers(uuid, integer, jsonb);
--           drop table public.league_pick_ownership; drop table public.league_season_keepers;
--           alter table public.league_season_transactions drop column pick_season,
--             drop column pick_round, drop column pick_original_member_id;
--           alter table public.import_jobs drop column method;
--           (re-narrow the two platform CHECKs from the platform file if wanted)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. How the data came in
-- ---------------------------------------------------------------------

alter table public.import_jobs
  add column if not exists method text not null default 'api';

do $$ begin
  alter table public.import_jobs
    add constraint import_jobs_method_known check (method in ('api','screenshot','paste'));
exception when duplicate_object then null; end $$;

comment on column public.import_jobs.method is
  'api: fetched from the platform. screenshot: read from images the commissioner uploaded and confirmed. paste: the foundation''s pasted standings.';

-- ---------------------------------------------------------------------
-- 2. A draft pick as a trade asset
-- ---------------------------------------------------------------------

alter table public.league_season_transactions
  add column if not exists pick_season           smallint,
  add column if not exists pick_round            smallint,
  add column if not exists pick_original_member_id uuid references public.league_members(id) on delete set null;

comment on column public.league_season_transactions.pick_season is
  'When the asset moved was a draft pick: the START year of the season whose draft it belongs to. A row is one asset: a player row has these null, a pick row has nhl_player_id null.';

-- ---------------------------------------------------------------------
-- 3. Who owns which future pick
--
-- The state a dynasty league is actually attached to. One row per pick that
-- has changed hands: the round, whose slot it originally was, who owns it
-- now. Applying it to the Citrus draft is a commissioner action
-- (draft_order.team_order gets the owner's team in the original team's slot)
-- and is only possible once both members are claimed, so the row keeps
-- member ids and the apply step maps them to teams at the time.
-- ---------------------------------------------------------------------

create table if not exists public.league_pick_ownership (
  league_id           uuid not null references public.leagues(id) on delete cascade,
  draft_season        smallint not null,
  round               smallint not null,
  original_member_id  uuid not null references public.league_members(id) on delete cascade,
  owner_member_id     uuid not null references public.league_members(id) on delete cascade,
  source              text not null,
  note                text,
  applied_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (league_id, draft_season, round, original_member_id),
  constraint league_pick_ownership_sane_year check (draft_season between 1990 and 2100),
  constraint league_pick_ownership_sane_round check (round between 1 and 60),
  constraint league_pick_ownership_source_known check (source in ('yahoo','espn','fantrax','cbs','sleeper','manual','citrus'))
);

create index if not exists league_pick_ownership_by_owner on public.league_pick_ownership (league_id, owner_member_id);

comment on table public.league_pick_ownership is
  'Future draft picks that have changed hands. draft_season is the START year of the season whose draft the pick belongs to. applied_at is set when the commissioner applied the row to draft_order for that draft.';

alter table public.league_pick_ownership enable row level security;

drop policy if exists league_pick_ownership_select on public.league_pick_ownership;
create policy league_pick_ownership_select on public.league_pick_ownership for select
  using (public.is_commissioner_of_league(league_id)
         or public.user_owns_team_in_league_simple(league_id));

drop policy if exists league_pick_ownership_write on public.league_pick_ownership;
create policy league_pick_ownership_write on public.league_pick_ownership for all
  using (public.is_commissioner_of_league(league_id))
  with check (public.is_commissioner_of_league(league_id));

drop trigger if exists league_pick_ownership_touch on public.league_pick_ownership;
create trigger league_pick_ownership_touch before update on public.league_pick_ownership
  for each row execute function public.citrus_touch_updated_at();

-- ---------------------------------------------------------------------
-- 3b. The keeper list the source showed, as the source showed it
--
-- A keeper league's live state is "who is keeping whom into the next
-- draft, at what cost". API parsers already carried it in ImportedSeason
-- (Yahoo's keeper list) and the writer used it only to resolve players;
-- nothing kept the list. It is kept here, keyed on the season it was
-- captured in, so the carry-over step below can turn it into Citrus
-- keeper_designations once the managers have claimed their teams.
-- ---------------------------------------------------------------------

create table if not exists public.league_season_keepers (
  league_id             uuid not null,
  season                smallint not null,
  member_id             uuid not null references public.league_members(id) on delete cascade,
  external_player_id    text not null,
  external_player_name  text,
  nhl_player_id         integer,
  round                 smallint,
  round_next            smallint,
  years_kept            smallint,
  source                text not null,
  created_at            timestamptz not null default now(),
  primary key (league_id, season, member_id, external_player_id),
  foreign key (league_id, season) references public.league_seasons(league_id, season) on delete cascade,
  constraint league_season_keepers_source_known check (source in ('yahoo','espn','fantrax','cbs','sleeper','manual','citrus'))
);

comment on table public.league_season_keepers is
  'Keeper designations as the source listed them in a season, kept for the next draft. round is what the keeper costs; nhl_player_id null means the crosswalk could not place the player and the commissioner resolves it before the carry-over.';

alter table public.league_season_keepers enable row level security;

drop policy if exists league_season_keepers_select on public.league_season_keepers;
create policy league_season_keepers_select on public.league_season_keepers for select
  using (public.is_commissioner_of_league(league_id)
         or public.user_owns_team_in_league_simple(league_id));

drop policy if exists league_season_keepers_write on public.league_season_keepers;
create policy league_season_keepers_write on public.league_season_keepers for all
  using (public.is_commissioner_of_league(league_id))
  with check (public.is_commissioner_of_league(league_id));

-- ---------------------------------------------------------------------
-- 4. Keeper designations prefilled from the source
--
-- keeper_designations lets a team owner insert only their own team's rows
-- under RLS; the commissioner may update but not insert for others. The
-- prefill is the commissioner writing every team's keepers at once, so it
-- runs here with the commissioner check inside. Rows land as 'designated':
-- the existing keeper panel and lock_keepers_for_season take it from there,
-- and a row already approved or locked is never touched.
--
-- p_rows: [{"team_id": uuid, "player_id": "8478402", "original_draft_round": 3, "years_kept": 1}, ...]
-- ---------------------------------------------------------------------

create or replace function public.citrus_apply_imported_keepers(
  p_league_id   uuid,
  p_season_year integer,
  p_rows        jsonb
)
returns table(written integer, skipped_locked integer)
language plpgsql
security definer
set search_path = public
as $fn$
declare v_written integer := 0; v_skipped integer := 0; r record;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  if not public.is_commissioner_of_league(p_league_id) then
    raise exception 'Only the commissioner of this league can apply imported keepers.';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array.';
  end if;

  for r in
    select (e->>'team_id')::uuid              as team_id,
           btrim(e->>'player_id')             as player_id,
           (e->>'original_draft_round')::int  as original_draft_round,
           coalesce((e->>'years_kept')::int, 1) as years_kept
    from jsonb_array_elements(p_rows) e
  loop
    if r.team_id is null or r.player_id is null or r.player_id = '' then
      continue;
    end if;
    if not exists (select 1 from public.teams t where t.id = r.team_id and t.league_id = p_league_id) then
      raise exception 'Team % is not in this league.', r.team_id;
    end if;
    if exists (select 1 from public.keeper_designations k
                where k.league_id = p_league_id and k.player_id = r.player_id and k.season_year = p_season_year
                  and k.status in ('approved','locked')) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    insert into public.keeper_designations (league_id, team_id, player_id, season_year, original_draft_round, years_kept, status)
    values (p_league_id, r.team_id, r.player_id, p_season_year, r.original_draft_round, r.years_kept, 'designated')
    on conflict (league_id, player_id, season_year) do update
      set team_id = excluded.team_id,
          original_draft_round = excluded.original_draft_round,
          years_kept = excluded.years_kept;
    v_written := v_written + 1;
  end loop;

  return query select v_written, v_skipped;
end;
$fn$;

revoke all on function public.citrus_apply_imported_keepers(uuid, integer, jsonb) from public;
grant execute on function public.citrus_apply_imported_keepers(uuid, integer, jsonb) to authenticated;

comment on function public.citrus_apply_imported_keepers(uuid, integer, jsonb) is
  'Commissioner prefill of keeper_designations for one season from an import. Writes designated rows, leaves approved and locked rows alone.';

-- ---------------------------------------------------------------------
-- 5. 'manual' as a platform where a screenshot names none
-- ---------------------------------------------------------------------

alter table public.league_member_identities drop constraint if exists league_member_identities_platform_known;
alter table public.league_member_identities
  add constraint league_member_identities_platform_known
  check (platform in ('yahoo','espn','fantrax','cbs','sleeper','manual'));

alter table public.external_player_ids drop constraint if exists external_player_ids_platform_known;
alter table public.external_player_ids
  add constraint external_player_ids_platform_known
  check (platform in ('yahoo','espn','fantrax','cbs','sleeper','manual'));

comment on column public.league_member_identities.external_manager_id is
  'Yahoo guid or ESPN SWID for API imports. For screenshot imports there is no account id, so it is name:<normalised manager name>, which is the same key the foundation''s pasted-standings path uses; a later API import of the same league is merged by the commissioner.';
