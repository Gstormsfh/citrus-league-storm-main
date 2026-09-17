/**
 * DRAFT CANARY (2026-09-16).
 *
 * The one check nothing else makes: does a token this API signs open a
 * socket on the draft engine and come back with a snapshot? That is the
 * whole join path a manager takes after discovery, and it is the path that
 * was dead for two days while every alert stayed green (the API had no
 * SUPABASE_JWT_SECRET; the engine, healthy, never saw a valid token).
 *
 * Layers, and what each one cannot see:
 *   - engine watchdog (LISTEN/NOTIFY self-test): engine internals only.
 *   - edge uptime checks (infra/gcp/monitoring/apply-uptime.sh): the API
 *     can sign a token; the engine answers HTTP. Not that the engine
 *     ACCEPTS the API's token (a rotated secret the engine has not
 *     re-read, a wrong Secret Manager version, an issuer bug).
 *   - this canary: signs a token exactly as discovery does, opens
 *     wss://DRAFT_WS_HOST:DRAFT_WS_PORT/ws/draft/<canary league>, and
 *     waits for the engine's first `snapshot` frame. Then closes.
 *
 * It runs inside the API process (Cloud Run, min-instances=1, no CPU
 * throttling) on a timer, and reports through structuredLogger as
 * `draft_canary.ok` / `draft_canary.failed`. Alerting is on the ABSENCE
 * of `ok` (a dead timer, a stuck instance and a broken engine all look
 * the same from outside) plus on any `failed`; see
 * infra/gcp/monitoring/apply-uptime.sh. Silence is not health.
 *
 * Requirements (all env; the canary is inert without them, and says so
 * once at startup):
 *   DRAFT_CANARY_LEAGUE_ID  a real league in `draft_status='in_progress'`
 *                           with `draft_state='paused'` and at least one
 *                           row in `draft_order`, owned by the canary user.
 *                           Paused: the engine holds the lobby resident,
 *                           runs no clock, autopicks nothing, and the
 *                           freeze gate ignores it once its last pick is
 *                           older than the live window. Name it so nobody
 *                           touches it: "CANARY: do not touch".
 *   DRAFT_CANARY_USER_ID    the canary user's auth uid (a member of that
 *                           league, so the pre-flight script can also run
 *                           the real discovery route with its login).
 *   DRAFT_WS_HOST/PORT      same values discovery hands to browsers.
 *   SUPABASE_JWT_SECRET     same secret discovery signs with.
 *
 * Side effects on the engine: a lobby-scoped presence join/leave. No
 * events, no picks, no `draft_events` rows, so it cannot trip the deploy
 * freeze gate and cannot appear in a scorecard as activity.
 */

import { WebSocket } from 'undici';
import { structuredLogger } from '@citrus/shared';
import { issueDraftToken } from '../lib/draftToken';

export const DRAFT_CANARY_DEFAULT_INTERVAL_MS = 5 * 60_000;
export const DRAFT_CANARY_TIMEOUT_MS = 10_000;

export type DraftCanaryResult =
  | { ok: true; latencyMs: number; firstMessageType: string }
  | {
      ok: false;
      reason:
        | 'token_issue_failed'
        | 'socket_error'
        | 'closed_before_snapshot'
        | 'unexpected_first_message'
        | 'timeout';
      latencyMs: number;
      closeCode?: number;
      closeReason?: string;
      detail?: string;
    };

export interface DraftCanaryConfig {
  leagueId: string;
  userId: string;
  wsHost: string;
  wsPort: number;
  timeoutMs: number;
}

/** Minimal socket shape so tests can drive the canary without a network. */
export interface CanarySocket {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  close(code?: number, reason?: string): void;
}

export interface DraftCanaryDeps {
  issueToken: (p: { userId: string; draftId: string; leagueId: string }) => Promise<string>;
  openSocket: (url: string, subprotocol: string) => CanarySocket;
  now: () => number;
}

export function canaryConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DraftCanaryConfig | null {
  const leagueId = env.DRAFT_CANARY_LEAGUE_ID;
  const userId = env.DRAFT_CANARY_USER_ID;
  const wsHost = env.DRAFT_WS_HOST;
  const wsPort = parseInt(env.DRAFT_WS_PORT || '', 10);
  if (!leagueId || !userId || !wsHost || !Number.isFinite(wsPort)) return null;
  if (!/^[0-9a-f-]{36}$/i.test(leagueId) || !/^[0-9a-f-]{36}$/i.test(userId)) return null;
  return { leagueId, userId, wsHost, wsPort, timeoutMs: DRAFT_CANARY_TIMEOUT_MS };
}

