import { Context, Next } from 'hono';

/**
 * Cache-Control middleware for API responses.
 *
 * Applies appropriate cache headers based on the data freshness requirements:
 *   - Static/slow data (schedules, player bios): 5 min cache + stale-while-revalidate
 *   - Semi-dynamic data (standings, projections): 1 min cache
 *   - Dynamic data (live scores, matchups): no-cache
 *   - Mutations (POST/PUT/DELETE): never cached
 *
 * Also sets ETag headers for conditional requests (If-None-Match).
 */

// Route patterns and their cache durations (seconds)
const CACHE_RULES: Array<{ pattern: RegExp; maxAge: number; staleWhileRevalidate?: number }> = [
  // Static data — cache aggressively
  { pattern: /\/api\/schedule/, maxAge: 300, staleWhileRevalidate: 600 },
  { pattern: /\/api\/players\/\:?[^/]+\/bio/, maxAge: 300, staleWhileRevalidate: 600 },

  // Semi-dynamic — short cache
  { pattern: /\/api\/players\/search/, maxAge: 60, staleWhileRevalidate: 120 },
  { pattern: /\/api\/players\/stats/, maxAge: 60, staleWhileRevalidate: 120 },
  { pattern: /\/api\/leagues\/[^/]+\/standings/, maxAge: 60, staleWhileRevalidate: 120 },
  { pattern: /\/api\/leagues\/[^/]+\/projections/, maxAge: 60, staleWhileRevalidate: 120 },

  // Dynamic data — minimal or no cache
  { pattern: /\/api\/leagues\/[^/]+\/matchups/, maxAge: 15 },
  { pattern: /\/api\/leagues\/[^/]+\/roster/, maxAge: 15 },
];

/** Generate a lightweight ETag from response body */
function generateETag(body: string): string {
  // Simple hash — for production, use a proper hash (xxhash or FNV)
  let hash = 0;
  for (let i = 0; i < body.length; i++) {
    const char = body.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return `"${Math.abs(hash).toString(36)}"`;
}

export async function cacheControlMiddleware(c: Context, next: Next) {
  // Never cache mutations
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    await next();
    c.header('Cache-Control', 'no-store');
    return;
  }

  await next();

  // Don't override if a route already set Cache-Control
  if (c.res.headers.get('Cache-Control')) return;

  // Don't cache error responses
  if (c.res.status >= 400) {
    c.header('Cache-Control', 'no-store');
    return;
  }

  const path = c.req.path;

  // Find matching cache rule
  for (const rule of CACHE_RULES) {
    if (rule.pattern.test(path)) {
      const parts = [`public`, `max-age=${rule.maxAge}`];
      if (rule.staleWhileRevalidate) {
        parts.push(`stale-while-revalidate=${rule.staleWhileRevalidate}`);
      }
      c.header('Cache-Control', parts.join(', '));

      // Add ETag for conditional requests
      try {
        const body = await c.res.clone().text();
        if (body) {
          const etag = generateETag(body);
          c.header('ETag', etag);

          // Check If-None-Match
          const ifNoneMatch = c.req.header('If-None-Match');
          if (ifNoneMatch === etag) {
            return c.body(null, 304);
          }
        }
      } catch {
        // ETag generation failed — skip, not critical
      }

      return;
    }
  }

  // Default: private, short cache for authenticated data
  c.header('Cache-Control', 'private, max-age=0, must-revalidate');
}
