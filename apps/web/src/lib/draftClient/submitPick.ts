// DR-2 chunk (2026-07-29) — human pick submission.
//
// Pure(ish) function that POSTs a pick to
// `/api/draft/v2/league/:leagueId/pick` (server/src/routes/draftV2Pick.ts:53)
// and translates the server's error taxonomy into human-facing reasons
// the optimistic layer consumes.
//
// Server contract (verified against draftV2Pick.ts + DraftServiceV2):
//   Headers: X-Idempotency-Key (required UUID), X-Correlation-Id (optional UUID)
//   Body:    { team_id, player_id, round, pick_number }
//   200:     { event_id, seq, pick_deadline, was_duplicate }
//   Errors:  400 invalid_event_payload / 401 auth / 403 unauthorized /
//            409 idempotency_conflict / 409 pick_out_of_order /
//            409 not_on_clock / 409 player_taken / 422 illegal_state /
//            500 illegal_state_transition
//
// Key architectural choice (DR-2 architect ratification 2026-07-29):
// SAME UUID serves as both X-Idempotency-Key AND X-Correlation-Id per
// submit ATTEMPT. Each new attempt (including resubmit-after-rollback)
// generates a fresh UUID. apiClient's own transient-retry machinery
// reuses the same request → same key → the server's idempotency layer
// dedupes with `was_duplicate=true`. No conflict cases.
//
// pick_out_of_order translation: when the clock expires mid-submit,
// autopick takes the slot. Server sees the client's original
// pick_number as stale (already advanced) and returns pick_out_of_order.
// Copy: "Your clock ran out — autopick made your choice."

// Dynamic import inside submitPick() mirrors defaultFetchDiscovery /
// defaultFetchSnapshot / fetchDraftOrderMatrix — keeps vi.mock hoisting
// clean for tests that stub `@/api/client`.

export interface SubmitPickInput {
  leagueId: string;
  teamId: string;
  playerId: number;
  roundNumber: number;
  pickNumber: number;
  /**
   * Client-generated UUIDv4. Serves as both X-Idempotency-Key AND
   * X-Correlation-Id per architect ratification. Caller records this
   * in `store.recordPending` BEFORE calling submitPick so the pending-
   * action map has the entry when the broadcast (which echoes this
   * correlationId) arrives.
   */
  attemptId: string;
}

export interface SubmitPickSuccess {
  ok: true;
  eventId: string;
  seq: number;
  pickDeadline: string | null;
  wasDuplicate: boolean;
}

/**
 * Client-facing reason codes with human copy. UI surfaces `.message`;
 * `.code` is stable for tests and telemetry.
 */
export type SubmitPickFailureReason =
  | 'not_on_clock'
  | 'player_taken'
  | 'clock_expired'
  | 'unauthorized'
  | 'idempotency_conflict'
  | 'illegal_state'
  | 'invalid_payload'
  | 'server_error'
  | 'network_or_timeout';

export interface SubmitPickFailure {
  ok: false;
  reason: SubmitPickFailureReason;
  /** Human-readable copy suitable for a toast. */
  message: string;
  /** HTTP status when available (undefined for network failures). */
  statusCode?: number;
}

export type SubmitPickResult = SubmitPickSuccess | SubmitPickFailure;

/**
 * Type predicate for the failure branch. Narrows `SubmitPickResult`
 * to `SubmitPickFailure` explicitly — TypeScript's built-in narrowing
 * on the `ok` discriminant is inconsistent across call sites in the
 * test suite (works in application code, fails in a subset of Vitest
 * `it` closures), so a predicate delivers zero TS errors on every
 * consumer regardless of surrounding context.
 */
export function isSubmitPickFailure(
  r: SubmitPickResult,
): r is SubmitPickFailure {
  return r.ok === false;
}

// ── Human copy ─────────────────────────────────────────────────────
//
// Kept out of any i18n framework for DR-2 scope; can be lifted later.
// Copy choices reflect the semantics the server exposes:
//   - not_on_clock:  the caller's team isn't on the clock right now.
//     Could be a stale UI (autopick advanced), or the user clicked
//     just after their turn passed. UI recovers on the next event fold.
//   - player_taken:  another team drafted this player. Common race.
//   - clock_expired: pick_out_of_order surfaces the "clock ran out
//     mid-submit → autopick won" scenario per DR-2 investigation (a).
//   - unauthorized:  user isn't the team owner. Should never happen
//     via the UI (control is gated) but is defense-in-depth.
//   - idempotency_conflict: same key, different intent. Shouldn't
//     happen since we generate a fresh UUID per attempt; if it does,
//     it means state corruption; ask user to refresh.
//   - illegal_state: draft not active. Show generic "not open" copy.
//   - network_or_timeout: the ~8s client timeout hit, or the fetch
//     rejected. Server MAY have committed the pick anyway; the
//     broadcast/resync path will reconcile if so. Copy walks a fine
//     line: "we couldn't confirm your pick — check the board" (matches
//     the architect's amendment to the 8s rollback path).
const HUMAN_COPY: Record<SubmitPickFailureReason, string> = {
  not_on_clock: "It's not your turn anymore",
  player_taken: 'Someone already took that player',
  clock_expired: 'Your clock ran out. Autopick made your choice',
  unauthorized: "You don't own this team",
  idempotency_conflict: 'Duplicate submit. Please refresh',
  illegal_state: "Draft isn't open",
  invalid_payload: 'Invalid pick. Please refresh',
  server_error: 'Server error. Please try again',
  network_or_timeout: "We couldn't confirm your pick. Check the board",
};

