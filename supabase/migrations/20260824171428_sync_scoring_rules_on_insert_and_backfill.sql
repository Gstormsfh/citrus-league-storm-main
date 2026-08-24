-- 2026-08-24: league CREATION never synced scoring_settings into
-- league_scoring_rules — the sync trigger fired only on UPDATE, and the
-- scorer (get_effective_scoring_rules) reads ONLY the rules table with
-- catalog-default fallback. Net effect: a league created with custom
-- scoring silently scored at catalog defaults until some later settings
-- save fired the sync. Fix: (1) make the function INSERT-safe (OLD is
-- unassigned on INSERT), (2) fire the trigger on INSERT too, (3) backfill
-- rules for leagues that have scoring_settings but zero rules rows.
-- [ALREADY APPLIED TO PROD iezwazccqqrhrjupxzvf as version 20260824171428 —
--  this file is the repo mirror for environment parity.]

CREATE OR REPLACE FUNCTION public.sync_scoring_settings_to_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.scoring_settings is null then
    return new;
  end if;

  -- On UPDATE, skip when unchanged. On INSERT there is no OLD — always sync.
  if TG_OP = 'UPDATE'
     and new.scoring_settings is not distinct from old.scoring_settings then
    return new;
  end if;

  insert into public.league_scoring_rules (league_id, stat_key, multiplier, updated_at)
  select new.id, c.stat_key,
         (new.scoring_settings->c.applies_to->>c.stat_key)::numeric, now()
    from public.stat_catalog c
   where new.scoring_settings->c.applies_to ? c.stat_key
     and (new.scoring_settings->c.applies_to->>c.stat_key) ~ '^-?[0-9]+(\.[0-9]+)?$'
  on conflict (league_id, stat_key)
    do update set multiplier = excluded.multiplier, updated_at = now();

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS sync_scoring_settings_to_rules_trg ON public.leagues;
CREATE TRIGGER sync_scoring_settings_to_rules_trg
  AFTER INSERT OR UPDATE OF scoring_settings ON public.leagues
  FOR EACH ROW EXECUTE FUNCTION public.sync_scoring_settings_to_rules();

-- Backfill: only leagues that have settings but NO rules rows at all —
-- never touch a league whose rules the editor already manages.
INSERT INTO public.league_scoring_rules (league_id, stat_key, multiplier, updated_at)
SELECT l.id, c.stat_key,
       (l.scoring_settings->c.applies_to->>c.stat_key)::numeric, now()
  FROM public.leagues l
  JOIN public.stat_catalog c
    ON l.scoring_settings->c.applies_to ? c.stat_key
   AND (l.scoring_settings->c.applies_to->>c.stat_key) ~ '^-?[0-9]+(\.[0-9]+)?$'
 WHERE l.scoring_settings IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.league_scoring_rules r WHERE r.league_id = l.id)
ON CONFLICT (league_id, stat_key) DO NOTHING;
