// Phase 4.5 chunk 11g.7 sub-step 7a — structured logging utility for
// the draft engine.
//
// **Architectural separation from `logger.ts`**: the legacy `Logger`
// is a variadic free-text emitter (kept for non-engine code that
// hasn't migrated). This `StructuredLogger` is the canonical
// engine-side log API: every emit has a discriminator `event` string
// + a typed context object. Output is single-line JSON to stdout
// designed for direct ingestion by the GCP Cloud Logging Agent
// (Ops Agent / Fluent Bit) running on the GCE deploy target.
//
// **GCP severity-string mapping**: GCP Logging Agent's severity
// auto-parser requires canonical names DEBUG|INFO|NOTICE|WARNING|
// ERROR|CRITICAL|ALERT|EMERGENCY. Internal API uses `warn` for
// ergonomics; on-wire JSON outputs `WARNING` for compatibility.
// Future cloud platform changes (e.g., AWS CloudWatch) would need
// similar mapping.
//
// **PII policy** (Decision Log 2026-05-07): auction state is public
// to all draft participants; logged identifiers are opaque UUIDs;
// no display names, email addresses, auth tokens, or free-text
// user input are logged today. If future work adds any of those,
// redaction policy is revisited at that point.
//
// **No sampling primitive in 7a**: peak event rate is well below
// the threshold where sampling matters. Sampling lands in chunk
// 11g.11 load-test if real need surfaces.
//
// See `docs/PHASE_4_5_PROJECT_PLAN.md` Decision Log (2026-05-07)
// for the full architectural rationale.

/**
 * Severity levels that map to GCP Cloud Logging's canonical names
 * on the wire. Internal API uses lowercase `warn` for ergonomics
 * but the on-wire JSON `severity` field outputs `WARNING` because
 * that is what the agent's auto-parser requires.
 */
export type LogSeverity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

/**
 * Standard cross-cutting context fields that every engine log
 * emit MAY include. Action-specific fields are merged in via the
 * arbitrary `Record<string, unknown>` extension. Field names
 * `correlationId`, `leagueId`, `lobbyId`, `userId`, `teamId` are
 * the canonical engine-side keys; alert policies query them
 * directly.
 */
export interface LogContext {
  correlationId?: string;
  leagueId?: string;
  lobbyId?: string;
  userId?: string;
  teamId?: string;
  [key: string]: unknown;
}

/**
 * Structured logger interface. Every emit has a discriminator
 * `event` string (e.g., `'lobby.constructed'`, `'auction.bid.placed'`)
 * + a typed context object. The `error` method additionally
 * accepts an `err: unknown` third arg whose `message` / `stack` /
 * `name` are extracted into the JSON payload (handles both `Error`
 * instances and unknown thrown values).
 */
export interface StructuredLogger {
  debug(event: string, context?: LogContext): void;
  info(event: string, context?: LogContext): void;
  warn(event: string, context?: LogContext): void;
  error(event: string, context?: LogContext, err?: unknown): void;
}

/**
 * Final on-wire JSON payload shape. GCP Cloud Logging Agent
 * recognizes the `severity` and `time` keys natively; the
 * `message` field becomes the human-readable summary in the
 * Cloud Logging UI. All other keys flow through as
 * `jsonPayload.<key>` and are queryable via Cloud Logging filters.
 */
interface StructuredLogPayload {
  severity: LogSeverity;
  time: string;
  event: string;
  message?: string;
  correlationId?: string;
  leagueId?: string;
  lobbyId?: string;
  userId?: string;
  teamId?: string;
  err?: { name?: string; message: string; stack?: string };
  [key: string]: unknown;
}

const noop = (_event: string, _context?: LogContext, _err?: unknown): void => {};

/**
 * Default no-op logger singleton. Imported by engine modules at
 * the top level; activated in the engine entry point via
 * `Object.assign(structuredLogger, createConsoleStructuredLogger())`.
 * The default-silent shape mirrors the legacy `logger.ts`
 * convention.
 */
export const structuredLogger: StructuredLogger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
};

/**
 * Severity ordering for `LOG_LEVEL` env-based filtering.
 * Numerically ascending = more verbose; SILENT short-circuits all
 * emits. A logger created with level `'INFO'` emits INFO/WARNING/
 * ERROR but suppresses DEBUG.
 */
const SEVERITY_ORDER: Record<LogSeverity, number> = {
  DEBUG: 10,
  INFO: 20,
  WARNING: 30,
  ERROR: 40,
};

