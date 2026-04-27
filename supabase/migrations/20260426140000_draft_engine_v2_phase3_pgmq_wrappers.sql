-- Draft Engine v2 — Phase 3 chunk 10c: pgmq wrappers for Edge Function.
--
-- The Phase 3 worker (supabase/functions/draft-autopick) needs to call
-- pgmq.read() and pgmq.archive() against the 'draft_deadlines' queue.
-- pgmq's functions live in the pgmq schema, but Supabase PostgREST
-- exposes only `public` by default — exposing the entire pgmq schema
-- to PostgREST would make every queue (including any future ones)
-- callable from the browser as authenticated.
--
-- Tighter alternative used here: thin SECURITY DEFINER wrappers in the
-- public schema, hardcoded to the 'draft_deadlines' queue, gated to
-- service_role/postgres. Same auth pattern as Phase 2 (D1/D2) and
-- chunk 10b's draft_deadline_sweep — anon / authenticated PostgREST
-- callers are rejected, leaked tokens still need service_role to
-- reach pgmq.
--
-- The Edge Function calls these via supabase.rpc('draft_autopick_read'
-- / 'draft_autopick_archive', ...) — standard PostgREST JSON-RPC.
--
-- Hardcoding to 'draft_deadlines' is intentional for v2.0 (single
-- queue). If v2.1 introduces a second queue, add a parallel wrapper
-- pair rather than parameterizing the queue name.

-- ── 1. draft_autopick_read — wraps pgmq.read('draft_deadlines',...) ──

CREATE OR REPLACE FUNCTION public.draft_autopick_read(
  p_vt  int DEFAULT 30,
  p_qty int DEFAULT 10
)
RETURNS TABLE (
  msg_id      bigint,
  read_ct     int,
  enqueued_at timestamptz,
  vt          timestamptz,
  message     jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
BEGIN
  v_caller_role := auth.role();
  IF v_caller_role NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'unauthorized: draft_autopick_read requires service_role/postgres (got %)',
      COALESCE(v_caller_role, 'NULL')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
    SELECT q.msg_id, q.read_ct, q.enqueued_at, q.vt, q.message
      FROM pgmq.read('draft_deadlines', p_vt, p_qty) q;
END;
$$;

COMMENT ON FUNCTION public.draft_autopick_read(int, int) IS
  'Phase 3 chunk 10c: thin public wrapper around pgmq.read for the draft_deadlines queue. service_role / postgres only. Edge Function (supabase/functions/draft-autopick) calls this via supabase.rpc().';

-- ── 2. draft_autopick_archive — wraps pgmq.archive ────────────────────

CREATE OR REPLACE FUNCTION public.draft_autopick_archive(
  p_msg_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
BEGIN
  v_caller_role := auth.role();
  IF v_caller_role NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'unauthorized: draft_autopick_archive requires service_role/postgres (got %)',
      COALESCE(v_caller_role, 'NULL')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN pgmq.archive('draft_deadlines', p_msg_id);
END;
$$;

COMMENT ON FUNCTION public.draft_autopick_archive(bigint) IS
  'Phase 3 chunk 10c: thin public wrapper around pgmq.archive for the draft_deadlines queue. service_role / postgres only. Removes a message from the active queue and stores it in the per-queue archive table.';

-- ── 3. Verify ─────────────────────────────────────────────────────────

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'draft_autopick_read'
  ) THEN
    RAISE EXCEPTION 'draft_autopick_read was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'draft_autopick_archive'
  ) THEN
    RAISE EXCEPTION 'draft_autopick_archive was not created';
  END IF;
END
$verify$;
