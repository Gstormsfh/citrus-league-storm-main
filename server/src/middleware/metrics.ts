import { Context, Next } from 'hono';

/**
 * Lightweight in-process metrics collector for observability.
 *
 * Tracks request counts, latency histograms, error rates, and active connections.
 * Exposed via /api/metrics endpoint for Prometheus scraping or health dashboards.
 *
 * For multi-instance deployments, replace with Prometheus client library
 * or push metrics to Datadog/Grafana Cloud via StatsD.
 */

interface LatencyBucket {
  le: number;  // Upper bound in ms
  count: number;
}

interface RouteMetric {
  requests: number;
  errors: number;        // 5xx count
  clientErrors: number;  // 4xx count
  totalDurationMs: number;
  maxDurationMs: number;
  /** Histogram buckets for latency distribution */
  latencyBuckets: LatencyBucket[];
}

/**
 * Ceiling on distinct route keys held in memory (2026-09-02 scale audit).
 *
 * `normalizePath` collapses UUIDs and numeric segments, but not every
 * path parameter is one of those. `/api/account/check-username/:username`
 * is unauthenticated and takes a free-text segment, so before this cap
 * every distinct username ever checked minted a permanent Map entry
 * holding a ten-element bucket array — in a process designed to stay up
 * for the length of a season. `standardRateLimit` allows 600 requests per
 * minute per IP, so a single client could mint ~864k route keys a day,
 * and `/api/metrics` emits twelve lines per key.
 *
 * Requests beyond the cap are still counted; they are folded into a
 * single `<other>` bucket so the totals stay honest while the map stops
 * growing.
 */
export const MAX_ROUTE_KEYS = 500;
export const OVERFLOW_ROUTE_KEY = '<other>';

class MetricsCollector {
  private routes = new Map<string, RouteMetric>();
  private startTime = Date.now();
  private totalRequests = 0;
  private totalErrors = 0;
  private activeRequests = 0;
  private peakActiveRequests = 0;

  // Standard Prometheus-style histogram buckets (ms)
  private readonly bucketBounds = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

  private getOrCreateRoute(key: string): RouteMetric {
    let metric = this.routes.get(key);
    if (!metric && this.routes.size >= MAX_ROUTE_KEYS) {
      // Cardinality ceiling reached — fold this request into the shared
      // overflow bucket instead of minting another key. See MAX_ROUTE_KEYS.
      metric = this.routes.get(OVERFLOW_ROUTE_KEY);
      if (metric) return metric;
      key = OVERFLOW_ROUTE_KEY;
    }
    if (!metric) {
      metric = {
        requests: 0,
        errors: 0,
        clientErrors: 0,
        totalDurationMs: 0,
        maxDurationMs: 0,
        latencyBuckets: this.bucketBounds.map(le => ({ le, count: 0 })),
      };
      this.routes.set(key, metric);
    }
    return metric;
  }

  record(method: string, path: string, status: number, durationMs: number): void {
    // Normalize path to avoid cardinality explosion (strip IDs)
    const routeKey = `${method} ${this.normalizePath(path)}`;
    const metric = this.getOrCreateRoute(routeKey);

    this.totalRequests++;
    metric.requests++;
    metric.totalDurationMs += durationMs;
    if (durationMs > metric.maxDurationMs) metric.maxDurationMs = durationMs;

    if (status >= 500) {
      metric.errors++;
      this.totalErrors++;
    } else if (status >= 400) {
      metric.clientErrors++;
    }

    // Fill histogram buckets
    for (const bucket of metric.latencyBuckets) {
      if (durationMs <= bucket.le) {
        bucket.count++;
      }
    }
  }

  incrementActive(): void {
    this.activeRequests++;
    if (this.activeRequests > this.peakActiveRequests) {
      this.peakActiveRequests = this.activeRequests;
    }
  }

