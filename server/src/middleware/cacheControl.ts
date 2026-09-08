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
  // 2026-09-09 (#22): the whole player pool (~1.9k rows, the largest response
  // in the app) had no rule, so every relaunch and every 5-minute lapse of the
  // client cache re-downloaded it in full. It is the same for every user and
  // the server rebuilds it at most every 2 minutes (PlayerService CACHE_TTL),
  // so a short max-age plus the ETag lets the shell revalidate with a 304.
  { pattern: /\/api\/players\/?(\?|$)/, maxAge: 60, staleWhileRevalidate: 300 },
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

          // Check If-None-Match. 2026-09-09: this used to `return c.body(null, 304)`,
          // but a middleware's RETURN value after `await next()` is ignored by
          // Hono once the handler has finalized the context, so the 304 never
          // left the server and every ETag round trip carried the full body.
          // Assigning c.res replaces the finalized response (its headers,
          // including the ETag and Cache-Control just set, are carried over).
          const ifNoneMatch = c.req.header('If-None-Match');
          if (ifNoneMatch === etag) {
            c.res = new Response(null, { status: 304, headers: c.res.headers });
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
