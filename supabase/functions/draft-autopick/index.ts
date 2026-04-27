// draft-autopick — Phase 4 worker (spec §5.3 state machine).
//
// Long-running Edge Function (≤140s under the 150s ceiling) that
// reads draft_deadlines pgmq messages and runs the autopick decision
// state machine. This file replaces Phase 3's archive-only scaffold
// with the real worker per spec §5.3.
//
// Per-message processing (spec §5.3, in order):
//   1. read_ct >= 3 → DLQ (draft_autopick_dlq RPC: insert
//      autopick_failures row + emit autopick_failed event in one
//      tx) → archive → metric 'autopick_dlq' → continue.
//   2. Generate per-message correlation_id for trace joins.
//   3. Read fresh leagues row (draft_state, draft_generation,
//      pick_deadline, league_size, settings, scoring_settings).
//      Unknown league → archive + log worker_skip_unknown_league.
//   4. Stale-message gates (each archive + log + continue):
//        a. league.draft_state != 'active' → worker_skip_state.
//        b. msg.generation != league.draft_generation →
//           worker_skip_generation. Pause/resume/extend invariant:
//           every lifecycle event that bumps draft_generation
//           instantly invalidates every in-flight pgmq message.
//        c. now() < league.pick_deadline → worker_skip_premature
//           (deadline was extended after enqueue).
//        d. msg.pick_number != current_pick (from
//           reconstruct_draft_state) → worker_skip_pick_advanced
//           (a human picked between enqueue and read).
//   5. Determine on-the-clock team from reconstruct_draft_state.
//   6. Pick player:
//        a. draft_queues for that team, ordered by position; first
//           undrafted entry wins. Picked_via='queue'.
//        b. else heuristic.ts selectByHeuristic(...) over
//           player_directory + player_season_stats. Picked_via=
//           'heuristic'.
//   7. Compute payload_hash via @citrus/shared computePickPayloadHash
//      (cross-runtime hash agreement, spec §7.3).
//   8. Compute idempotency_key = uuidv5(AUTOPICK_NAMESPACE_UUID,
//      `${league_id}|${pick_number}|${generation}|autopick`).
//   9. submit_pick_v2 with actor.kind='autopick' (per D2 auth gate).
//      Outcome:
//        - success → archive + metric 'autopick_fired'.
//        - idempotency_conflict → archive + log
//          'autopick_human_picked_just_in_time' (expected race; not
//          an error).
//        - retryable error → DO NOT archive; pgmq vt expires,
//          redelivers, read_ct increments; cap at 3 → step 1.
//
// Logging budget (per chunk 11 design call #1):
//   - draft_metrics rows: autopick_fired, autopick_dlq.
//   - log-only (Cloud Logging only, no metric rows):
//     all worker_skip_* variants, autopick_human_picked_just_in_time,
//     pgmq_*_failed, worker_uncaught_error, worker_started/finished.
//
// Triggered by:
//   - pg_cron keep-alive every 2 min (chunk 10d).
//   - manual operator invocation (incident response).
//   - chunk 11e integration scenarios via net.http_post.
//
// Auth model (unchanged from Phase 3 / chunk 10c):
//   Deploy with `--no-verify-jwt`. timingSafeEqual compare against
//   SUPABASE_SERVICE_ROLE_KEY (chunk 10c follow-up).
//
// Env vars (auto-provided by the platform):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { timingSafeEqual } from "https://deno.land/std@0.168.0/crypto/timing_safe_equal.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createServiceRoleClient } from "../_shared/supabaseClient.ts";
import {
  AUTOPICK_NAMESPACE_UUID,
  computePickPayloadHash,
  CURRENT_SEASON,
  type ScoringSettings,
} from "../_shared/citrus_shared.ts";
import { selectByHeuristic, type HeuristicPlayer } from "./heuristic.ts";
import { uuidv5 } from "./uuidv5.ts";

const SERVICE_NAME = "draft-autopick";
const LOOP_BUDGET_MS = 140_000; // 10s headroom under the 150s Edge Function ceiling
const IDLE_RETURN_MS = 30_000;  // exit early after 30s of empty queue
const TICK_SLEEP_MS = 5_000;
const PGMQ_VT_SECONDS = 30;
const PGMQ_BATCH_QTY = 10;
const READ_CT_DLQ_THRESHOLD = 3;  // spec §5.3

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

interface LeagueRow {
  draft_state: string;
  draft_generation: number;
  pick_deadline: string | null;
  league_size: number | null;
  settings: Record<string, unknown> | null;
  scoring_settings: ScoringSettings | null;
}

