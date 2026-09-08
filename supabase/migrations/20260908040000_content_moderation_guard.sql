-- Content moderation guard (2026-09-08). App Store Guideline 1.2 defense-in-depth:
-- the API filters user-visible names at write time (packages/shared contentModeration);
-- this trigger rejects the unambiguous hate terms at the database as well, so a client
-- that writes to teams/leagues/profiles directly (RLS permitting) cannot bypass it.
-- Deliberately narrow: slur roots only, letters-only comparison after stripping
-- separators and mapping common leet digits. Ordinary profanity is handled by the
-- API layer, where the word-boundary logic lives. Reject, never mask.
--
-- NOT APPLIED by the author; apply to staging first, run the regression at the bottom,
-- then production. Rollback: drop the three triggers and the function.

create or replace function public.citrus_text_is_clean(p_text text)
returns boolean
language plpgsql
immutable
as $$
declare
  v text;
  term text;
begin
  if p_text is null or btrim(p_text) = '' then
    return true;
  end if;
  v := lower(p_text);
  v := translate(v, '0134578@$!|', 'oieastbasil');
  v := regexp_replace(v, '[^a-z0-9]', '', 'g');       -- squash separators
  v := regexp_replace(v, '(.)\1{2,}', '\1\1', 'g');   -- collapse repeats
  foreach term in array array[
    'nigger','nigga','niggah','kike','kyke','wetback','chink','zipperhead',
    'raghead','towelhead','sandnigger','faggot','fagot','tranny','shemale',
    'retarded','darkie','darky','jigaboo','porchmonkey','gyppo','redskin',
    'prairienigger','heilhitler','siegheil','whitepower','rapist'
  ] loop
    if position(term in v) > 0 then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

comment on function public.citrus_text_is_clean(text) is
  'Hate-term guard for user-visible names; API layer handles ordinary profanity. See packages/shared/src/utils/contentModeration.ts.';

create or replace function public.citrus_moderate_names()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'teams' then
    if not public.citrus_text_is_clean(new.team_name) then
      raise exception 'That name includes language we do not allow on Citrus. Please choose another.'
        using errcode = 'check_violation', hint = 'content_moderation';
    end if;
  elsif tg_table_name = 'leagues' then
    if not public.citrus_text_is_clean(new.name) then
      raise exception 'That name includes language we do not allow on Citrus. Please choose another.'
        using errcode = 'check_violation', hint = 'content_moderation';
    end if;
  elsif tg_table_name = 'profiles' then
    if not (public.citrus_text_is_clean(new.username) and public.citrus_text_is_clean(new.display_name)
            and public.citrus_text_is_clean(new.default_team_name) and public.citrus_text_is_clean(new.bio)) then
      raise exception 'That text includes language we do not allow on Citrus. Please choose another.'
        using errcode = 'check_violation', hint = 'content_moderation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_moderate_team_name on public.teams;
create trigger trg_moderate_team_name
  before insert or update of team_name on public.teams
  for each row execute function public.citrus_moderate_names();

drop trigger if exists trg_moderate_league_name on public.leagues;
create trigger trg_moderate_league_name
  before insert or update of name on public.leagues
  for each row execute function public.citrus_moderate_names();

drop trigger if exists trg_moderate_profile_text on public.profiles;
create trigger trg_moderate_profile_text
  before insert or update of username, display_name, default_team_name, bio on public.profiles
  for each row execute function public.citrus_moderate_names();

-- Regression (run manually after applying; all must hold):
--   select public.citrus_text_is_clean('Edmonton Oil Kings')      = true;
--   select public.citrus_text_is_clean('Scunthorpe United')       = true;
--   select public.citrus_text_is_clean('Raccoon City')            = true;
--   select public.citrus_text_is_clean('n1gg3r nation')           = false;
--   select public.citrus_text_is_clean('N.I.G.G.E.R')             = false;
--   select public.citrus_text_is_clean('white power')             = false;
--   begin; update public.teams set team_name = 'F4ggots' where false; rollback;  -- no rows, no error
