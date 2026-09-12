-- 20260912001500 — the name filter cannot be walked around.
--
-- moderationError (packages/shared/src/utils/contentModeration.ts) runs in the
-- API on every write of a name other managers see: display_name, username,
-- first and last name, bio, default_team_name, a team name, a league name. It
-- is the Guideline 1.2 filter App Review asks for, and it works.
--
-- It is also skippable. RLS on these three tables lets the owner write the row
-- directly, and none of the policies carry a WITH CHECK:
--
--   profiles  "Users can update own profile"          USING auth.uid() = id
--   teams     "Users can update their own teams"      USING auth.uid() = owner_id
--   leagues   "Commissioners can update their leagues" USING auth.uid() = commissioner_id
--
-- The anon key ships inside the app bundle, so a signed-in manager can PATCH
-- /rest/v1/profiles?id=eq.<self> and set any display name at all. The API's
-- filter never sees it, and the slur lands on a leaderboard next to everyone
-- else's name.
--
-- This closes the dangerous half at the layer both paths share: a BEFORE
-- trigger that refuses the hate tier whoever is writing. Deliberately NOT the
-- profanity tier. That list is long, it is a product judgement rather than a
-- safety one, and a second copy of it in SQL would drift into a different
-- answer than the product gives. The hate roots are short, stable, and the
-- ones that cannot be allowed to land by any route.
--
-- The permanent fix is one writer rather than a filter on two: move these
-- writes to the service role and revoke column UPDATE from authenticated.
-- That touches every route that writes a name and it is not a change to ship
-- in draft season. This is.
--
-- The lists below mirror contentModeration.ts. Substring roots are matched
-- inside the squashed text so obfuscation does not help; the short roots that
-- collide with ordinary words (jap in Japan, coon in raccoon, tard in mustard,
-- rapist in therapist) are matched as whole tokens only.

create or replace function public.moderation_squash(p_text text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select regexp_replace(
           regexp_replace(
             translate(lower(coalesce(p_text, '')), '01345789@$!|', 'oieastbgasil'),
             '[^a-z0-9]', '', 'g'),
           '(.)\1{2,}', '\1\1', 'g')
$function$;

create or replace function public.moderation_tokens(p_text text)
returns text[]
language sql
immutable
set search_path to 'public'
as $function$
  select coalesce(
    array_remove(
      regexp_split_to_array(
        regexp_replace(
          translate(lower(coalesce(p_text, '')), '01345789@$!|', 'oieastbgasil'),
          '[^a-z0-9]+', ' ', 'g'),
        '\s+'),
      ''),
    '{}')
$function$;

create or replace function public.moderate_public_name()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  -- Matched anywhere inside the squashed text.
  v_substrings text[] := array[
    'nigger', 'nigga', 'niggah', 'kike', 'kyke', 'spick', 'wetback',
    'chink', 'zipperhead', 'raghead', 'towelhead', 'sandnigger',
    'faggot', 'fagot', 'tranny', 'shemale', 'retarded',
    'darkie', 'darky', 'jigaboo', 'porchmonkey', 'gyppo', 'gypo',
    'redskin', 'prairienigger', 'heilhitler', 'siegheil', 'whitepower'
  ];
  -- Matched as whole tokens only: each collides with an ordinary word.
  v_tokens_only text[] := array[
    'fag', 'fags', 'jap', 'japs', 'coon', 'coons', 'tard', 'retard', 'retards',
    'spic', 'spics', 'paki', 'pakis', 'kkk', '1488', 'negro', 'squaw', 'dyke',
    'gook', 'rapist', 'raper'
  ];
  v_col      text;
  v_value    text;
  v_squashed text;
  v_tokens   text[];
  v_term     text;
begin
  foreach v_col in array tg_argv loop
    v_value := to_jsonb(new) ->> v_col;
    if v_value is null or btrim(v_value) = '' then
      continue;
    end if;

    v_squashed := public.moderation_squash(v_value);
    foreach v_term in array v_substrings loop
      if position(v_term in v_squashed) > 0 then
        raise exception 'name_not_allowed: % rejected by the name filter', v_col
          using errcode = 'check_violation',
                hint = 'That name is not allowed. Pick another one.';
      end if;
    end loop;

    v_tokens := public.moderation_tokens(v_value);
    foreach v_term in array v_tokens_only loop
      if v_term = any (v_tokens) then
        raise exception 'name_not_allowed: % rejected by the name filter', v_col
          using errcode = 'check_violation',
                hint = 'That name is not allowed. Pick another one.';
      end if;
    end loop;
  end loop;

  return new;
end;
$function$;

drop trigger if exists moderate_profile_names on public.profiles;
create trigger moderate_profile_names
  before insert or update on public.profiles
  for each row
  execute function public.moderate_public_name(
    'display_name', 'username', 'first_name', 'last_name', 'bio', 'default_team_name');

drop trigger if exists moderate_team_name on public.teams;
create trigger moderate_team_name
  before insert or update on public.teams
  for each row
  execute function public.moderate_public_name('team_name');

drop trigger if exists moderate_league_name on public.leagues;
create trigger moderate_league_name
  before insert or update on public.leagues
  for each row
  execute function public.moderate_public_name('name');
