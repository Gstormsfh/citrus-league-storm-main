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
import { standardRateLimit, strictRateLimit } from './middleware/rateLimit';

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

// Rate limiting — 100 req/min per IP for standard routes
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

// ── 404 handler ──────────────────────────────────────────────────────
app.notFound((c) => {
  return c.json({ error: 'Not found', path: c.req.path }, 404);
});

// ── Global error handler ─────────────────────────────────────────────
app.onError((err, c) => {
  const reqId = c.get('requestId');
  console.error(`[API Error] [${reqId}] ${c.req.method} ${c.req.path}:`, err.message);
  if (process.env.NODE_ENV === 'development') {
    console.error(err.stack);
  }
  return c.json({
    error: 'Internal server error',
    requestId: reqId,
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  }, 500);
});

export { app };