export function canaryWsUrl(cfg: Pick<DraftCanaryConfig, 'wsHost' | 'wsPort' | 'leagueId'>): string {
  // Browsers on an https page always use wss:; so does the canary. There
  // is no localhost branch on purpose: a canary that can pass against a
  // dev engine says nothing about production.
  return `wss://${cfg.wsHost}:${cfg.wsPort}/ws/draft/${cfg.leagueId}`;
}

/**
 * One canary round trip. Never throws; every outcome is a result so the
 * scheduler can log it and move on.
 */
export async function runDraftCanaryOnce(
  cfg: DraftCanaryConfig,
  deps: DraftCanaryDeps,
): Promise<DraftCanaryResult> {
  const started = deps.now();
  const elapsed = () => deps.now() - started;

  let token: string;
  try {
    token = await deps.issueToken({ userId: cfg.userId, draftId: cfg.leagueId, leagueId: cfg.leagueId });
  } catch (err) {
    return {
      ok: false,
      reason: 'token_issue_failed',
      latencyMs: elapsed(),
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  return new Promise<DraftCanaryResult>((resolve) => {
    let settled = false;
    let socket: CanarySocket | null = null;
    const finish = (result: DraftCanaryResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close(1000, 'canary_done');
      } catch {
        /* the socket may already be gone; nothing to do */
      }
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ ok: false, reason: 'timeout', latencyMs: elapsed() }),
      cfg.timeoutMs,
    );

    try {
      socket = deps.openSocket(canaryWsUrl(cfg), token);
    } catch (err) {
      finish({
        ok: false,
        reason: 'socket_error',
        latencyMs: elapsed(),
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    socket.onerror = (ev) => {
      const detail =
        ev && typeof ev === 'object' && 'message' in ev
          ? String((ev as { message?: unknown }).message)
          : undefined;
      finish({ ok: false, reason: 'socket_error', latencyMs: elapsed(), detail });
    };
    socket.onclose = (ev) => {
      finish({
        ok: false,
        reason: 'closed_before_snapshot',
        latencyMs: elapsed(),
        closeCode: ev.code,
        closeReason: ev.reason,
      });
    };
    socket.onmessage = (ev) => {
      let type = 'unparseable';
      try {
        const parsed = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)) as {
          type?: unknown;
        };
        if (typeof parsed.type === 'string') type = parsed.type;
      } catch {
        /* leave 'unparseable' */
      }
      if (type === 'snapshot') {
        finish({ ok: true, latencyMs: elapsed(), firstMessageType: type });
      } else {
        finish({ ok: false, reason: 'unexpected_first_message', latencyMs: elapsed(), detail: type });
      }
    };
  });
}

export function productionDeps(): DraftCanaryDeps {
  return {
    issueToken: issueDraftToken,
    openSocket: (url, subprotocol) => new WebSocket(url, [subprotocol]) as unknown as CanarySocket,
    now: () => Date.now(),
  };
}

export function logCanaryResult(cfg: DraftCanaryConfig, result: DraftCanaryResult): void {
  const base = {
    leagueId: cfg.leagueId,
    wsHost: cfg.wsHost,
    wsPort: cfg.wsPort,
    latencyMs: result.latencyMs,
  };
  if (result.ok === true) {
    structuredLogger.info('draft_canary.ok', { ...base, firstMessageType: result.firstMessageType });
  } else {
    const { reason, closeCode, closeReason, detail } = result;
    structuredLogger.error('draft_canary.failed', { ...base, reason, closeCode, closeReason, detail });
  }
}

/**
 * Start the timer. Returns a stop function, or null when the canary is not
 * configured (logged once so an unconfigured production is visible in the
 * boot log rather than silently canary-less).
 */
export function startDraftCanary(opts: {
  intervalMs?: number;
  initialDelayMs?: number;
  deps?: DraftCanaryDeps;
  env?: NodeJS.ProcessEnv;
} = {}): (() => void) | null {
  const cfg = canaryConfigFromEnv(opts.env ?? process.env);
  if (!cfg) {
    structuredLogger.warn('draft_canary.disabled', {
      reason: 'DRAFT_CANARY_LEAGUE_ID / DRAFT_CANARY_USER_ID / DRAFT_WS_HOST / DRAFT_WS_PORT not all set',
    });
    return null;
  }
  const deps = opts.deps ?? productionDeps();
  const intervalMs = opts.intervalMs ?? DRAFT_CANARY_DEFAULT_INTERVAL_MS;
  let inFlight = false;
  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      logCanaryResult(cfg, await runDraftCanaryOnce(cfg, deps));
    } finally {
      inFlight = false;
    }
  };
  structuredLogger.info('draft_canary.started', { leagueId: cfg.leagueId, intervalMs, url: canaryWsUrl(cfg) });
  const first = setTimeout(() => void tick(), opts.initialDelayMs ?? 30_000);
  const timer = setInterval(() => void tick(), intervalMs);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
