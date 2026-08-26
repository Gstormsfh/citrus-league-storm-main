import { Context, Next } from 'hono';

/**
 * Scalable in-memory rate limiter with LRU eviction.
 *
 * Improvements over the original:
 * - LRU eviction prevents unbounded memory growth under DDoS / many unique IPs
 * - Configurable max bucket size (default: 10,000 entries)
 * - Periodic cleanup still runs but LRU eviction is the primary memory safety mechanism
 *
 * For multi-instance deployments (Cloud Run), replace with Redis-backed
 * rate limiting using a sorted set sliding window (ZRANGEBYSCORE + ZADD).
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * LRU-evicting Map — drops the oldest entry when capacity is exceeded.
 * Uses Map insertion order (guaranteed by ES2015) for LRU behavior.
 */
class LRUBucketMap {
  private map = new Map<string, RateLimitEntry>();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: string): RateLimitEntry | undefined {
    const entry = this.map.get(key);
    if (entry) {
      // Move to end (most recently used)
      this.map.delete(key);
      this.map.set(key, entry);
    }
    return entry;
  }

  set(key: string, entry: RateLimitEntry): void {
    // Delete first to update insertion order
    this.map.delete(key);

    // Evict oldest entry if at capacity
    if (this.map.size >= this.maxSize) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }

    this.map.set(key, entry);
  }

  get size(): number {
    return this.map.size;
  }

  /** Remove expired entries */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.map) {
      if (entry.resetAt <= now) {
        this.map.delete(key);
      }
    }
  }
}

// LRU-bounded buckets — 10,000 unique IPs / users max
const MAX_BUCKET_SIZE = 10_000;
const ipBuckets = new LRUBucketMap(MAX_BUCKET_SIZE);
const userBuckets = new LRUBucketMap(MAX_BUCKET_SIZE);

// Cleanup stale entries every 60 seconds
setInterval(() => {
  ipBuckets.cleanup();
  userBuckets.cleanup();
}, 60_000).unref();

function getClientIp(c: Context): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown'
  );
}

function checkLimit(
  bucket: LRUBucketMap,
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
  /**
   * Namespace for this limiter's counters. REQUIRED in spirit — every limiter
   * must have its own, or it shares a budget with the others.
   *
   * THE BUG THIS EXISTS TO PREVENT (2026-08-26). The buckets are module-level
   * and were keyed on the IP alone, so every limiter incremented and read the
   * SAME counter while checking it against its own, different ceiling:
   *
   *   app.use('/api/*',         standardRateLimit)  // 600/min
   *   app.use('/api/stormy/*',  aiRateLimit)        // 30/min
   *   app.use('/api/auth/signup', authRateLimit)    // 5/min
   *
   * standardRateLimit runs on every API call, so ordinary browsing filled the
   * shared counter. A single Matchup render issues ~102 requests (measured in
   * a device capture). After that, within the same 60s window:
   *
   *   • Stormy compared 103 against 30  -> 429
   *   • Sign-up compared 103 against 5  -> 429
   *
   * The second one is the serious one: anyone who used the app for a few
   * seconds and then tried to create an account was told "Too many requests"
   * with no way through but to wait a minute without touching anything.
   *
   * Namespacing makes each limiter's budget its own.
   */
  name?: string;
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
 * Uses LRU eviction to prevent unbounded memory growth at scale.
 */
export function rateLimitMiddleware(options: RateLimitOptions = {}) {
  const {
    name,
    maxRequests = 100,
    windowMs = 60_000,
    perUser = true,
    maxUserRequests = maxRequests * 2,
  } = options;

  // Falls back to the limiter's own settings so an unnamed limiter still gets
  // a distinct namespace rather than silently joining someone else's budget.
  const scope = name ?? `anon-${maxRequests}-${windowMs}-${perUser}`;

  return async (c: Context, next: Next) => {
    const ip = getClientIp(c);

    const ipResult = checkLimit(ipBuckets, `${scope}|ip|${ip}`, maxRequests, windowMs);

    c.header('X-RateLimit-Limit', String(maxRequests));
    c.header('X-RateLimit-Remaining', String(Math.max(0, ipResult.remaining)));
    c.header('X-RateLimit-Reset', String(Math.ceil(ipResult.resetAt / 1000)));

    if (!ipResult.allowed) {
      return c.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' } }, 429);
    }

    if (perUser) {
      const userId = (c as any).get?.('userId');
      if (userId) {
        const userResult = checkLimit(userBuckets, `${scope}|user|${userId}`, maxUserRequests, windowMs);
        if (!userResult.allowed) {
          return c.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' } }, 429);
        }
      }
    }

    await next();
  };
}

/** Strict rate limit for sensitive operations — 10 req/min per IP */
export const strictRateLimit = rateLimitMiddleware({ name: 'strict', maxRequests: 10, windowMs: 60_000 });

/**
 * AI assistant rate limit — 30 req/min per IP, 20 per user.
 *
 * Stormy does NOT need a tight per-minute cap: real abuse protection is the
 * three-layer spend guard in StormyAssistantService (15 questions per user
 * per rolling week, 500 across all users per day, and a hard monthly token
 * budget). Those bound the actual cost.
 *
 * What a 10/min PER-IP cap did instead was punish shared IPs — a household,
 * an office, a coffee shop — and gate a route whose real limits live
 * elsewhere. It was harmless while nothing called /api/stormy/*; it became
 * the user-visible failure the moment the client was repointed there
 * (2026-08-25). This is a burst guard only.
 */
export const aiRateLimit = rateLimitMiddleware({ name: 'ai', maxRequests: 30, maxUserRequests: 20, windowMs: 60_000 });

/** Auth rate limit — 5 req/min per IP (brute force protection) */
export const authRateLimit = rateLimitMiddleware({ name: 'auth', maxRequests: 5, windowMs: 60_000, perUser: false });

/** Standard API rate limit — 600 req/min per IP, 1200 per user
 *  Bumped from 300 because users with multiple tabs open (common on
 *  playoff night — watching game + managing roster) + Realtime
 *  subscriptions + react-query refetches can legitimately push past
 *  300 in a burst. This is per-IP so shared-household cases (family
 *  on same router) also benefit. */
export const standardRateLimit = rateLimitMiddleware({ name: 'standard', maxRequests: 600, maxUserRequests: 1200 });