  decrementActive(): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
  }

  /** Normalize paths to collapse UUIDs and numeric IDs */
  private normalizePath(path: string): string {
    return path
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
      .replace(/\/\d+/g, '/:n');
  }

  getSnapshot() {
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);

    const routeMetrics: Record<string, {
      requests: number;
      errors: number;
      clientErrors: number;
      avgLatencyMs: number;
      maxLatencyMs: number;
      p50Ms: number;
      p95Ms: number;
      p99Ms: number;
    }> = {};

    for (const [key, metric] of this.routes) {
      const avg = metric.requests > 0 ? Math.round(metric.totalDurationMs / metric.requests) : 0;
      routeMetrics[key] = {
        requests: metric.requests,
        errors: metric.errors,
        clientErrors: metric.clientErrors,
        avgLatencyMs: avg,
        maxLatencyMs: Math.round(metric.maxDurationMs),
        p50Ms: this.percentileFromBuckets(metric, 0.5),
        p95Ms: this.percentileFromBuckets(metric, 0.95),
        p99Ms: this.percentileFromBuckets(metric, 0.99),
      };
    }

    return {
      service: 'citrus-api',
      uptimeSeconds,
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors,
      errorRate: this.totalRequests > 0
        ? `${(100 * this.totalErrors / this.totalRequests).toFixed(2)}%`
        : '0%',
      activeRequests: this.activeRequests,
      peakActiveRequests: this.peakActiveRequests,
      routes: routeMetrics,
      timestamp: new Date().toISOString(),
    };
  }

  /** Estimate a percentile from histogram buckets */
  private percentileFromBuckets(metric: RouteMetric, percentile: number): number {
    const target = Math.ceil(metric.requests * percentile);
    for (const bucket of metric.latencyBuckets) {
      if (bucket.count >= target) return bucket.le;
    }
    return metric.latencyBuckets[metric.latencyBuckets.length - 1]?.le ?? 0;
  }

  /**
   * Export metrics in Prometheus text exposition format.
   * Compatible with /metrics scraping by Prometheus, Grafana Agent, Datadog, etc.
   */
  toPrometheusText(): string {
    const lines: string[] = [];
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);

    // Global counters
    lines.push('# HELP citrus_http_requests_total Total HTTP requests received');
    lines.push('# TYPE citrus_http_requests_total counter');
    lines.push(`citrus_http_requests_total ${this.totalRequests}`);

    lines.push('# HELP citrus_http_errors_total Total 5xx errors');
    lines.push('# TYPE citrus_http_errors_total counter');
    lines.push(`citrus_http_errors_total ${this.totalErrors}`);

    lines.push('# HELP citrus_http_active_requests Currently in-flight requests');
    lines.push('# TYPE citrus_http_active_requests gauge');
    lines.push(`citrus_http_active_requests ${this.activeRequests}`);

    lines.push('# HELP citrus_uptime_seconds Server uptime in seconds');
    lines.push('# TYPE citrus_uptime_seconds gauge');
    lines.push(`citrus_uptime_seconds ${uptimeSeconds}`);

    // Per-route histograms
    lines.push('# HELP citrus_http_request_duration_ms HTTP request latency in milliseconds');
    lines.push('# TYPE citrus_http_request_duration_ms histogram');

    for (const [routeKey, metric] of this.routes) {
      // Sanitize route key for Prometheus labels
      const route = routeKey.replace(/"/g, '\\"');

      for (const bucket of metric.latencyBuckets) {
        lines.push(`citrus_http_request_duration_ms_bucket{route="${route}",le="${bucket.le}"} ${bucket.count}`);
      }
      lines.push(`citrus_http_request_duration_ms_bucket{route="${route}",le="+Inf"} ${metric.requests}`);
      lines.push(`citrus_http_request_duration_ms_sum{route="${route}"} ${Math.round(metric.totalDurationMs)}`);
      lines.push(`citrus_http_request_duration_ms_count{route="${route}"} ${metric.requests}`);
    }

    // Error rate alert thresholds (expose as metric for alerting rules)
    const errorRate = this.totalRequests > 0 ? this.totalErrors / this.totalRequests : 0;
    lines.push('# HELP citrus_http_error_rate Current error rate (0.0-1.0)');
    lines.push('# TYPE citrus_http_error_rate gauge');
    lines.push(`citrus_http_error_rate ${errorRate.toFixed(6)}`);

    return lines.join('\n') + '\n';
  }

  /**
   * Check if any alerting thresholds are breached.
   * Returns an array of active alerts for the health dashboard.
   */
  getAlerts(): Array<{ level: 'warning' | 'critical'; message: string }> {
    const alerts: Array<{ level: 'warning' | 'critical'; message: string }> = [];

    // Error rate alerting
    if (this.totalRequests >= 100) {
      const errorRate = this.totalErrors / this.totalRequests;
      if (errorRate > 0.05) {
        alerts.push({ level: 'critical', message: `Error rate ${(errorRate * 100).toFixed(1)}% exceeds 5% threshold` });
      } else if (errorRate > 0.02) {
        alerts.push({ level: 'warning', message: `Error rate ${(errorRate * 100).toFixed(1)}% exceeds 2% threshold` });
      }
    }

    // Per-route p95 latency alerting
    for (const [routeKey, metric] of this.routes) {
      if (metric.requests < 10) continue;
      const p95 = this.percentileFromBuckets(metric, 0.95);
      if (p95 >= 5000) {
        alerts.push({ level: 'critical', message: `${routeKey} p95 latency ${p95}ms exceeds 5s threshold` });
      } else if (p95 >= 2000) {
        alerts.push({ level: 'warning', message: `${routeKey} p95 latency ${p95}ms exceeds 2s threshold` });
      }
    }

    return alerts;
  }

  reset(): void {
    this.routes.clear();
    this.totalRequests = 0;
    this.totalErrors = 0;
    this.startTime = Date.now();
    this.peakActiveRequests = 0;
  }
}

