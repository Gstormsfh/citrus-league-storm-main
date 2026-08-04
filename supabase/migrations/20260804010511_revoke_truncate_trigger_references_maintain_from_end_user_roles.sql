-- 0D-SEC-3c: Strip TRUNCATE / TRIGGER / REFERENCES / MAINTAIN from anon and authenticated
-- on every table in public.
--
-- APPLIED: prod 20260804010511 / staging (same name). Authoritative record of what is live.
--
-- WHY THIS MATTERS EVEN THOUGH RLS IS NOW ON EVERYWHERE:
--   A census found 78 of 85 public tables granted anon TRUNCATE, TRIGGER, REFERENCES and
--   (on PG17) MAINTAIN. Row-level security does NOT gate these:
--     * TRUNCATE BYPASSES RLS COMPLETELY. It is not a DELETE and no policy is consulted.
--       A role holding TRUNCATE can empty a table regardless of every policy on it.
--     * TRIGGER lets a role attach a trigger to a table it does not own. Combined with
--       EXECUTE on a SECURITY DEFINER function that is a privilege-escalation primitive.
--     * REFERENCES allows FKs against the table, which can be used to probe values that
--       RLS would otherwise hide.
--     * MAINTAIN (PostgreSQL 17) allows VACUUM / ANALYZE / REINDEX / CLUSTER -- a cheap
--       denial-of-service lever against million-row tables like raw_shots.
--
-- WHY IT IS SAFE: PostgREST only ever issues SELECT / INSERT / UPDATE / DELETE. None of
--   the four privileges revoked here is reachable through the API surface, and no policy,
--   view, function or trigger depends on the CALLER holding them (triggers fire with the
--   privileges checked at CREATE TRIGGER time, verified empirically in 0D-SEC-2a). This is
--   therefore a pure surface reduction with no behavioural change.
--
-- GATED, fail-closed and behaviour-preserving:
--   GATE 1 -- none of the four privileges survives for anon or authenticated.
--   GATE 2 -- every SELECT/INSERT/UPDATE/DELETE privilege matches a pre-change snapshot
--             exactly, so real application access is provably untouched.
--   GATE 3 -- service_role is unchanged.
--
-- VERIFIED ON PROD AFTER APPLY: anon TRUNCATE 78 -> 0, anon TRIGGER 78 -> 0, authenticated
--   TRUNCATE and TRIGGER likewise 0, with all DML counts unchanged.
--
-- NOT IN SCOPE: narrowing INSERT/UPDATE/DELETE per table. 78 tables still grant anon DML,
--   currently gated only by RLS policies. That needs per-table call-site evidence and is
--   tracked separately -- do not blanket-revoke DML without it.

DO $mig$
DECLARE
  r record; v_bad int := 0; v_n int;
BEGIN
  CREATE TEMP TABLE _dml_snap ON COMMIT DROP AS
  SELECT c.oid, c.relname,
         has_table_privilege('anon', c.oid,'SELECT') a_s,
         has_table_privilege('anon', c.oid,'INSERT') a_i,
         has_table_privilege('anon', c.oid,'UPDATE') a_u,
         has_table_privilege('anon', c.oid,'DELETE') a_d,
         has_table_privilege('authenticated', c.oid,'SELECT') t_s,
         has_table_privilege('authenticated', c.oid,'INSERT') t_i,
         has_table_privilege('authenticated', c.oid,'UPDATE') t_u,
         has_table_privilege('authenticated', c.oid,'DELETE') t_d,
         has_table_privilege('service_role', c.oid,'SELECT') s_s,
         has_table_privilege('service_role', c.oid,'INSERT') s_i
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r';

  FOR r IN SELECT relname FROM _dml_snap LOOP
    EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON public.%I FROM anon', r.relname);
    EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON public.%I FROM authenticated', r.relname);
  END LOOP;

  SELECT count(*) INTO v_bad FROM _dml_snap s
   WHERE has_table_privilege('anon', s.oid,'TRUNCATE') OR has_table_privilege('anon', s.oid,'TRIGGER')
      OR has_table_privilege('anon', s.oid,'REFERENCES') OR has_table_privilege('anon', s.oid,'MAINTAIN')
      OR has_table_privilege('authenticated', s.oid,'TRUNCATE') OR has_table_privilege('authenticated', s.oid,'TRIGGER')
      OR has_table_privilege('authenticated', s.oid,'REFERENCES') OR has_table_privilege('authenticated', s.oid,'MAINTAIN');
  IF v_bad<>0 THEN RAISE EXCEPTION 'GATE1 FAIL: % tables retain TRUNCATE/TRIGGER/REFERENCES/MAINTAIN', v_bad; END IF;

  SELECT count(*) INTO v_bad FROM _dml_snap s
   WHERE has_table_privilege('anon', s.oid,'SELECT') <> s.a_s
      OR has_table_privilege('anon', s.oid,'INSERT') <> s.a_i
      OR has_table_privilege('anon', s.oid,'UPDATE') <> s.a_u
      OR has_table_privilege('anon', s.oid,'DELETE') <> s.a_d
      OR has_table_privilege('authenticated', s.oid,'SELECT') <> s.t_s
      OR has_table_privilege('authenticated', s.oid,'INSERT') <> s.t_i
      OR has_table_privilege('authenticated', s.oid,'UPDATE') <> s.t_u
      OR has_table_privilege('authenticated', s.oid,'DELETE') <> s.t_d;
  IF v_bad<>0 THEN RAISE EXCEPTION 'GATE2 FAIL: DML changed on % tables', v_bad; END IF;

  SELECT count(*) INTO v_bad FROM _dml_snap s
   WHERE has_table_privilege('service_role', s.oid,'SELECT') <> s.s_s
      OR has_table_privilege('service_role', s.oid,'INSERT') <> s.s_i;
  IF v_bad<>0 THEN RAISE EXCEPTION 'GATE3 FAIL: service_role changed on % tables', v_bad; END IF;

  SELECT count(*) INTO v_n FROM _dml_snap;
  RAISE NOTICE '0D-SEC-3c OK: swept % tables', v_n;
END
$mig$;
