-- Purpose: append-only canonical NHL event observations per source snapshot.
-- UNAPPLIED. Requires 20260906005705. Existing raw/NHL shot tables unchanged.
-- Risk: LOW additive evidence table. No destructive operation; backup not
-- required before creating an empty table. Staging proof required for rollout.
-- Rollback: REVOKE ALL ON public.analytics_event_observations FROM service_role;
-- Retain populated evidence; export it before any separately approved removal.
BEGIN;
CREATE TABLE public.analytics_event_observations (
  snapshot_id uuid NOT NULL REFERENCES public.analytics_source_snapshots(id),
  game_id integer NOT NULL,
  event_id integer NOT NULL CHECK(event_id>=0),
  season integer NOT NULL CHECK(season=game_id/1000000),
  game_type text NOT NULL CHECK(game_type IN ('regular','playoff')),
  period integer NOT NULL CHECK(period>0),
  period_type text NOT NULL CHECK(period_type IN ('REG','OT')),
  seconds_into_period integer NOT NULL CHECK(seconds_into_period BETWEEN 0 AND 1200),
  shooter_id bigint CHECK(shooter_id>0),
  goalie_id bigint CHECK(goalie_id>0),
  event_type text NOT NULL CHECK(event_type IN ('goal','shot-on-goal','missed-shot')),
  is_goal boolean NOT NULL CHECK(is_goal=(event_type='goal')),
  shot_type text,
  x_raw double precision,
  y_raw double precision,
  is_home boolean,
  is_empty_net boolean,
  source_event_sha256 text NOT NULL CHECK(source_event_sha256 ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY(snapshot_id,game_id,event_id),
  CHECK ((game_id/10000)%100=CASE game_type WHEN 'regular' THEN 2 ELSE 3 END),
  CHECK (period_type=CASE WHEN period<=3 THEN 'REG' ELSE 'OT' END),
  CHECK (game_type<>'regular' OR period<=3 OR seconds_into_period<=300),
  CHECK (x_raw IS NULL OR (x_raw>'-Infinity'::float8 AND x_raw<'Infinity'::float8)),
  CHECK (y_raw IS NULL OR (y_raw>'-Infinity'::float8 AND y_raw<'Infinity'::float8))
);
CREATE INDEX analytics_events_identity_idx ON public.analytics_event_observations(game_id,event_id,snapshot_id);
CREATE INDEX analytics_events_player_idx ON public.analytics_event_observations(shooter_id,season,game_type);
ALTER TABLE public.analytics_event_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_event_observations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.analytics_event_observations TO service_role;
CREATE TRIGGER immutable_evidence BEFORE UPDATE OR DELETE ON public.analytics_event_observations
FOR EACH ROW EXECUTE FUNCTION public.analytics_deny_revision();

-- Only sealed observation sets may feed downstream candidates. Quarantined
-- sets retain evidence but are not eligible. Seal and append acquire the same
-- source-row lock, so concurrent inserts cannot race completeness checks.
CREATE TABLE public.analytics_event_observation_sets (
  snapshot_id uuid PRIMARY KEY REFERENCES public.analytics_source_snapshots(id),
  game_id integer NOT NULL,
  status text NOT NULL CHECK(status IN ('complete','quarantined')),
  expected_events integer NOT NULL CHECK(expected_events>=0),
  quarantined_events integer NOT NULL CHECK(quarantined_events>=0),
  excluded_events integer NOT NULL CHECK(excluded_events>=0),
  contract text NOT NULL CHECK(contract='nhl-unblocked-observation-v1'),
  sealed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(status<>'complete' OR (expected_events>0 AND quarantined_events=0))
);
CREATE INDEX analytics_observation_sets_game_idx ON public.analytics_event_observation_sets(game_id);
ALTER TABLE public.analytics_event_observation_sets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_event_observation_sets FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.analytics_event_observation_sets TO service_role;
-- Row locking requires UPDATE privilege; the immutable trigger rejects writes.
GRANT UPDATE(id) ON public.analytics_source_snapshots TO service_role;
CREATE TRIGGER immutable_evidence BEFORE UPDATE OR DELETE ON public.analytics_event_observation_sets
FOR EACH ROW EXECUTE FUNCTION public.analytics_deny_revision();

CREATE FUNCTION public.analytics_guard_event_append() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Analytics writes require READ COMMITTED isolation';
  END IF;
  PERFORM id FROM public.analytics_source_snapshots WHERE id=NEW.snapshot_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.analytics_event_observation_sets WHERE snapshot_id=NEW.snapshot_id) THEN
    RAISE EXCEPTION 'Event observation set is sealed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_event_append BEFORE INSERT ON public.analytics_event_observations
FOR EACH ROW EXECUTE FUNCTION public.analytics_guard_event_append();

CREATE FUNCTION public.analytics_guard_event_seal() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE evidence jsonb; actual jsonb; expected jsonb;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Analytics writes require READ COMMITTED isolation';
  END IF;
  SELECT payload->'normalization' INTO evidence FROM public.analytics_source_snapshots
    WHERE id=NEW.snapshot_id AND source='NHL official play-by-play' FOR UPDATE;
  IF evidence IS NULL OR evidence->>'contract' IS DISTINCT FROM NEW.contract
    OR (evidence->>'game_id')::integer IS DISTINCT FROM NEW.game_id
    OR jsonb_array_length(evidence->'events') IS DISTINCT FROM NEW.expected_events
    OR jsonb_array_length(evidence->'quarantine') IS DISTINCT FROM NEW.quarantined_events
    OR (SELECT coalesce(sum(value::integer),0) FROM jsonb_each_text(evidence->'excluded')) IS DISTINCT FROM NEW.excluded_events::bigint
    OR evidence->>'complete' IS DISTINCT FROM (NEW.status='complete')::text
    OR (evidence->>'input_events')::integer IS DISTINCT FROM NEW.expected_events+NEW.quarantined_events+NEW.excluded_events THEN
    RAISE EXCEPTION 'Observation manifest does not match source evidence';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(e)-'snapshot_id' ORDER BY event_id),'[]') INTO actual
    FROM public.analytics_event_observations e WHERE snapshot_id=NEW.snapshot_id;
  SELECT coalesce(jsonb_agg(value ORDER BY (value->>'event_id')::integer),'[]') INTO expected
    FROM jsonb_array_elements(evidence->'events');
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'Incomplete or conflicting event observation set';
  END IF;
  NEW.sealed_at:=clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER guard_event_seal BEFORE INSERT ON public.analytics_event_observation_sets
FOR EACH ROW EXECUTE FUNCTION public.analytics_guard_event_seal();
REVOKE ALL ON FUNCTION public.analytics_guard_event_append(),public.analytics_guard_event_seal() FROM PUBLIC;
COMMIT;
