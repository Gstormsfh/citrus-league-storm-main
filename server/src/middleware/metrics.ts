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
 * Middleware that records request metrics.
 * Apply to /api/* routes.
 */
export async function metricsMiddleware(c: Context, next: Next) {
  metrics.incrementActive();
  const start = performance.now();

  await next();

  const durationMs = performance.now() - start;
  metrics.decrementActive();
  metrics.record(c.req.method, c.req.path, c.res.status, durationMs);
}
