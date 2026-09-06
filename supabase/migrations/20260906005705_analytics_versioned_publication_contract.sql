-- Purpose: isolated append-only analytics evidence and atomic publication.
-- UNAPPLIED to hosted databases. No existing metric rows/readers are changed.
-- Risk: LOW additive schema, service-role only. Staging and schema/ledger review
-- required before rollout. No destructive operation; no backup needed to create
-- empty tables. Before rollback after use, export all four tables (evidence).
-- Rollback: revoke service-role access to these tables first; retain evidence.
-- Do not drop populated evidence tables. No automatic serving switch is included.
BEGIN;

CREATE TABLE public.analytics_source_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (length(source)>0),
  observed_at timestamptz NOT NULL,
  source_published_at timestamptz,
  payload jsonb NOT NULL,
  payload_sha256 text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (observed_at <= recorded_at),
  UNIQUE(source, observed_at, payload_sha256)
);

CREATE TABLE public.analytics_metric_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_snapshot_id uuid NOT NULL REFERENCES public.analytics_source_snapshots(id),
  metric text NOT NULL CHECK (length(metric)>0),
  variant text NOT NULL CHECK (length(variant)>0),
  unit text NOT NULL CHECK (length(unit)>0),
  season integer NOT NULL CHECK (season BETWEEN 1900 AND 2200),
  game_type text NOT NULL CHECK (game_type IN ('regular','playoff')),
  population text NOT NULL CHECK (length(population)>0),
  feature_version text NOT NULL CHECK (length(feature_version)>0),
  model_version text NOT NULL CHECK (length(model_version)>0),
  code_revision text NOT NULL CHECK (code_revision ~ '^[0-9a-f]{40}$'),
  data_cutoff timestamptz NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  expected_entities integer NOT NULL CHECK (expected_entities>0),
  validation jsonb NOT NULL CHECK (jsonb_typeof(validation)='object'),
  CHECK (data_cutoff <= computed_at)
);
CREATE INDEX analytics_batches_source_idx ON public.analytics_metric_batches(source_snapshot_id);

CREATE TABLE public.analytics_metric_values (
  batch_id uuid NOT NULL REFERENCES public.analytics_metric_batches(id),
  entity_id bigint NOT NULL,
  value double precision,
  availability text NOT NULL CHECK (availability IN ('available','unavailable')),
  reason text NOT NULL CHECK (length(reason)>0),
  exposure double precision,
  PRIMARY KEY(batch_id,entity_id),
  CHECK ((availability='available' AND value IS NOT NULL AND reason='verified') OR
         (availability='unavailable' AND value IS NULL AND reason<>'verified')),
  CHECK (value IS NULL OR (value > '-Infinity'::float8 AND value < 'Infinity'::float8)),
  CHECK (exposure IS NULL OR (exposure>=0 AND exposure<'Infinity'::float8))
);

-- Publication is a separate immutable event. Re-publishing an older validated
-- batch is an explicit rollback without destroying or rewriting newer evidence.
CREATE TABLE public.analytics_publications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES public.analytics_metric_batches(id),
  published_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL CHECK (length(reason)>0)
);
CREATE INDEX analytics_publications_batch_idx ON public.analytics_publications(batch_id);

CREATE FUNCTION public.analytics_deny_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  RAISE EXCEPTION 'Analytics evidence is immutable; create a new snapshot/batch';
END $$;

CREATE FUNCTION public.analytics_hash_snapshot() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  NEW.payload_sha256 := encode(sha256(convert_to(NEW.payload::text,'UTF8')),'hex');
  RETURN NEW;
END $$;
CREATE TRIGGER analytics_snapshot_hash BEFORE INSERT ON public.analytics_source_snapshots
FOR EACH ROW EXECUTE FUNCTION public.analytics_hash_snapshot();

CREATE FUNCTION public.analytics_guard_value_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  -- Same row lock as publication: no insert can race the completeness check.
  PERFORM 1 FROM public.analytics_metric_batches WHERE id=NEW.batch_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.analytics_publications WHERE batch_id=NEW.batch_id) THEN
    RAISE EXCEPTION 'Published batch is sealed';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.analytics_guard_publication() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE b public.analytics_metric_batches; actual bigint; observed timestamptz;
BEGIN
  SELECT * INTO STRICT b FROM public.analytics_metric_batches WHERE id=NEW.batch_id FOR UPDATE;
  SELECT count(*) INTO actual FROM public.analytics_metric_values WHERE batch_id=b.id;
  IF actual <> b.expected_entities THEN
    RAISE EXCEPTION 'Incomplete analytics batch: expected %, found %', b.expected_entities,actual;
  END IF;
  IF b.validation->>'status' IS DISTINCT FROM 'passed' THEN
    RAISE EXCEPTION 'Analytics foundation validation has not passed';
  END IF;
  SELECT observed_at INTO observed FROM public.analytics_source_snapshots WHERE id=b.source_snapshot_id;
  IF observed>b.data_cutoff THEN
    RAISE EXCEPTION 'Source was observed after the claimed cutoff';
  END IF;
  NEW.published_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE TRIGGER analytics_value_insert BEFORE INSERT ON public.analytics_metric_values
FOR EACH ROW EXECUTE FUNCTION public.analytics_guard_value_insert();
CREATE TRIGGER analytics_publication_insert BEFORE INSERT ON public.analytics_publications
FOR EACH ROW EXECUTE FUNCTION public.analytics_guard_publication();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['analytics_source_snapshots','analytics_metric_batches',
                           'analytics_metric_values','analytics_publications'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role',t);
    EXECUTE format('GRANT SELECT, INSERT ON public.%I TO service_role',t);
    EXECUTE format('CREATE TRIGGER immutable_evidence BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.analytics_deny_revision()',t);
  END LOOP;
END $$;
GRANT USAGE ON SEQUENCE public.analytics_publications_id_seq TO service_role;
-- SELECT FOR UPDATE requires UPDATE privilege; immutable trigger still denies
-- every actual UPDATE, including id, for all ordinary database roles.
GRANT UPDATE(id) ON public.analytics_metric_batches TO service_role;
REVOKE ALL ON FUNCTION public.analytics_hash_snapshot() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.analytics_deny_revision() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.analytics_guard_value_insert() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.analytics_guard_publication() FROM PUBLIC,anon,authenticated;
COMMIT;
