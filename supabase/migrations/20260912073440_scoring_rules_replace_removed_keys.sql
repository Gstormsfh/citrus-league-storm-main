-- Settings JSON is authoritative. Missing configured categories are disabled,
-- while an explicit null document restores catalog defaults. This migration is
-- prepared locally; executing it would reconcile existing derived rule rows.
CREATE OR REPLACE FUNCTION public.sync_scoring_settings_to_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  INSERT INTO public.league_scoring_rules(league_id,stat_key,multiplier,updated_at)
  SELECT NEW.id,c.stat_key,
    CASE WHEN NEW.scoring_settings IS NULL OR jsonb_typeof(NEW.scoring_settings)='null' THEN c.default_multiplier
         WHEN jsonb_typeof(NEW.scoring_settings->c.applies_to->c.stat_key)='number'
           THEN (NEW.scoring_settings->c.applies_to->>c.stat_key)::numeric
         ELSE 0 END,now()
  FROM public.stat_catalog c
  ON CONFLICT(league_id,stat_key) DO UPDATE SET multiplier=excluded.multiplier,updated_at=excluded.updated_at;
  RETURN NEW;
END $$;

-- Reconcile through the forward trigger, preserving the authoritative JSON.
-- A direct rules UPSERT would fire sync_rules_to_scoring_settings at depth 1
-- and rewrite that JSON (including NULL defaults) via the reverse materializer.
-- Here the reverse trigger sees depth > 1 and correctly does nothing.
-- Existing updated_at bookkeeping runs; no actual score ledger is rewritten.
UPDATE public.leagues SET scoring_settings=scoring_settings;
