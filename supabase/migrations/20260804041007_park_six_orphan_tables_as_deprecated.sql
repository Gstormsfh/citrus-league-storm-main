-- 0D-ORG-1: Park six orphan tables by RENAMING them, not dropping them.
--
-- APPLIED: prod 20260804041007 / staging (same name). Authoritative record of what is live.
--
-- NOTHING IS DELETED. Every row is retained; only the table name changes. Any of these can
-- be restored instantly with a single ALTER TABLE ... RENAME back. The rename doubles as a
-- soak test: if anything anywhere still depends on one of these, it now fails LOUDLY with
-- "relation does not exist" instead of silently reading stale data, and we rename back.
-- After a soak period with no breakage these can be dropped for real in a later migration.
--
-- THE SIX, and why each is an orphan (all verified: zero inbound FKs, zero references in
-- any function body, zero references in any view definition):
--
--   "public.players"        A table whose NAME literally contains a dot -- created by a
--                           mistaken CREATE TABLE public.public.players. It is empty and
--                           has never been written. Pure artifact.
--   "2025_Skaters"          Capitalised, numeric-prefixed orphan from an early import. Empty,
--                           never written, requires double-quoting to reference at all.
--   staging_2024_skaters    4,600 rows
--   staging_2025_skaters    3,945 rows   Legacy CSV staging tables. Zero writes ever recorded
--   staging_2024_goalies      515 rows   in pg_stat_user_tables; the only repo reference is
--   staging_2025_goalies      390 rows   scripts/verify-staging-tables.ts, an operator script.
--
-- SEASONALITY NOTE -- deliberately EXCLUDED from this migration despite low read counts:
--   waiver_claims, trade_votes, keeper_designations, auction_bids, auction_budgets,
--   auction_nominations, faab_budgets, survivor_selections, confidence_picks,
--   player_autopick_rankings. These are live gameplay features that are quiet because it is
--   the NHL offseason, not because they are dead. Read counts collected in August say
--   nothing about their October behaviour. Do not treat low traffic as evidence of disuse
--   for any table on the gameplay path.
--
-- ALSO NOT TOUCHED HERE: raw_player_stats. It reads as dead from the application side
--   (9 reads, 0 writes recorded, nothing references it in SQL) but the Python pipeline
--   writes it directly at data-pipeline/acquisition/data_acquisition.py:4302,4324 via
--   service_role. It is write-only dead weight, but parking it would break the pipeline.
--   Handle it by fixing the producer first.
--
-- GATED: each table must stop resolving under its old name AND retain its exact row count
-- under the new one.
--
-- VERIFIED ON PROD AFTER APPLY: live public tables 85 -> 79; parked row counts intact at
--   staging_2024_skaters 4600, staging_2025_skaters 3945, staging_2024_goalies 515,
--   staging_2025_goalies 390; every parked table carries a restore note in its COMMENT.

DO $mig$
DECLARE
  v_tabs text[] := ARRAY['public.players','2025_Skaters','staging_2024_skaters',
                         'staging_2025_skaters','staging_2024_goalies','staging_2025_goalies'];
  t text; v_before bigint; v_after bigint; v_done int := 0;
BEGIN
  FOREACH t IN ARRAY v_tabs LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE 'skip: % absent', t;
      CONTINUE;
    END IF;

    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO v_before;
    EXECUTE format('ALTER TABLE public.%I RENAME TO %I', t, '_deprecated_'||t);

    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      RAISE EXCEPTION 'GATE1 FAIL: % still resolves under its old name', t;
    END IF;

    EXECUTE format('SELECT count(*) FROM public.%I', '_deprecated_'||t) INTO v_after;
    IF v_after <> v_before THEN
      RAISE EXCEPTION 'GATE2 FAIL: table % went from % rows to % rows after rename',
        t, v_before, v_after;
    END IF;

    EXECUTE format(
      'COMMENT ON TABLE public.%I IS %L',
      '_deprecated_'||t,
      'PARKED 2026-08-04 by 0D-ORG-1. Orphan: zero inbound FKs, zero function refs, zero '
      'view refs, zero recorded writes. Data intact. Restore by renaming back to "'||t||'". '
      'Drop for real only after a clean soak period.');

    v_done := v_done + 1;
  END LOOP;

  RAISE NOTICE '0D-ORG-1 OK: parked % orphan tables (renamed, no data removed)', v_done;
END
$mig$;
