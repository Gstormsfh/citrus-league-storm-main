import { Context, Next } from 'hono';
import { logger } from '@citrus/shared';

/**
 * Request context middleware — structured logging and observability.
 *
 * Captures request timing, metadata, and response status for every API call.
 * Provides structured JSON logs that integrate with Cloud Logging, Datadog, etc.
 *
 * Output format:
 *   { level, method, path, status, duration_ms, requestId, userId, ip, userAgent, timestamp }
 */

interface RequestLog {
  level: 'info' | 'warn' | 'error';
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  requestId: string;
  userId?: string;
  ip: string;
  userAgent: string;
  timestamp: string;
  query?: string;
}

export async function requestContextMiddleware(c: Context, next: Next) {
  const start = performance.now();

  await next();

  const duration = performance.now() - start;
  const status = c.res.status;

  const log: RequestLog = {
    level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
    method: c.req.method,
    path: c.req.path,
    status,
    duration_ms: Math.round(duration * 100) / 100,
    requestId: (c as any).get?.('requestId') || '-',
    userId: (c as any).get?.('userId'),
    ip: c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      || c.req.header('x-real-ip')
      || 'unknown',
    userAgent: c.req.header('user-agent') || '-',
    timestamp: new Date().toISOString(),
  };

  // Only include query params for non-GET or slow requests
  if (c.req.method !== 'GET' || duration > 1000) {
    const url = new URL(c.req.url);
    if (url.search) {
      log.query = url.search;
    }
  }

  // Structured JSON log line — parseable by Cloud Logging, ELK, Datadog
  if (process.env.NODE_ENV === 'production') {
    logger.info(JSON.stringify(log));
  }

  // Warn on slow responses (>2s)
  if (duration > 2000) {
    logger.warn(`[SLOW] ${c.req.method} ${c.req.path} took ${Math.round(duration)}ms`);
  }
}
