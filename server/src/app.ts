import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { requestId } from 'hono/request-id';
import { leagueRoutes } from './routes/leagues';
import { playerRoutes } from './routes/players';
import { matchupRoutes } from './routes/matchups';
import { draftRoutes } from './routes/draft';
import { rosterRoutes } from './routes/rosters';
import { tradeRoutes } from './routes/trades';
import { waiverRoutes } from './routes/waivers';
import { scheduleRoutes } from './routes/schedule';
import { notificationRoutes } from './routes/notifications';
import { stormyRoutes } from './routes/stormy';
import { adminRoutes } from './routes/admin';
import { auctionRoutes } from './routes/auction';
import { keeperRoutes } from './routes/keepers';
import { playoffRoutes } from './routes/playoffs';
import { bestballRoutes } from './routes/bestball';
import { accountRoutes } from './routes/account';
import { standardRateLimit, strictRateLimit } from './middleware/rateLimit';
import { requestContextMiddleware } from './middleware/requestContext';
import { AppError } from './lib/errors';
import { supabaseBreaker } from './lib/circuitBreaker';

export type Env = {
  Variables: {
    userId: string;
    userToken: string;
    requestId: string;
  };
};

const app = new Hono<Env>();

// ── CORS origins — environment-aware ─────────────────────────────────
const isProduction = process.env.NODE_ENV === 'production';
const corsOrigins: string[] = [
  'https://citrusfantasysports.com',
  'https://www.citrusfantasysports.com',
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
  allowHeaders: ['Content-Type', 'Authorization', 'x-client-info'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

// Structured request logging for observability (production JSON logs)
app.use('/api/*', requestContextMiddleware);

// Rate limiting — 300 req/min per IP for standard routes (LRU-bounded)
app.use('/api/*', standardRateLimit);
// Stricter limit on AI chat — 10 req/min per IP
app.use('/api/stormy/*', strictRateLimit);

// ── Health check — no auth required ──────────────────────────────────
app.get('/api/health', async (c) => {
  const checks: Record<string, string> = {};
  let healthy = true;

  // Database connectivity check
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
        method: 'HEAD',
        headers: { apikey: SUPABASE_ANON_KEY },
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

// ── API routes ───────────────────────────────────────────────────────
app.route('/api/leagues', leagueRoutes);
app.route('/api/players', playerRoutes);
app.route('/api/matchups', matchupRoutes);
app.route('/api/draft', draftRoutes);
app.route('/api/rosters', rosterRoutes);
app.route('/api/trades', tradeRoutes);
app.route('/api/waivers', waiverRoutes);
app.route('/api/schedule', scheduleRoutes);
app.route('/api/notifications', notificationRoutes);
app.route('/api/stormy', stormyRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/auction', auctionRoutes);
app.route('/api/keepers', keeperRoutes);
app.route('/api/playoffs', playoffRoutes);
app.route('/api/bestball', bestballRoutes);
app.route('/api/account', accountRoutes);

// ── 404 handler ──────────────────────────────────────────────────────
app.notFound((c) => {
  return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' }, path: c.req.path }, 404);
});

// ── Global error handler ─────────────────────────────────────────────
app.onError((err, c) => {
  const reqId = c.get('requestId');
  // Note: console.error is acceptable here since this is the last-resort global
  // error handler. The logger from @citrus/shared may not be initialized yet
  // if the error occurs during startup.
  console.error(`[API Error] [${reqId}] ${c.req.method} ${c.req.path}:`, err.message);
  if (process.env.NODE_ENV === 'development') {
    console.error(err.stack);
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