/**
 * Resolve the active log level from the `LOG_LEVEL` env var.
 * Accepted values: `SILENT|DEBUG|INFO|WARNING|WARN|ERROR` (`WARN`
 * is normalized to `WARNING` for ergonomics — both the env input
 * and the canonical output use the GCP names).
 *
 * Defaults: `INFO` if unset; `SILENT` short-circuits all emits
 * (used by tests via the vitest setup file to keep output clean).
 */
function resolveLogLevel(): LogSeverity | 'SILENT' {
  const raw = (
    typeof process !== 'undefined' && process.env?.LOG_LEVEL
      ? process.env.LOG_LEVEL
      : 'INFO'
  ).toUpperCase();
  if (raw === 'SILENT') return 'SILENT';
  if (raw === 'DEBUG') return 'DEBUG';
  if (raw === 'INFO') return 'INFO';
  if (raw === 'WARN' || raw === 'WARNING') return 'WARNING';
  if (raw === 'ERROR') return 'ERROR';
  // Unknown value — treat as INFO (default permissive).
  return 'INFO';
}

/**
 * Extract `name`/`message`/`stack` from a thrown value into the
 * on-wire `err` field. Handles `Error` instances and unknown
 * thrown values (strings, plain objects). Truncates `stack` to
 * 2 KB to bound log line size.
 */
function serializeError(err: unknown): StructuredLogPayload['err'] {
  if (err instanceof Error) {
    const stack = err.stack;
    return {
      name: err.name,
      message: err.message,
      ...(stack !== undefined ? { stack: stack.slice(0, 2048) } : {}),
    };
  }
  return { message: String(err) };
}

/**
 * Build the on-wire JSON payload from inputs. Standardized
 * top-level fields (`correlationId`, `leagueId`, etc.) are
 * preserved; arbitrary `LogContext` extensions flow through.
 */
function buildPayload(
  severity: LogSeverity,
  event: string,
  context: LogContext | undefined,
  err: unknown,
): StructuredLogPayload {
  const ctx = context ?? {};
  const payload: StructuredLogPayload = {
    severity,
    time: new Date().toISOString(),
    event,
    ...ctx,
  };
  // Normalize: if context provided a `message`, preserve it; else
  // omit. (Some emits carry a human summary; most do not — the
  // event discriminator is the primary identifier.)
  if (err !== undefined) {
    payload.err = serializeError(err);
  }
  return payload;
}

/**
 * Create a structured logger that writes single-line JSON to
 * stdout (info/debug) and stderr (warn/error). Each call:
 *
 *   1. Reads `LOG_LEVEL` at logger construction time. Restart the
 *      process to change the active level.
 *   2. Filters emits below the active level (e.g., `DEBUG` calls
 *      are silently dropped under `LOG_LEVEL=INFO`).
 *   3. Builds the JSON payload with `severity` (GCP-canonical
 *      name) + `time` (ISO 8601) + `event` + cross-cutting
 *      context + arbitrary extensions + optional `err`.
 *   4. Emits via `console.log` (info/debug) or `console.error`
 *      (warn/error). Cloud Logging Agent on GCE captures both
 *      streams and parses the JSON.
 *
 * The internal `console.*` use here is the ONLY permitted
 * `console.*` call site for engine-bound logging. Engine code
 * MUST go through this logger; the vitest source-scan test
 * enforces that ban.
 */
export function createConsoleStructuredLogger(): StructuredLogger {
  const activeLevel = resolveLogLevel();
  const allow = (severity: LogSeverity): boolean => {
    if (activeLevel === 'SILENT') return false;
    return SEVERITY_ORDER[severity] >= SEVERITY_ORDER[activeLevel];
  };

  return {
    debug(event: string, context?: LogContext): void {
      if (!allow('DEBUG')) return;
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(buildPayload('DEBUG', event, context, undefined)));
    },
    info(event: string, context?: LogContext): void {
      if (!allow('INFO')) return;
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(buildPayload('INFO', event, context, undefined)));
    },
    warn(event: string, context?: LogContext): void {
      if (!allow('WARNING')) return;
      // eslint-disable-next-line no-console
      console.error(JSON.stringify(buildPayload('WARNING', event, context, undefined)));
    },
    error(event: string, context?: LogContext, err?: unknown): void {
      if (!allow('ERROR')) return;
      // eslint-disable-next-line no-console
      console.error(JSON.stringify(buildPayload('ERROR', event, context, err)));
    },
  };
}
