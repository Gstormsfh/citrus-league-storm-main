import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { requestId } from 'hono/request-id';
import { leagueRoutes } from './routes/leagues';
import { playerRoutes } from './routes/players';
import { scoresRoutes } from './routes/scores';
import { seasonRoutes } from './routes/season';
import { matchupRoutes } from './routes/matchups';
import { draftRoutes } from './routes/draft';
import { draftsRoutes } from './routes/drafts';
import { draftV2Routes } from './routes/draftV2Sync';
import { draftV2StartRoutes } from './routes/draftV2Start';
import { draftV2EraRoutes } from './routes/draftV2Era';
import { draftV2PickRoutes } from './routes/draftV2Pick';
import { draftV2AuctionRoutes } from './routes/draftV2Auction';
import { draftV2OfflineRoutes } from './routes/draftV2Offline';
import { draftV2EventsRoutes } from './routes/draftV2Events';
import { rosterRoutes } from './routes/rosters';
import { tradeRoutes } from './routes/trades';
import { waiverRoutes } from './routes/waivers';
import { scheduleRoutes } from './routes/schedule';
import { notificationRoutes } from './routes/notifications';
import { stormyRoutes } from './routes/stormy';
import { adminRoutes } from './routes/admin';
// NOTE: draftAdmin routes (engine-ops admin) live on the engine's Hono
// server (server/src/draft/index.ts), NOT this API server's app, per
// chunk 11g.10 sub-step 10b Decision Log 2026-05-19. Admin endpoints
// manipulate engine-local in-memory state (LobbyRegistry, snapshot
// pipeline); they have no place in the API server's surface.
import { auctionRoutes } from './routes/auction';
import { keeperRoutes } from './routes/keepers';
import { playoffRoutes } from './routes/playoffs';
import { bestballRoutes } from './routes/bestball';
import { accountRoutes } from './routes/account';
import { publicRoutes } from './routes/public';
import { newsRoutes } from './routes/news';
import { draftKitRoutes } from './routes/draftKit';
import { demoMatchupRoutes } from './routes/demoMatchup';
import { poolRoutes } from './routes/pools';
import { nhlPlayoffsRoutes } from './routes/nhl-playoffs';
import { playoffPoolRoutes } from './routes/playoff-pools';
import { authRoutes } from './routes/auth';
import { scheduledRoutes } from './routes/scheduled';
import { standardRateLimit, strictRateLimit, authRateLimit, aiRateLimit } from './middleware/rateLimit';
import { requestContextMiddleware } from './middleware/requestContext';
import { metricsMiddleware, metrics } from './middleware/metrics';
import { cacheControlMiddleware } from './middleware/cacheControl';
import { AppError } from './lib/errors';
import { supabaseBreaker } from './lib/circuitBreaker';
import { logger } from '@citrus/shared';

export type Env = {
  Variables: {
    userId: string;
    userToken: string;
    requestId: string;
  };
};

const app = new Hono<Env>();

// ── CORS origins — environment-aware ─────────────────────────────────
// Staging origins are allowed from both environments because:
//   1. Same codebase runs on prod + staging — one allowlist keeps config simple.
//   2. Cross-environment requests are harmless anyway: different Supabase projects
//      mean different JWT signing secrets, so a staging-signed token cannot pass
//      the prod API's auth validation (and vice versa).
const isProduction = process.env.NODE_ENV === 'production';
const corsOrigins: string[] = [
  'https://citrusfantasysports.com',
  'https://www.citrusfantasysports.com',
  'https://citrus-fantasy-staging.web.app',
  'https://citrus-fantasy-staging.firebaseapp.com',
  // ── Native shell (2026-08-25, pre-TestFlight) ──────────────────────
  // The iOS Capacitor build is NOT served from any of the domains above.
  // WKWebView loads it from a custom scheme — capacitor://localhost by
  // default, which is what capacitor.config.json resolves to since it sets
  // no server.hostname or iosScheme — and every /api call from the app is
  // therefore cross-origin. Without these entries the TestFlight build
  // reaches the API and is refused by CORS on every request: no 404, no
  // useful error, just a dead app on device.
  //
  // This is the CORS half of the problem nativeApiOriginGuard.test.ts
  // solves the URL half of. That guard stops relative /api fetches, which
  // fixed the request TARGET; this fixes whether the server will answer.
  //
  // Custom schemes only. A page in a normal browser cannot claim an Origin
  // of capacitor:// or ionic://, so these do not widen the web surface.
  // Android's shell uses http(s)://localhost and is deliberately NOT added
  // here — that origin IS reachable from an ordinary local page, so it
  // should be a considered decision when Android ships, not a freebie now.
  'capacitor://localhost',
  'ionic://localhost',
];
if (!isProduction) {
  corsOrigins.push('http://localhost:8080', 'http://localhost:5173');
}

