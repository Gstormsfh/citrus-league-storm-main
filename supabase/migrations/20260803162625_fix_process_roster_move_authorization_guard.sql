-- 0D-SEC-2h: Make process_roster_move's authorization guard context-aware.
--
-- APPLIED: prod 20260803162625 / staging (same name). Both databases end at
-- pg_get_functiondef md5 51a8b814cc1f77b7cd237c15cca28d09 (7897 chars).
--
-- OLD GUARD (broken in BOTH directions):
--     IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
--       RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: user_id mismatch');
--     END IF;
--
--   * Bypassed entirely when auth.uid() IS NULL. The function then looks the team up by
--     p_user_id -- the caller-supplied PARAMETER, not the authenticated identity -- so any
--     caller without a user JWT could act on any team. The anon key ships in the browser
--     bundle, so this was internet-reachable until 20260801022246 revoked anon EXECUTE.
--     This migration closes it at the logic layer so the grant is no longer the only control.
--   * Simultaneously TOO STRICT for the cron batch: pg_cron job 'process-pending-waivers'
--     reaches this via process_waiver_claims, which passes each claim's TEAM OWNER as
--     p_user_id. Hard-requiring auth.uid() would have silently killed nightly waiver
--     processing -- invisible until the season starts.
--
-- NEW GUARD: context first, then identity. Sequential ELSIF is deliberate -- PL/pgSQL
-- evaluates ELSIF branches in order, whereas a single IF ... OR ... OR ... does NOT
-- guarantee short-circuit, and ''::jsonb raises invalid input syntax for type json.
--
-- METHOD: derived from the live definition via pg_get_functiondef plus two exact-match
-- replacements, proven by a REVERSIBILITY GATE -- undoing both edits must reproduce the
-- original byte-for-byte, making "nothing else changed" structural rather than reviewed.

DO $mig$
DECLARE
  v_oid oid := 'public.process_roster_move(uuid,uuid,text,text,text)'::regprocedure;
  v_def text; v_new text;
  v_old_guard CONSTANT text :=
'  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RETURN jsonb_build_object(''success'', false, ''error'', ''Unauthorized: user_id mismatch'');
  END IF;';
  v_new_guard CONSTANT text :=
'  v_claims := current_setting(''request.jwt.claims'', true);
  IF COALESCE(v_claims, '''') = '''' THEN
    NULL;  -- trusted context: pg_cron / direct SQL, no JWT present
  ELSIF (v_claims::jsonb->>''role'') = ''service_role'' THEN
    NULL;  -- trusted context: server-side service_role
  ELSIF auth.uid() IS NULL THEN
    RETURN jsonb_build_object(''success'', false, ''error'', ''Not authenticated'');
  ELSIF p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object(''success'', false, ''error'', ''Unauthorized: user_id mismatch'');
  END IF;';
  v_old_decl CONSTANT text := '  v_operation_duration INTERVAL;
BEGIN';
  v_new_decl CONSTANT text := '  v_operation_duration INTERVAL;
  v_claims TEXT;
BEGIN';
BEGIN
  v_def := pg_get_functiondef(v_oid);

  IF position('Not authenticated' in v_def) > 0 THEN
    RAISE NOTICE '0D-SEC-2h already applied; no change';
    RETURN;
  END IF;

  IF (length(v_def) - length(replace(v_def, v_old_guard, ''))) / length(v_old_guard) <> 1 THEN
    RAISE EXCEPTION 'GATE1 FAIL: old guard not found exactly once';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old_decl, ''))) / length(v_old_decl) <> 1 THEN
    RAISE EXCEPTION 'GATE2 FAIL: declare anchor not found exactly once';
  END IF;

  v_new := replace(v_def, v_old_decl, v_new_decl);
  v_new := replace(v_new, v_old_guard, v_new_guard);

  IF replace(replace(v_new, v_new_guard, v_old_guard), v_new_decl, v_old_decl) <> v_def THEN
    RAISE EXCEPTION 'GATE3 FAIL: transformation not reversible -- unintended delta';
  END IF;

  EXECUTE v_new;

  IF position('Not authenticated' in pg_get_functiondef(v_oid)) = 0 THEN
    RAISE EXCEPTION 'GATE4 FAIL: new guard absent after apply';
  END IF;

  RAISE NOTICE '0D-SEC-2h OK';
END
$mig$;