/** Global metrics collector instance */
export const metrics = new MetricsCollector();

/**
 * The label this request is counted under.
 *
 * Hono's `routePath` is the REGISTERED pattern (`/api/leagues/:leagueId`),
 * not the concrete URL, so it is bounded by the number of routes in the
 * app no matter what a caller puts in a path segment. `normalizePath` is
 * the fallback for the cases `routePath` cannot answer — it collapses
 * UUIDs and numeric ids but nothing else, which is why an unauthenticated
 * free-text segment like `/check-username/:username` used to mint a key
 * per distinct value. See MAX_ROUTE_KEYS.
 */
function routeLabel(c: Context): string {
  try {
    return c.req.routePath || c.req.path;
  } catch {
    return c.req.path;
  }
}

/**
 * Middleware that records request metrics.
 * Apply to /api/* routes.
 *
 * ERROR ACCOUNTING (2026-09-02 scale audit). This used to `await next()`
 * with no try/catch, so a handler or middleware that THREW skipped every
 * line after it:
 *
 *   - `decrementActive()` never ran, so `activeRequests` — the saturation
 *     gauge you would page on — climbed by one per thrown error and never
 *     came back down. `peakActiveRequests` was permanently poisoned with it.
 *   - `record()` never ran, so the request was invisible: not in
 *     `totalRequests`, not in `totalErrors`, not in the latency histogram.
 *     `citrus_http_error_rate` — the metric an alert rule keys on — could
 *     not see a thrown exception at all. Only handlers that *returned* a
 *     5xx were ever counted, and `app.onError` converts throws into
 *     returned 500s AFTER this middleware has already been skipped.
 *
 * The `finally` fixes the gauge; the `catch` records the throw as the 500
 * that `app.onError` is about to send, then rethrows so error handling is
 * unchanged.
 */
export async function metricsMiddleware(c: Context, next: Next) {
  metrics.incrementActive();
  const start = performance.now();

  try {
    await next();
    metrics.record(c.req.method, routeLabel(c), c.res.status, performance.now() - start);
  } catch (err) {
    // `app.onError` turns this into a 500 response. Count it as one.
    metrics.record(c.req.method, routeLabel(c), 500, performance.now() - start);
    throw err;
  } finally {
    metrics.decrementActive();
  }
}