// ── Global middleware ─────────────────────────────────────────────────
app.use('*', requestId());
app.use('*', honoLogger());
app.use('*', secureHeaders());
app.use('*', cors({
  origin: corsOrigins,
  credentials: true,
  // NATIVE DRAFT OUTAGE (2026-09-01). The draft mutation routes require
  // X-Idempotency-Key (and accept X-Correlation-Id) — headers this list
  // did not allow. On the website that never mattered: same origin, no
  // preflight. The iOS shell is cross-origin (capacitor://localhost), so
  // every pick/auction submit preflighted, the preflight came back
  // WITHOUT these headers allowed, and WKWebView refused to send the
  // real POST. Cloud Run's log for the first live engine draft shows the
  // signature exactly: a stream of 204 OPTIONS and not one pick POST —
  // every human pick timed out client-side ("we couldn't confirm your
  // pick") and autopick took the slot. corsAllowHeaders.test.ts pins
  // every custom header the web client sends into this list.
  allowHeaders: ['Content-Type', 'Authorization', 'x-client-info', 'X-Idempotency-Key', 'X-Correlation-Id'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

// Structured request logging + metrics collection for observability
app.use('/api/*', requestContextMiddleware);
app.use('/api/*', metricsMiddleware);
// Cache-Control headers + ETag support for GET responses
app.use('/api/*', cacheControlMiddleware);

// Rate limiting — 300 req/min per IP for standard routes (LRU-bounded)
app.use('/api/*', standardRateLimit);
// Stricter limit on AI chat — 10 req/min per IP
app.use('/api/stormy/*', aiRateLimit);
// Strict brute-force protection on signup/login — 5 req/min per IP
// Applied per-path (not per-prefix) because /api/auth/* may grow to
// include non-mutating endpoints later; we explicitly protect the
// mutating ones here so the decision is traceable.
app.use('/api/auth/signup', authRateLimit);
// SWEEP (2026-08-15) — /check-method looks any email up via the
// service-role admin API and answers {exists, providers}: at the
// standard 600 req/min it is an account-enumeration oracle. Same
// 5 req/min brute-force ceiling as signup.
app.use('/api/auth/check-method', authRateLimit);

// ── Health check — no auth required ──────────────────────────────────
app.get('/api/health', async (c) => {
  const checks: Record<string, string> = {};
  let healthy = true;

  // Database connectivity check — use service role key for the probe because
  // PostgREST restricts the root /rest/v1/ endpoint for the anon role.
  // Falls back to anon key if service role is unavailable.
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    const healthKey = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
    if (SUPABASE_URL && healthKey) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
        method: 'HEAD',
        headers: { apikey: healthKey, Authorization: `Bearer ${healthKey}` },
        signal: AbortSignal.timeout(3000),
      });
      checks.database = res.ok ? 'ok' : 'degraded';
      if (!res.ok) healthy = false;
    } else {
      checks.database = 'unconfigured';
      healthy = false;
    }
  } catch {
    checks.database = 'unreachable';
    healthy = false;
  }

  checks.server = 'ok';
  checks.circuitBreaker = supabaseBreaker.currentState === 'CLOSED' ? 'ok' : supabaseBreaker.currentState.toLowerCase();
  if (supabaseBreaker.currentState !== 'CLOSED') healthy = false;

  return c.json({
    status: healthy ? 'ok' : 'degraded',
    service: 'citrus-api',
    version: process.env.npm_package_version || '1.0.0',
    uptime: Math.floor(process.uptime()),
    checks,
    timestamp: new Date().toISOString(),
  }, healthy ? 200 : 503);
});

