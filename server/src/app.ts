import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
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

export type Env = {
  Variables: {
    userId: string;
    userToken: string;
  };
};

const app = new Hono<Env>();

// Global middleware
app.use('*', honoLogger());
app.use('*', secureHeaders());
app.use('*', cors({
  origin: [
    'http://localhost:8080',
    'http://localhost:5173',
    'https://citrusfantasysports.com',
    'https://www.citrusfantasysports.com',
  ],
  credentials: true,
  allowHeaders: ['Content-Type', 'Authorization', 'x-client-info'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

// Health check — no auth required
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'citrus-api',
    timestamp: new Date().toISOString(),
  });
});

// API routes
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

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found', path: c.req.path }, 404);
});

// Global error handler
app.onError((err, c) => {
  console.error(`[API Error] ${c.req.method} ${c.req.path}:`, err.message);
  return c.json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  }, 500);
});

export { app };
