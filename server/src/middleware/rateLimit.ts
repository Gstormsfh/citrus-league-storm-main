import { Context, Next } from 'hono';

/**
 * Simple in-memory rate limiter for the API server.
 * Uses a sliding window approach with per-IP and per-user buckets.
 *
 * For production at scale, replace with Redis-backed rate limiting.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const ipBuckets = new Map<string, RateLimitEntry>();
const userBuckets = new Map<string, RateLimitEntry>();

// Cleanup stale entries every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of ipBuckets) {
    if (entry.resetAt <= now) ipBuckets.delete(key);
  }
  for (const [key, entry] of userBuckets) {
    if (entry.resetAt <= now) userBuckets.delete(key);
  }
}, 60_000).unref();

function getClientIp(c: Context): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown'
  );
}

function checkLimit(
  bucket: Map<string, RateLimitEntry>,
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = bucket.get(key);

  if (!entry || entry.resetAt <= now) {
    bucket.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs };
  }

  entry.count++;
  if (entry.count > maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  return { allowed: true, remaining: maxRequests - entry.count, resetAt: entry.resetAt };
}

interface RateLimitOptions {
  /** Max requests per window (default: 100) */
  maxRequests?: number;
  /** Window duration in milliseconds (default: 60000 = 1 minute) */
  windowMs?: number;
  /** Whether to also rate limit per authenticated user (default: true) */
  perUser?: boolean;
  /** Max requests per user per window (default: maxRequests * 2) */
  maxUserRequests?: number;
}

/**
 * Rate limiting middleware.
 *
 * Default: 100 requests per IP per minute, 200 per authenticated user per minute.
 */
export function rateLimitMiddleware(options: RateLimitOptions = {}) {
  const {
    maxRequests = 100,
    windowMs = 60_000,
    perUser = true,
    maxUserRequests = maxRequests * 2,
  } = options;

  return async (c: Context, next: Next) => {
    const ip = getClientIp(c);

    const ipResult = checkLimit(ipBuckets, ip, maxRequests, windowMs);

    c.header('X-RateLimit-Limit', String(maxRequests));
    c.header('X-RateLimit-Remaining', String(Math.max(0, ipResult.remaining)));
    c.header('X-RateLimit-Reset', String(Math.ceil(ipResult.resetAt / 1000)));

    if (!ipResult.allowed) {
      return c.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' } }, 429);
    }

    if (perUser) {
      const userId = (c as any).get?.('userId');
      if (userId) {
        const userResult = checkLimit(userBuckets, userId, maxUserRequests, windowMs);
        if (!userResult.allowed) {
          return c.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' } }, 429);
        }
      }
    }

    await next();
  };
}

/** Strict rate limit for sensitive operations — 10 req/min per IP */
export const strictRateLimit = rateLimitMiddleware({ maxRequests: 10, windowMs: 60_000 });

/** Standard API rate limit — 300 req/min per IP, 600 per user
 *  Bumped from 100 because the SPA fires many parallel schedule/league
 *  calls on page load until caching/dedup is added. */
export const standardRateLimit = rateLimitMiddleware({ maxRequests: 300 });
