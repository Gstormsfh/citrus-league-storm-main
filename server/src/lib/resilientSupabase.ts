import { logger } from '@citrus/shared';
import { CircuitOpenError, supabaseBreaker } from './circuitBreaker';

/**
 * Resilience wrapper for critical Supabase write paths (e.g. draft picks).
 *
 * Composes two patterns the April 10 postmortem promised but never wired up:
 *   1. Circuit breaker — many consecutive transient failures trip the circuit
 *      (supabaseBreaker), fail-fast until Supabase recovers.
 *   2. Retry with exponential backoff — single transient blips are invisible
 *      to the caller.
 *
 * Shape matches the Supabase query result: `{ data, error }`. Permanent errors
 * (domain rules like "already drafted", 4xx validation, auth) pass through
 * unchanged without retry — retrying them just wastes time. Transient errors
 * (429 / 5xx / network) are retried with 100ms → 300ms → 700ms backoff.
 *
 * Scope: intentionally narrow. Use on hot-path writes that must not fail on a
 * single Supabase blip (draft picks, matchup scoring). Do NOT wrap reads —
 * those already have UI retry via React Query, and wrapping them silently
 * hides real outages.
 */

interface SupabaseLikeResult<T> {
  data: T | null;
  error: SupabaseLikeError | null;
}

interface SupabaseLikeError {
  message?: string;
  code?: string;
  status?: number;
  details?: string;
}

interface WithResilienceOptions {
  /** Max number of retries on transient failure (default: 2 — total 3 attempts). */
  maxRetries?: number;
  /** Human label for logs. */
  label?: string;
}

// HTTP statuses we consider transient
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

// Node / fetch error codes we consider transient
const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNREFUSED',
  'EPIPE',
  'AbortError',
  '57P03', // Postgres: cannot connect, admin_shutdown
  '53300', // Postgres: too_many_connections
]);

// Message substrings that indicate transient conditions
const TRANSIENT_MESSAGE_PATTERNS =
  /(fetch failed|network|timeout|unavailable|temporarily|connection reset|socket hang up)/i;

/**
 * Determine whether an error (object, Error, or Supabase error shape) is
 * transient and worth retrying. Returns false for anything ambiguous so we
 * never retry domain errors (already-drafted, duplicate pick, auth).
 */
export function isTransientError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;

  const e = err as Record<string, unknown>;
  const status = typeof e.status === 'number' ? e.status : undefined;
  const code = typeof e.code === 'string' ? e.code : undefined;
  const message = typeof e.message === 'string' ? e.message : '';

  if (status !== undefined && TRANSIENT_STATUSES.has(status)) return true;
  if (code && TRANSIENT_CODES.has(code)) return true;
  if (message && TRANSIENT_MESSAGE_PATTERNS.test(message)) return true;

  return false;
}

const DEFAULT_BACKOFFS_MS = [100, 300, 700];

/** Test hook: swap the delay function to make tests fast & deterministic. */
let sleepFn: (ms: number) => Promise<void> = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function __setSleepForTests(fn: (ms: number) => Promise<void>): void {
  sleepFn = fn;
}

export function __resetSleepForTests(): void {
  sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a Supabase-shaped async call (`() => Promise<{data, error}>`) with
 * circuit breaker + retry-with-backoff protection.
 *
 * Returns a Supabase-shaped `{data, error}` result so callers do not need
 * to change their error-handling code paths.
 *
 * If the breaker is OPEN, returns a synthetic `{data: null, error: {message}}`
 * immediately without invoking the callback.
 *
 * Never throws for transient failures — those exhaust retries and are
 * returned as an error. Domain errors return unchanged. Only re-throws for
 * genuinely unexpected exceptions the caller didn't expect (e.g. programmer
 * bugs, non-Supabase errors).
 */
export async function withResilience<T>(
  // Accept PromiseLike so Supabase's PostgrestFilterBuilder (a Thenable,
  // not a full Promise) can be passed directly without an explicit async wrapper.
  fn: () => PromiseLike<SupabaseLikeResult<T>>,
  options: WithResilienceOptions = {},
): Promise<SupabaseLikeResult<T>> {
  const maxRetries = options.maxRetries ?? 2;
  const label = options.label;

  try {
    return await supabaseBreaker.execute<SupabaseLikeResult<T>>(async () => {
      let last: SupabaseLikeResult<T> = { data: null, error: null };

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          last = await fn();
        } catch (thrown) {
          // Network / fetch-level errors bubble out of Supabase as throws.
          if (!isTransientError(thrown)) {
            // Permanent exception — don't count against the breaker as a
            // transient failure; re-throw so caller sees the real stack.
            throw thrown;
          }
          last = { data: null, error: thrown as SupabaseLikeError };
        }

        if (!last.error || !isTransientError(last.error)) {
          // Success, or a permanent (domain / validation) error.
          return last;
        }

        if (attempt < maxRetries) {
          const delay = DEFAULT_BACKOFFS_MS[attempt] ?? 700;
          if (label) {
            logger.warn(
              `[resilient] ${label}: transient failure, retry ${attempt + 1}/${maxRetries} in ${delay}ms`,
              { error: last.error.message },
            );
          }
          await sleepFn(delay);
        }
      }

      // Retries exhausted. Throw inside the breaker so it counts as a
      // failure (circuit can trip after enough exhaustions), but convert
      // back to {data, error} for the caller below.
      const exhaustedMsg = last.error?.message || 'Supabase transient failure (retries exhausted)';
      const exhausted = new Error(exhaustedMsg);
      (exhausted as unknown as { __transientExhausted: true }).__transientExhausted = true;
      throw exhausted;
    });
  } catch (err) {
    if (err instanceof CircuitOpenError) {
      return {
        data: null,
        error: {
          message: 'Service temporarily unavailable. Please retry in a moment.',
          code: 'CIRCUIT_OPEN',
        },
      };
    }

    // Transient-exhausted: convert the throw back to a {data, error} result.
    if (err && typeof err === 'object' && '__transientExhausted' in err) {
      return {
        data: null,
        error: {
          message: err instanceof Error ? err.message : String(err),
          code: 'TRANSIENT_EXHAUSTED',
        },
      };
    }

    // Anything else is a real programmer error. Re-throw.
    throw err;
  }
}
