// draft-autopick — Phase 3 scaffold worker.
//
// Long-running Edge Function (≤140s under the 150s ceiling) that reads
// draft_deadlines pgmq messages and archives them. Phase 3 is archive-
// only NO-OP processing — no autopick state machine, no submit_pick_v2
// call. Phase 4 fills in the state machine (idempotency key, fresh
// state read, fallback heuristic, DLQ on read_ct >= 3).
//
// What this function does NOW (Phase 3):
//   1. Verify the caller is service_role (--no-verify-jwt deploy).
//   2. Loop until 140s budget exhausted or 30s idle reached:
//      - draft_autopick_read(vt=30, qty=10) → fetch up to 10 messages.
//      - For each: read fresh leagues row (exercises the path Phase 4
//        will use), log a structured `phase3_noop_archive` line,
//        draft_autopick_archive(msg_id).
//      - Sleep 5s between ticks.
//   3. Return a JSON summary of the invocation.
//
// What this function will do LATER (Phase 4):
//   - Replace the `phase3_noop_archive` block with the spec §5.2 state
//     machine: stale-message no-ops (state / generation / premature /
//     advanced), reconstruct_draft_state, queue lookup or fallback
//     heuristic, submit_pick_v2 with deterministic idempotency key,
//     DLQ insert on read_ct >= 3.
//
// Triggered by:
//   - pg_cron keep-alive every 2 min (chunk 10d)
//   - manual operator invocation (incident response)
//   - chunk 10e integration scenarios (curl from psql via net.http_post)
//
// Auth model:
//   Deploy with `supabase functions deploy draft-autopick --no-verify-jwt`.
//   The platform skips JWT verification; this function compares the
//   caller's `Authorization: Bearer <token>` against
//   SUPABASE_SERVICE_ROLE_KEY. anon / authenticated callers get 401.
//   Chunk 10d will route the cron's bearer token through Vault rather
//   than baking the service-role key into cron.command.
//
// Env vars (auto-provided by the platform):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { timingSafeEqual } from "https://deno.land/std@0.168.0/crypto/timing_safe_equal.ts";
import { createServiceRoleClient } from "../_shared/supabaseClient.ts";
// SMOKE-ONLY: verify Supabase CLI bundles the _shared/citrus_shared
// re-export shim (which traverses outside supabase/ to packages/shared/).
// Revert this import + the console.log below after the deploy succeeds.
import { AUTOPICK_NAMESPACE_UUID } from "../_shared/citrus_shared.ts";
console.info(
  JSON.stringify({
    service: "draft-autopick",
    event: "shim_smoke",
    autopick_namespace_uuid: AUTOPICK_NAMESPACE_UUID,
  }),
);

const SERVICE_NAME = "draft-autopick";
const LOOP_BUDGET_MS = 140_000; // 10s headroom under the 150s Edge Function ceiling
const IDLE_RETURN_MS = 30_000;  // exit early after 30s of empty queue
const TICK_SLEEP_MS = 5_000;
const PGMQ_VT_SECONDS = 30;
const PGMQ_BATCH_QTY = 10;

interface DraftDeadlineMessage {
  league_id: string;
  pick_number: number;
  generation: number;
  scheduled_for: string;
  source: string;
}

