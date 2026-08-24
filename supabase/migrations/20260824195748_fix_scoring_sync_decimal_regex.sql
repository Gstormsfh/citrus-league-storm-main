-- ============================================================================
-- 2026-08-24 defensive re-assert (no-op in practice).
-- [ALREADY APPLIED TO PROD iezwazccqqrhrjupxzvf as version 20260824195748.]
--
-- During launch-build verification the numeric-validation regex in
-- sync_scoring_settings_to_rules was SUSPECTED of being double-escaped
-- (which would silently skip decimal multipliers like saves 0.2). A
-- behavioral test against the live function proved the pattern correct —
-- it matches '0.5' and '3' and rejects 'abc' — the suspicion came from
-- tooling display escaping, not the database. This migration re-asserts
-- the correct single-backslash form and runs a per-stat gap-fill that
-- found ZERO missing rows. Kept in history because it ran against prod;
-- functionally identical to 20260824171428's definition.
-- ============================================================================
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

-- Corrective PER-STAT gap-fill: leagues whose rules are missing stats that
-- their scoring_settings define with a numeric value. ON CONFLICT DO
-- NOTHING — never overwrite an editor-managed row. (Found 0 rows in prod.)
INSERT INTO public.league_scoring_rules (league_id, stat_key, multiplier, updated_at)
SELECT l.id, c.stat_key,
       (l.scoring_settings->c.applies_to->>c.stat_key)::numeric, now()
  FROM public.leagues l
  JOIN public.stat_catalog c
    ON l.scoring_settings->c.applies_to ? c.stat_key
   AND (l.scoring_settings->c.applies_to->>c.stat_key) ~ '^-?[0-9]+(\.[0-9]+)?$'
 WHERE l.scoring_settings IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.league_scoring_rules r
      WHERE r.league_id = l.id AND r.stat_key = c.stat_key
   )
ON CONFLICT (league_id, stat_key) DO NOTHING;