interface ReconstructedState {
  current_pick_number: number;
  on_the_clock_team_id: string | null;
  draft_state: string;
  generation: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const jsonResponse = (body: Record<string, unknown>, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Single-line JSON log with consistent envelope. */
function logEvent(
  level: "info" | "warn" | "error",
  invocationId: string,
  event: string,
  extra: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({
    service: SERVICE_NAME,
    invocation_id: invocationId,
    event,
    ...extra,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

/**
 * Insert into draft_metrics. Used only for the two metrics in the
 * Phase 4 logging budget: 'autopick_fired' and 'autopick_dlq'. All
 * other event types are log-only (chunk 11 design call #1 — keep
 * draft_metrics from filling on operationally-interesting-but-not-
 * aggregated events).
 */
async function emitMetric(
  supabase: SupabaseClient,
  metric: string,
  leagueId: string,
  detail: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("draft_metrics").insert({
    metric,
    league_id: leagueId,
    value: 1,
    detail,
  });
  if (error) {
    // Don't throw — metric write failure is not a worker-failure.
    console.error(JSON.stringify({
      service: SERVICE_NAME,
      event: "metric_write_failed",
      metric,
      league_id: leagueId,
      error: error.message,
    }));
  }
}

// ── Per-message state machine (spec §5.3) ─────────────────────────────
// All worker decisions for one pgmq message live here. Mutates the
// `counters` object passed by reference; never throws on expected
// outcomes (DLQ, stale skips, idempotency_conflict, post-preflight
// races) — those archive the message. Throws only on truly retryable
// conditions (read failures, RPC failures with no spec error code) so
// the message stays in the queue and gets redelivered.

interface WorkerCounters {
  ticks: number;
  messagesProcessed: number;
  archiveFailures: number;
  readFailures: number;
  picksCommitted: number;
  picksIdempotentReplays: number;
  dlqInserted: number;
  skippedStale: number;
}

async function processMessage(
  supabase: SupabaseClient,
  msg: PgmqRow,
  invocationId: string,
  counters: WorkerCounters,
): Promise<void> {
  const leagueId = msg.message.league_id;
  const baseLog = {
    msg_id:          msg.msg_id,
    read_ct:         msg.read_ct,
    league_id:       leagueId,
    source:          msg.message.source,
    msg_pick_number: msg.message.pick_number,
    msg_generation:  msg.message.generation,
  };

  // archive() is the only place that bumps messagesProcessed.
  // category determines which sub-counter to bump.
  const archive = async (
    category: "skip" | "pick" | "replay" | "dlq",
  ): Promise<boolean> => {
    const { error: archErr } = await supabase.rpc(
      "draft_autopick_archive",
      { p_msg_id: msg.msg_id },
    );
    if (archErr) {
      counters.archiveFailures += 1;
      logEvent("error", invocationId, "pgmq_archive_failed", {
        ...baseLog,
        error: archErr.message,
      });
      return false;
    }
    if (category === "skip")   counters.skippedStale          += 1;
    if (category === "pick")   counters.picksCommitted        += 1;
    if (category === "replay") counters.picksIdempotentReplays += 1;
    if (category === "dlq")    counters.dlqInserted           += 1;
    counters.messagesProcessed += 1;
    return true;
  };

  // ── Step 1: 3-strikes-and-DLQ. ──
  if (msg.read_ct >= READ_CT_DLQ_THRESHOLD) {
    const { data: dlqResult, error: dlqErr } = await supabase.rpc(
      "draft_autopick_dlq",
      {
        p_league_id:      leagueId,
        p_pgmq_msg_id:    msg.msg_id,
        p_payload:        msg.message,
        p_last_error:     `read_ct >= ${READ_CT_DLQ_THRESHOLD}`,
        p_read_ct:        msg.read_ct,
        p_correlation_id: null,
      },
    );
    if (dlqErr) {
      // Don't archive — DLQ insert is the prerequisite. pgmq vt
      // expires; message redelivers; we retry.
      logEvent("error", invocationId, "dlq_rpc_failed", {
        ...baseLog,
        error: dlqErr.message,
      });
      return;
    }
    const dlq = (dlqResult ?? {}) as Record<string, unknown>;
    await emitMetric(supabase, "autopick_dlq", leagueId, {
      ...baseLog,
      already_dlq: dlq.already_dlq ?? false,
      dlq_id:      dlq.dlq_id ?? null,
      event_id:    dlq.event_id ?? null,
    });
    logEvent("warn", invocationId, "autopick_dlq", {
      ...baseLog,
      already_dlq: dlq.already_dlq ?? false,
    });
    await archive("dlq");
    return;
  }

  // ── Step 2: per-message correlation_id. ──
  const correlationId = crypto.randomUUID();

  // ── Step 3: read fresh leagues row. ──
  const { data: leagueData, error: leagueErr } = await supabase
    .from("leagues")
    .select(
      "draft_state, draft_generation, pick_deadline, league_size, settings, scoring_settings",
    )
    .eq("id", leagueId)
    .maybeSingle();
  if (leagueErr) {
    logEvent("error", invocationId, "league_read_failed", {
      ...baseLog,
      error: leagueErr.message,
    });
    return; // retryable
  }
  if (!leagueData) {
    logEvent("warn", invocationId, "worker_skip_unknown_league", baseLog);
    await archive("skip");
    return;
  }
  const league = leagueData as LeagueRow;

  // ── Step 4: stale-message gates (a, b, c here; d after reconstruct). ──

  if (league.draft_state !== "active") {
    logEvent("info", invocationId, "worker_skip_state", {
      ...baseLog,
      league_state: league.draft_state,
    });
    await archive("skip");
    return;
  }

  // Pause/resume/extend invariant.
  if (msg.message.generation !== league.draft_generation) {
    logEvent("info", invocationId, "worker_skip_generation", {
      ...baseLog,
      league_generation: league.draft_generation,
    });
    await archive("skip");
    return;
  }

  if (league.pick_deadline) {
    const deadlineMs = new Date(league.pick_deadline).getTime();
    if (Date.now() < deadlineMs) {
      logEvent("info", invocationId, "worker_skip_premature", {
        ...baseLog,
        league_pick_deadline: league.pick_deadline,
      });
      await archive("skip");
      return;
    }
  }

  // ── Step 5: reconstruct draft state. ──
  const { data: stateData, error: stateErr } = await supabase.rpc(
    "reconstruct_draft_state",
    { p_league_id: leagueId },
  );
  if (stateErr || !stateData) {
    logEvent("error", invocationId, "state_reconstruct_failed", {
      ...baseLog,
      error: stateErr?.message ?? "no data",
    });
    return; // retryable
  }
  const state = stateData as ReconstructedState;
  const currentPick = state.current_pick_number;

  // 4d: pick advanced (a human picked between enqueue and read).
  if (msg.message.pick_number !== currentPick) {
    logEvent("info", invocationId, "worker_skip_pick_advanced", {
      ...baseLog,
      current_pick_number: currentPick,
    });
    await archive("skip");
    return;
  }

  const teamId = state.on_the_clock_team_id;
  if (!teamId) {
    logEvent("warn", invocationId, "worker_skip_no_team", {
      ...baseLog,
      reconstructed_state: state.draft_state,
    });
    await archive("skip");
    return;
  }

  const leagueSize = league.league_size ?? 12;
  const round = Math.ceil(currentPick / leagueSize);

  // ── Step 6: select player (queue → heuristic fallback). ──
  const { data: draftedRows, error: draftedErr } = await supabase
    .from("draft_picks_v2")
    .select("player_id, team_id")
    .eq("league_id", leagueId);
  if (draftedErr) {
    logEvent("error", invocationId, "drafted_read_failed", {
      ...baseLog,
      error: draftedErr.message,
    });
    return; // retryable
  }
  const draftedRowsTyped =
    (draftedRows ?? []) as Array<{ player_id: number; team_id: string }>;
  const draftedSet = new Set(draftedRowsTyped.map((r) => r.player_id));

  let pickedPlayerId: number | null = null;
  let pickedVia: "queue" | "heuristic" = "heuristic";

  // 6a: queue.
  const { data: queueRows, error: queueErr } = await supabase
    .from("draft_queues")
    .select("player_id, position")
    .eq("team_id", teamId)
    .order("position", { ascending: true });
  if (queueErr) {
    logEvent("warn", invocationId, "queue_read_failed", {
      ...baseLog,
      team_id: teamId,
      error: queueErr.message,
    });
    // Non-fatal — proceed to heuristic.
  }
  for (const q of (queueRows ?? []) as Array<{ player_id: number; position: number }>) {
    if (!draftedSet.has(q.player_id)) {
      pickedPlayerId = q.player_id;
      pickedVia = "queue";
      break;
    }
  }

  // 6b: heuristic fallback.
  if (pickedPlayerId === null) {
    const { data: candidatesData, error: candErr } = await supabase
      .from("player_directory")
      .select(
        `player_id, position_code,
         player_season_stats!inner(goals, primary_assists, secondary_assists, shots_on_goal, blocks, hits, pim, ppp, shp, wins, saves, shutouts, goals_against)`,
      )
      .eq("season", CURRENT_SEASON)
      .eq("player_season_stats.season", CURRENT_SEASON);
    if (candErr || !candidatesData) {
      logEvent("error", invocationId, "candidates_read_failed", {
        ...baseLog,
        error: candErr?.message ?? "no data",
      });
      return; // retryable
    }
    interface CandStats {
      goals: number; primary_assists: number; secondary_assists: number;
      shots_on_goal: number; blocks: number; hits: number; pim: number;
      ppp: number; shp: number;
      wins: number; saves: number; shutouts: number; goals_against: number;
    }
    interface CandRow {
      player_id: number;
      position_code: string | null;
      player_season_stats: CandStats | CandStats[];
    }
    const undraftedPlayers: HeuristicPlayer[] = [];
    for (const r of candidatesData as CandRow[]) {
      if (draftedSet.has(r.player_id)) continue;
      const s = Array.isArray(r.player_season_stats)
        ? r.player_season_stats[0]
        : r.player_season_stats;
      if (!s) continue;
      undraftedPlayers.push({
        id:       r.player_id,
        position: r.position_code,
        goals:    s.goals,
        assists:  s.primary_assists + s.secondary_assists,
        shots:    s.shots_on_goal,
        blocks:   s.blocks,
        hits:     s.hits,
        pim:      s.pim,
        ppp:      s.ppp,
        shp:      s.shp,
        wins:     s.wins,
        saves:    s.saves,
        shutouts: s.shutouts,
        goals_against: s.goals_against,
      });
    }

    // Team's prior picks → positions (for heuristic positional needs).
    const priorIds = draftedRowsTyped
      .filter((r) => r.team_id === teamId)
      .map((r) => r.player_id);
    let teamPriorPositions: Array<string | null> = [];
    if (priorIds.length > 0) {
      const { data: priorPosRows } = await supabase
        .from("player_directory")
        .select("position_code")
        .eq("season", CURRENT_SEASON)
        .in("player_id", priorIds);
      teamPriorPositions = ((priorPosRows ?? []) as Array<{ position_code: string | null }>)
        .map((r) => r.position_code);
    }

    const result = selectByHeuristic({
      undraftedPlayers,
      teamPriorPositions,
      leagueScoring:  league.scoring_settings,
      leagueSettings: (league.settings ?? {}) as {
        positionType?: "individual" | "forward";
        rosterSlots?: Record<string, number>;
      },
    });

    if (!result) {
      logEvent("error", invocationId, "heuristic_no_candidate", {
        ...baseLog,
        team_id: teamId,
        undrafted_count: undraftedPlayers.length,
      });
      return; // retryable; ought to be impossible (exhausted pool)
    }
    pickedPlayerId = result.selected.id;
  }

  // ── Step 7: payload_hash via shared helper (cross-runtime parity). ──
  const payloadHash = await computePickPayloadHash({
    pick_number: currentPick,
    round,
    team_id:     teamId,
    player_id:   pickedPlayerId,
  });

  // ── Step 8: deterministic idempotency_key. ──
  const idempotencyKey = await uuidv5(
    AUTOPICK_NAMESPACE_UUID,
    `${leagueId}|${currentPick}|${league.draft_generation}|autopick`,
  );

  // ── Step 9: submit_pick_v2. ──
  const { data: submitRes, error: submitErr } = await supabase.rpc(
    "submit_pick_v2",
    {
      p_league_id:       leagueId,
      p_team_id:         teamId,
      p_player_id:       pickedPlayerId,
      p_round:           round,
      p_pick_number:     currentPick,
      p_session_id:      null,
      p_idempotency_key: idempotencyKey,
      p_payload_hash:    payloadHash,
      p_actor:           { kind: "autopick" },
      p_correlation_id:  correlationId,
    },
  );

  if (submitErr) {
    const errMsg  = submitErr.message ?? "";
    const errCode = submitErr.code ?? "";

    // Outcome routing by SQLSTATE first, with a substring tiebreaker
    // for the one ambiguous code. Phase 2's submit_pick_v2 raises:
    //   23505 unique_violation:    idempotency_conflict OR player_taken
    //   23514 check_violation:     pick_out_of_order, not_on_clock,
    //                              illegal_state (state/size variants)
    //   02000 no_data_found:       illegal_state (league not found,
    //                              draft_order missing)
    //   42501 insufficient_priv:   unauthorized — should never happen
    //                              in the autopick path; falls through
    //                              to retryable→DLQ as a misconfig signal.
    if (errCode === "23505") {
      // 23505 collision: idempotency_conflict (expected race; replay)
      // vs player_taken (preflight race; skip). Substring disambig
      // is bounded to this branch only.
      if (errMsg.includes("idempotency_conflict")) {
        logEvent("info", invocationId, "autopick_human_picked_just_in_time", {
          ...baseLog,
          team_id: teamId,
          pick_number: currentPick,
        });
        await archive("replay");
        return;
      }
      // Default 23505 (player_taken, or any future 23505 from the RPC)
      // → preflight race. Safe to archive.
      logEvent("info", invocationId, "worker_skip_post_preflight", {
        ...baseLog,
        team_id: teamId,
        pick_number: currentPick,
        err_code: errCode,
        error: errMsg,
      });
      await archive("skip");
      return;
    }
    if (errCode === "23514" || errCode === "02000") {
      // 23514: pick_out_of_order / not_on_clock / illegal_state
      // (state/size). 02000: illegal_state (league not found /
      // draft_order missing). All stale-slot or no-recovery
      // conditions; archive.
      logEvent("info", invocationId, "worker_skip_post_preflight", {
        ...baseLog,
        team_id: teamId,
        pick_number: currentPick,
        err_code: errCode,
        error: errMsg,
      });
      await archive("skip");
      return;
    }
    // Anything else (42501 unauthorized misconfig, 5xx, network,
    // unknown SQLSTATE) → retryable; pgmq vt expires, redelivers,
    // read_ct increments toward DLQ threshold.
    logEvent("error", invocationId, "submit_pick_v2_retryable", {
      ...baseLog,
      team_id: teamId,
      pick_number: currentPick,
      err_code: errCode,
      error: errMsg,
    });
    return;
  }

  // Success.
  const submitJson = (submitRes ?? {}) as Record<string, unknown>;
  await emitMetric(supabase, "autopick_fired", leagueId, {
    pick_number:    currentPick,
    generation:     league.draft_generation,
    picked_via:     pickedVia,
    player_id:      pickedPlayerId,
    team_id:        teamId,
    correlation_id: correlationId,
  });
  logEvent("info", invocationId, "autopick_fired", {
    ...baseLog,
    team_id:       teamId,
    player_id:     pickedPlayerId,
    pick_number:   currentPick,
    picked_via:    pickedVia,
    event_id:      submitJson.event_id,
    seq:           submitJson.seq,
    was_duplicate: submitJson.was_duplicate,
  });
  await archive("pick");
}

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

  // SMOKE-ONLY DIAGNOSTIC (claude/phase4-auth-debug throwaway branch):
  // log token shape (length + 5-char prefix + 5-char suffix only —
  // never the middle of a JWT) so we can compare what the platform's
  // SUPABASE_SERVICE_ROLE_KEY auto-injects against what pg_net is
  // sending from Vault. Revert before merging back to Phase 4 branch.
  // See chunk 11e auth-failed diagnosis hypothesis 2.
  console.info(
    JSON.stringify({
      service: SERVICE_NAME,
      event: "auth_debug",
      expected_len:    expectedToken.length,
      expected_prefix: expectedToken.slice(0, 5),
      expected_suffix: expectedToken.slice(-5),
      presented_len:    presented.length,
      presented_prefix: presented.slice(0, 5),
      presented_suffix: presented.slice(-5),
    }),
  );

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

  // Mutable counters; processMessage updates these in place.
  const counters = {
    ticks: 0,
    messagesProcessed: 0,        // any archive-bound terminal action
    archiveFailures: 0,
    readFailures: 0,
    picksCommitted: 0,           // submit_pick_v2 success
    picksIdempotentReplays: 0,   // submit_pick_v2 idempotency_conflict
    dlqInserted: 0,              // draft_autopick_dlq first-time insert
    skippedStale: 0,             // worker_skip_* total (across all 4 gates + unknown_league)
  };
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
      counters.ticks += 1;

      const { data, error } = await supabase.rpc("draft_autopick_read", {
        p_vt: PGMQ_VT_SECONDS,
        p_qty: PGMQ_BATCH_QTY,
      });

      if (error) {
        counters.readFailures += 1;
        logEvent("error", invocationId, "pgmq_read_failed", {
          error: error.message,
          tick: counters.ticks,
        });
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
        await processMessage(supabase, msg, invocationId, counters);
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
    ticks: counters.ticks,
    messages_processed: counters.messagesProcessed,
    archive_failures: counters.archiveFailures,
    read_failures: counters.readFailures,
    picks_committed: counters.picksCommitted,
    picks_idempotent_replays: counters.picksIdempotentReplays,
    dlq_inserted: counters.dlqInserted,
    skipped_stale: counters.skippedStale,
    early_exit: earlyExit,
  };

  console.info(JSON.stringify(summary));
  return jsonResponse(summary, 200);
});