interface PgmqRow {
  msg_id: number;
  read_ct: number;
  enqueued_at: string;
  vt: string;
  message: DraftDeadlineMessage;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const jsonResponse = (body: Record<string, unknown>, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

serve(async (req: Request) => {
  // ── Auth (deploy uses --no-verify-jwt; we enforce here) ───────────
  const expectedToken = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!expectedToken) {
    return jsonResponse(
      {
        error: "internal: SUPABASE_SERVICE_ROLE_KEY not configured",
      },
      500,
    );
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const presented = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : "";

  // Constant-time bearer compare. Deno std's timingSafeEqual returns
  // false (does not throw) when input lengths differ, so it doubles as
  // the length check.
  const presentedBytes = new TextEncoder().encode(presented);
  const expectedBytes = new TextEncoder().encode(expectedToken);
  if (!timingSafeEqual(presentedBytes, expectedBytes)) {
    console.warn(
      JSON.stringify({
        service: SERVICE_NAME,
        event: "auth_failed",
        ip: req.headers.get("x-forwarded-for") ?? "unknown",
      }),
    );
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  // ── Worker invocation ─────────────────────────────────────────────
  const invocationId = crypto.randomUUID();
  const startedAt = Date.now();
  const supabase = createServiceRoleClient();

  let ticks = 0;
  let messagesProcessed = 0;
  let archiveFailures = 0;
  let readFailures = 0;
  let idleSince: number | null = null;
  let earlyExit: "loop_budget" | "idle_timeout" | "error" = "loop_budget";

  console.info(
    JSON.stringify({
      service: SERVICE_NAME,
      invocation_id: invocationId,
      event: "worker_started",
      started_at: new Date(startedAt).toISOString(),
    }),
  );

  try {
    while (Date.now() - startedAt < LOOP_BUDGET_MS) {
      ticks += 1;

      const { data, error } = await supabase.rpc("draft_autopick_read", {
        p_vt: PGMQ_VT_SECONDS,
        p_qty: PGMQ_BATCH_QTY,
      });

      if (error) {
        readFailures += 1;
        console.error(
          JSON.stringify({
            service: SERVICE_NAME,
            invocation_id: invocationId,
            event: "pgmq_read_failed",
            error: error.message,
            tick: ticks,
          }),
        );
        // Transient errors don't kill the worker — keep-alive cron
        // re-invokes. Sleep and retry.
        await sleep(TICK_SLEEP_MS);
        continue;
      }

      const messages = (data ?? []) as PgmqRow[];

      if (messages.length === 0) {
        if (idleSince === null) {
          idleSince = Date.now();
        } else if (Date.now() - idleSince > IDLE_RETURN_MS) {
          earlyExit = "idle_timeout";
          break;
        }
        await sleep(TICK_SLEEP_MS);
        continue;
      }

      idleSince = null;

      for (const msg of messages) {
        // Phase 3 stub: read fresh leagues row so we exercise the
        // permission path Phase 4 will need, but no state-machine
        // logic. Just log + archive.
        const { data: league } = await supabase
          .from("leagues")
          .select("pick_deadline, draft_state, draft_generation")
          .eq("id", msg.message.league_id)
          .maybeSingle();

        console.info(
          JSON.stringify({
            service: SERVICE_NAME,
            invocation_id: invocationId,
            event: "phase3_noop_archive",
            msg_id: msg.msg_id,
            read_ct: msg.read_ct,
            league_id: msg.message.league_id,
            source: msg.message.source,
            pick_number: msg.message.pick_number,
            msg_generation: msg.message.generation,
            league_generation: league?.draft_generation ?? null,
            league_state: league?.draft_state ?? null,
            league_pick_deadline: league?.pick_deadline ?? null,
            tick: ticks,
          }),
        );

        const { error: archiveError } = await supabase.rpc(
          "draft_autopick_archive",
          { p_msg_id: msg.msg_id },
        );

        if (archiveError) {
          archiveFailures += 1;
          console.error(
            JSON.stringify({
              service: SERVICE_NAME,
              invocation_id: invocationId,
              event: "pgmq_archive_failed",
              msg_id: msg.msg_id,
              error: archiveError.message,
              tick: ticks,
            }),
          );
          // Don't increment processed; pgmq vt expires and redelivers.
          continue;
        }

        messagesProcessed += 1;
      }

      await sleep(TICK_SLEEP_MS);
    }
  } catch (e) {
    earlyExit = "error";
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(
      JSON.stringify({
        service: SERVICE_NAME,
        invocation_id: invocationId,
        event: "worker_uncaught_error",
        error: errMsg,
      }),
    );
  }

  const endedAt = Date.now();
  const summary = {
    service: SERVICE_NAME,
    invocation_id: invocationId,
    event: "worker_finished",
    started_at: new Date(startedAt).toISOString(),
    ended_at: new Date(endedAt).toISOString(),
    duration_ms: endedAt - startedAt,
    ticks,
    messages_processed: messagesProcessed,
    archive_failures: archiveFailures,
    read_failures: readFailures,
    early_exit: earlyExit,
  };

  console.info(JSON.stringify(summary));
  return jsonResponse(summary, 200);
});