// ── Auth diagnostic — verify token validation pipeline ──────────────
app.get('/api/health/auth-check', async (c) => {
  const authHeader = c.req.header('Authorization');
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  const result: Record<string, unknown> = {
    hasAuthHeader: !!authHeader,
    hasSupabaseUrl: !!SUPABASE_URL,
    hasAnonKey: !!SUPABASE_ANON_KEY,
    supabaseUrlPrefix: SUPABASE_URL ? SUPABASE_URL.substring(0, 30) + '...' : null,
    anonKeyPrefix: SUPABASE_ANON_KEY ? SUPABASE_ANON_KEY.substring(0, 20) + '...' : null,
  };

  if (authHeader?.startsWith('Bearer ') && SUPABASE_URL && SUPABASE_ANON_KEY) {
    const token = authHeader.slice(7);
    result.tokenPrefix = token.substring(0, 20) + '...';

    // Decode JWT to check expiry without verification
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      result.tokenExp = payload.exp;
      result.tokenIat = payload.iat;
      result.tokenExpDate = new Date(payload.exp * 1000).toISOString();
      result.tokenIssuer = payload.iss;
      result.serverTime = new Date().toISOString();
      result.isExpired = Date.now() >= payload.exp * 1000;
    } catch {
      result.tokenDecodeError = 'Failed to decode JWT payload';
    }

    // Try to validate with Supabase
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user }, error } = await sb.auth.getUser(token);
      result.getUserSuccess = !!user;
      result.getUserError = error ? { message: error.message, status: error.status, name: error.name } : null;
      result.userId = user?.id;
    } catch (err: unknown) {
      result.getUserException = err instanceof Error ? err.message : 'Unknown error';
    }
  }

  return c.json({ authDiagnostic: result }, 200);
});

