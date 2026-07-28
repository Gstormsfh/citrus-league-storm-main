// Phase 4.5 chunk 11g.5b — toast notification helpers for the
// chunk-11g.5a state machine + chunk-11g.5b UX layer.
//
// Wraps `sonner` with domain-specific helpers:
//   - `notifyPickRejected(reason)` — maps server-side rejection
//     reasons to user-facing messages
//   - `notifyPresenceJoined(userId)` / `notifyPresenceLeft(userId)`
//     — throttled at 5s per the brief's draft-start-spike rationale
//   - `notifyConnectionFatal(reason, message)` — persistent toast
//     tied to fatal state
//
// Sonner is the existing app-wide toast lib (see App.tsx Toaster
// rendering). This module is a thin domain wrapper — the
// rejection-reason → user-message mapping lives in one place so
// future reason additions update the UX consistently.

import { toast } from 'sonner';

// ── Rejection reason → user message ────────────────────────────────

/**
 * Mirrors the typed rejection reasons from
 * `server/src/draft/types.ts` `DraftActionResult`. Kept as a type
 * literal here (not imported from server) because the server type
 * may evolve faster than the client UX strings; the explicit
 * mapping below catches new reasons via TypeScript exhaustiveness.
 */
export type DraftActionRejectionReason =
  | 'not_yet_implemented_chunk_11g6'
  | 'wrong_format_for_action'
  | 'internal_error'
  | 'not_on_clock'
  | 'player_taken'
  | 'pick_out_of_order'
  | 'idempotency_conflict'
  | 'unauthorized'
  | 'invalid_state'
  | 'invalid_payload';

const REJECTION_MESSAGES: Record<DraftActionRejectionReason, string | null> = {
  not_on_clock: 'Someone else picked just before you. Your pick was reverted.',
  player_taken: 'That player was just taken. Try another.',
  pick_out_of_order: 'Pick number didn’t match — try again.',
  unauthorized: 'You’re not authorized to pick for this team.',
  invalid_state: 'The draft is paused or completed. Picks aren’t allowed right now.',
  idempotency_conflict:
    'Duplicate action detected — your previous attempt may have succeeded.',
  internal_error: 'Something went wrong on our end. Please try again.',
  invalid_payload: 'That pick was invalid. Please try again.',
  // Developer / forward-compat reasons that should never reach the
  // user — silent log path. `null` signals "do not show a toast".
  not_yet_implemented_chunk_11g6: null,
  wrong_format_for_action: null,
};

/**
 * Show a user-facing toast for a server-side pick rejection. Returns
 * the rendered message (or `null` if suppressed) for testing.
 */
export function notifyPickRejected(reason: DraftActionRejectionReason): string | null {
  const message = REJECTION_MESSAGES[reason];
  if (message === null || message === undefined) {
    return null;
  }
  toast.error(message);
  return message;
}

// ── Presence (throttled) ───────────────────────────────────────────

/**
 * 5-second throttle window. Rationale (per chunk 11g.5b brief):
 *
 * 5s window absorbs the draft-start spike when 12 users connect
 * simultaneously and would otherwise produce 12 toasts in rapid
 * succession. Window is small enough that mid-draft join/leave
 * events still feel responsive (a single user joining at minute 47
 * produces a toast within ~5s of their actual connection).
 *
 * Implementation: throttle (not aggregate). The first presence
 * event in a 5s window fires a toast; subsequent presence events
 * within the window are silently dropped. Aggregate-batching
 * ("3 users joined") is a future polish if user feedback warrants.
 */
export const PRESENCE_TOAST_THROTTLE_MS = 5000;

let lastPresenceToastAt = 0;

/**
 * Throttled "user joined" toast.
 */
export function notifyPresenceJoined(userId: string): boolean {
  const now = Date.now();
  if (now - lastPresenceToastAt < PRESENCE_TOAST_THROTTLE_MS) {
    return false;
  }
  lastPresenceToastAt = now;
  toast(`${truncateId(userId)} joined the draft`);
  return true;
}

/**
 * Throttled "user left" toast.
 */
export function notifyPresenceLeft(userId: string): boolean {
  const now = Date.now();
  if (now - lastPresenceToastAt < PRESENCE_TOAST_THROTTLE_MS) {
    return false;
  }
  lastPresenceToastAt = now;
  toast(`${truncateId(userId)} left the draft`);
  return true;
}

/**
 * Reset the throttle clock — for tests. Production callers don't
 * need this; the throttle is naturally bounded by real time.
 */
export function _resetPresenceThrottleForTests(): void {
  lastPresenceToastAt = 0;
}

// ── Connection fatal ───────────────────────────────────────────────

/**
 * Persistent toast for fatal connection states. Distinct from the
 * banner: the banner is the primary UX surface; the toast is a
 * secondary confirmation that the user has read / dismissed the
 * banner state.
 */
export function notifyConnectionFatal(
  reason:
    | 'auth_failure'
    | 'invalid_lobby'
    | 'permanent_server_error'
    | 'draft_not_initialized',
  message: string,
): void {
  const titles: Record<typeof reason, string> = {
    auth_failure: 'Authorization expired',
    invalid_lobby: 'Draft unavailable',
    permanent_server_error: 'Connection error',
    // Chunk 11g.10 sub-step 10c-2 gate (b) — distinct banner text
    // per the architect's product ruling. Do NOT collapse into a
    // generic "Draft unavailable"; the commissioner-just-finished
    // recovery flow is different from the lobby-gone recovery flow.
    draft_not_initialized: "This draft hasn't been set up yet",
  };
  toast.error(titles[reason], {
    description: message,
    duration: Infinity, // persistent; user dismisses
  });
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * UUIDs are noisy in toasts. Truncate to first 8 chars for display.
 * Production may swap this for a username lookup once chunk 11g.5b's
 * UX feedback comes in; for now the short ID is acceptable.
 */
function truncateId(userId: string): string {
  if (userId.length <= 8) return userId;
  return `${userId.slice(0, 8)}…`;
}
