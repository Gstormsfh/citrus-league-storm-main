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

-- Repair existing drift as part of the same migration transaction. No actual
-- game statistics or already-earned score ledger is rewritten by this statement.
INSERT INTO public.league_scoring_rules(league_id,stat_key,multiplier,updated_at)
SELECT l.id,c.stat_key,
  CASE WHEN l.scoring_settings IS NULL OR jsonb_typeof(l.scoring_settings)='null' THEN c.default_multiplier
       WHEN jsonb_typeof(l.scoring_settings->c.applies_to->c.stat_key)='number'
         THEN (l.scoring_settings->c.applies_to->>c.stat_key)::numeric
       ELSE 0 END,now()
FROM public.leagues l CROSS JOIN public.stat_catalog c
ON CONFLICT(league_id,stat_key) DO UPDATE SET multiplier=excluded.multiplier,updated_at=excluded.updated_at;