// ── Metrics endpoint — supports JSON and Prometheus text format ──────
app.get('/api/metrics', (c) => {
  const accept = c.req.header('Accept') || '';

  // Prometheus scraping sends Accept: text/plain or application/openmetrics-text
  if (accept.includes('text/plain') || accept.includes('openmetrics-text')) {
    return c.text(metrics.toPrometheusText(), 200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
  }

  // Default: JSON for dashboards and health checks
  const snapshot = metrics.getSnapshot();
  return c.json({ ...snapshot, circuitBreaker: supabaseBreaker.stats, alerts: metrics.getAlerts() });
});

// ── Web Vitals receiver — fire-and-forget from frontend ─────────────
app.post('/api/vitals', async (c) => {
  // Accept vitals data silently — forward to logging/analytics pipeline
  try {
    const body = await c.req.json();
    if (body?.vitals && Array.isArray(body.vitals)) {
      for (const vital of body.vitals) {
        // Structured log line for vitals — parseable by Cloud Logging / Datadog
        if (process.env.NODE_ENV === 'production') {
          console.log(JSON.stringify({
            level: 'info',
            type: 'web_vital',
            name: vital.name,
            value: vital.value,
            rating: vital.rating,
            timestamp: vital.timestamp,
          }));
        }
      }
    }
  } catch {
    // Silent fail — vitals ingestion should never error
  }
  return c.json({ ok: true });
});

// ── API routes ───────────────────────────────────────────────────────
app.route('/api/leagues', leagueRoutes);
app.route('/api/players', playerRoutes);
app.route('/api/scores', scoresRoutes);
app.route('/api/season', seasonRoutes);
app.route('/api/matchups', matchupRoutes);
app.route('/api/draft', draftRoutes);
// Phase 4.5 chunk 11g.1 — discovery endpoint at /api/drafts/:draftId/server.
// Note the plural "drafts" — distinct from the v1/v2 /api/draft (singular)
// surface above. ADR-001 § Decision (discovery-as-function pattern from Day 1).
app.route('/api/drafts', draftsRoutes);
// Draft Engine v2 — three routers all share the /api/draft/v2 prefix.
// Hono merges them at lookup time. v1 above is unaffected.
// Spec: docs/DRAFT_ENGINE_V2_SPEC.md §7 (endpoints).
app.route('/api/draft/v2', draftV2Routes);        // §7.2 GET /sync
app.route('/api/draft/v2', draftV2PickRoutes);    // §7.3 POST /pick
app.route('/api/draft/v2', draftV2AuctionRoutes); // 2026-08-24 POST /nominate + /bid (auction launch)
app.route('/api/draft/v2', draftV2OfflineRoutes); // 2026-08-24 POST /offline-import (offline draft launch)
app.route('/api/draft/v2', draftV2EventsRoutes);  // §7.4 GET /events
app.route('/api/draft/v2', draftV2StartRoutes);   // T7 POST /league/:leagueId/start (F27 commissioner ignition)
app.route('/api/draft/v2', draftV2EraRoutes);     // E104 GET /league/:leagueId/era (V1-FENCE probe via API)
app.route('/api/rosters', rosterRoutes);
app.route('/api/trades', tradeRoutes);
app.route('/api/waivers', waiverRoutes);
app.route('/api/schedule', scheduleRoutes);
app.route('/api/notifications', notificationRoutes);
app.route('/api/stormy', stormyRoutes);
app.route('/api/admin', adminRoutes);
// Engine-ops admin routes (/api/admin/engine/*) live on the engine's
// Hono server, not here. See chunk 11g.10 sub-step 10b commit notes.
app.route('/api/auction', auctionRoutes);
app.route('/api/keepers', keeperRoutes);
app.route('/api/playoffs', playoffRoutes);
app.route('/api/bestball', bestballRoutes);
app.route('/api/account', accountRoutes);
app.route('/api/public', publicRoutes);
app.route('/api/news', newsRoutes);
// Draft Kit — the paid analytics section. Every route is authed and the
// entitlement gate lives in DraftKitService, ahead of payload assembly.
app.route('/api/draft-kit', draftKitRoutes);
// Chunk 11g.9 (2026-08-24): guest Matchup payload, ported off the
// retired `demo-matchup-cache` Edge Function. Public + unauthenticated
// by design (no authMiddleware on the route), still covered by the
// /api/* standardRateLimit.
app.route('/api/demo', demoMatchupRoutes);
app.route('/api/pools', poolRoutes);
app.route('/api/nhl-playoffs', nhlPlayoffsRoutes);
app.route('/api/playoff-pools', playoffPoolRoutes);
app.route('/api/auth', authRoutes);
// Scheduled/cron endpoints — auth is X-Scheduled-Secret shared-secret
// header, not user JWT. Mounted last so no other router shadows it.
app.route('/api/scheduled', scheduledRoutes);

// ── 404 handler ──────────────────────────────────────────────────────
app.notFound((c) => {
  return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' }, path: c.req.path }, 404);
});

// ── Global error handler ─────────────────────────────────────────────
app.onError((err, c) => {
  const reqId = c.get('requestId');
  logger.error(`[API Error] [${reqId}] ${c.req.method} ${c.req.path}:`, err.message);
  if (err.stack) {
    logger.error(err.stack);
  }

  // If it's an AppError, use its status and code
  if (err instanceof AppError) {
    return c.json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
      requestId: reqId,
    }, err.status as any);
  }

  return c.json({
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
    },
    requestId: reqId,
  }, 500);
});

export { app };