/**
 * Map the server-side error code (as returned in the ApiResponse's
 * `error` field or inferred from HTTP status) to our client reason
 * enum. Falls back to `server_error` for anything unrecognized so
 * DR-2 never renders a blank toast on a novel error string.
 */
function mapServerError(
  errorString: string | undefined,
  statusCode: number | undefined,
): SubmitPickFailureReason {
  const s = (errorString ?? '').toLowerCase();
  if (s.includes('not_on_clock')) return 'not_on_clock';
  if (s.includes('player_taken')) return 'player_taken';
  // pick_out_of_order manifests as clock_expired for user-facing copy
  // per DR-2 investigation (a) — server has no explicit clock_expired
  // code; the race case surfaces as pick_out_of_order because autopick
  // advanced pick_number ahead of the human's submit.
  if (s.includes('pick_out_of_order')) return 'clock_expired';
  if (s.includes('idempotency_conflict')) return 'idempotency_conflict';
  if (s.includes('unauthorized') || statusCode === 403) return 'unauthorized';
  if (s.includes('illegal_state')) return 'illegal_state';
  if (s.includes('invalid_event_payload') || statusCode === 400) {
    return 'invalid_payload';
  }
  return 'server_error';
}

/**
 * Submit a pick to the DR-2 server route. Returns a discriminated
 * union — caller inspects `.ok` to fork.
 *
 * Timeout: 8s per architect ratification. Applies REGARDLESS of WS
 * state — a connected socket with a lost confirm must not dangle a
 * pending pick forever. Copy for the timeout: "We couldn't confirm
 * your pick — check the board" (network_or_timeout).
 *
 * The caller is responsible for `store.recordPending` BEFORE calling
 * this, and `store.rollBackPending` / broadcast reconcile AFTER —
 * this function is IO only, no store touch.
 */
export async function submitPick(
  input: SubmitPickInput,
): Promise<SubmitPickResult> {
  const { apiClient } = await import('@/api/client');
  const path = `/api/draft/v2/league/${encodeURIComponent(input.leagueId)}/pick`;
  const body = {
    team_id: input.teamId,
    player_id: input.playerId,
    round: input.roundNumber,
    pick_number: input.pickNumber,
  };
  // apiClient.post THROWS ApiError on non-2xx (see api/client.ts:188-193)
  // AND for timeout / network failures after retries are exhausted
  // (line 221). Successful 200 resolves with `{ data: <server body> }`.
  // See DR-2 investigation notes for the full contract.
  try {
    const response = await apiClient.post<{
      event_id?: string | number;
      seq?: string | number;
      pick_deadline?: string | null;
      was_duplicate?: boolean;
    }>(path, body, {
      headers: {
        'X-Idempotency-Key': input.attemptId,
        'X-Correlation-Id': input.attemptId,
      },
      timeoutMs: 8000,
    });

    // Hedge for both envelope shapes — same pattern as fetchDraftOrderMatrix.
    const payload =
      response.data ??
      (response as unknown as { event_id?: unknown; seq?: unknown });
    if (
      payload &&
      typeof payload === 'object' &&
      'event_id' in payload &&
      'seq' in payload
    ) {
      const p = payload as {
        event_id: string | number;
        seq: string | number;
        pick_deadline?: string | null;
        was_duplicate?: boolean;
      };
      return {
        ok: true,
        eventId: String(p.event_id),
        seq: Number(p.seq),
        pickDeadline: p.pick_deadline ?? null,
        wasDuplicate: p.was_duplicate === true,
      };
    }
    // 2xx but shape unexpected — treat as server_error (server
    // regression); safer than pretending we know the seq.
    return {
      ok: false,
      reason: 'server_error',
      message: HUMAN_COPY.server_error,
    };
  } catch (err) {
    // ApiError carries {status, data, message}; other errors are
    // treated as network_or_timeout (defensive fallback).
    const e = err as { status?: number; message?: string; name?: string };
    const statusCode = typeof e.status === 'number' ? e.status : undefined;
    const rawMessage = e.message ?? '';
    // status=0 in ApiError is apiClient's convention for
    // "network / retry-exhausted / no response" (see api/client.ts:212
    // and line 221's `new ApiError('Request failed after retries', 0)`).
    // Also treat AbortError / TimeoutError name-only errors the same.
    if (
      statusCode === 0 ||
      statusCode === undefined ||
      e.name === 'AbortError' ||
      e.name === 'TimeoutError' ||
      /timed?\s?out|network|abort|fetch|retry/i.test(rawMessage)
    ) {
      return {
        ok: false,
        reason: 'network_or_timeout',
        message: HUMAN_COPY.network_or_timeout,
      };
    }
    const reason = mapServerError(rawMessage, statusCode);
    return {
      ok: false,
      reason,
      message: HUMAN_COPY[reason],
      statusCode,
    };
  }
}
