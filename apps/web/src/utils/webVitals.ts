/**
 * Web Vitals reporting — Core Web Vitals tracking for observability.
 *
 * Reports LCP, FID, CLS, FCP, and TTFB to an analytics endpoint.
 * Uses the web-vitals library pattern with PerformanceObserver fallback.
 *
 * Usage: call initWebVitals() once in main.tsx after app mount.
 */

interface WebVitalMetric {
  name: string;
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  timestamp: string;
}

type VitalReporter = (metric: WebVitalMetric) => void;

// Thresholds per https://web.dev/vitals/
const THRESHOLDS: Record<string, [number, number]> = {
  LCP: [2500, 4000],    // Good < 2.5s, Poor > 4s
  FID: [100, 300],       // Good < 100ms, Poor > 300ms
  CLS: [0.1, 0.25],     // Good < 0.1, Poor > 0.25
  FCP: [1800, 3000],     // Good < 1.8s, Poor > 3s
  TTFB: [800, 1800],     // Good < 800ms, Poor > 1.8s
  INP: [200, 500],       // Good < 200ms, Poor > 500ms
};

function getRating(name: string, value: number): 'good' | 'needs-improvement' | 'poor' {
  const [good, poor] = THRESHOLDS[name] ?? [Infinity, Infinity];
  if (value <= good) return 'good';
  if (value <= poor) return 'needs-improvement';
  return 'poor';
}

/** Batch vitals and send to the API endpoint */
const vitalsQueue: WebVitalMetric[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function queueVital(metric: WebVitalMetric) {
  vitalsQueue.push(metric);

  // Debounce: flush after 5s of inactivity or when we have all 5 vitals
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flushVitals, 5000);

  if (vitalsQueue.length >= 5) flushVitals();
}

function flushVitals() {
  if (vitalsQueue.length === 0) return;

  const batch = vitalsQueue.splice(0);

  // Use sendBeacon for reliability (works during page unload)
  const apiUrl = import.meta.env.VITE_API_URL || '';
  const endpoint = `${apiUrl}/api/vitals`;

  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, JSON.stringify({ vitals: batch }));
    } else {
      fetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({ vitals: batch }),
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
      }).catch(() => {
        // Silent fail — vitals reporting should never impact UX
      });
    }
  } catch {
    // Silent fail
  }
}

/** Observe Largest Contentful Paint */
function observeLCP(report: VitalReporter) {
  if (!('PerformanceObserver' in window)) return;

  const observer = new PerformanceObserver((list) => {
    const entries = list.getEntries();
    const lastEntry = entries[entries.length - 1] as PerformanceEntry;
    if (lastEntry) {
      report({
        name: 'LCP',
        value: Math.round(lastEntry.startTime),
        rating: getRating('LCP', lastEntry.startTime),
        timestamp: new Date().toISOString(),
      });
    }
  });

  observer.observe({ type: 'largest-contentful-paint', buffered: true });
}

/** Observe First Input Delay */
function observeFID(report: VitalReporter) {
  if (!('PerformanceObserver' in window)) return;

  const observer = new PerformanceObserver((list) => {
    const entry = list.getEntries()[0] as any;
    if (entry) {
      const fid = entry.processingStart - entry.startTime;
      report({
        name: 'FID',
        value: Math.round(fid),
        rating: getRating('FID', fid),
        timestamp: new Date().toISOString(),
      });
    }
  });

  observer.observe({ type: 'first-input', buffered: true });
}

/** Observe Cumulative Layout Shift */
function observeCLS(report: VitalReporter) {
  if (!('PerformanceObserver' in window)) return;

  let clsScore = 0;

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as any[]) {
      if (!entry.hadRecentInput) {
        clsScore += entry.value;
      }
    }
  });

  observer.observe({ type: 'layout-shift', buffered: true });

  // Report CLS on page hide
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      report({
        name: 'CLS',
        value: Math.round(clsScore * 1000) / 1000,
        rating: getRating('CLS', clsScore),
        timestamp: new Date().toISOString(),
      });
    }
  }, { once: true });
}

/** Observe First Contentful Paint */
function observeFCP(report: VitalReporter) {
  if (!('PerformanceObserver' in window)) return;

  const observer = new PerformanceObserver((list) => {
    const entry = list.getEntries().find((e) => e.name === 'first-contentful-paint');
    if (entry) {
      report({
        name: 'FCP',
        value: Math.round(entry.startTime),
        rating: getRating('FCP', entry.startTime),
        timestamp: new Date().toISOString(),
      });
      observer.disconnect();
    }
  });

  observer.observe({ type: 'paint', buffered: true });
}

/** Measure Time to First Byte */
function measureTTFB(report: VitalReporter) {
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (nav) {
    const ttfb = nav.responseStart - nav.requestStart;
    report({
      name: 'TTFB',
      value: Math.round(ttfb),
      rating: getRating('TTFB', ttfb),
      timestamp: new Date().toISOString(),
    });
  }
}

/** Observe Interaction to Next Paint (INP — replaces FID in CWV) */
function observeINP(report: VitalReporter) {
  if (!('PerformanceObserver' in window)) return;

  let worstINP = 0;

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as any[]) {
        const duration = entry.duration ?? 0;
        if (duration > worstINP) worstINP = duration;
      }
    });

    observer.observe({ type: 'event', buffered: true });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && worstINP > 0) {
        report({
          name: 'INP',
          value: Math.round(worstINP),
          rating: getRating('INP', worstINP),
          timestamp: new Date().toISOString(),
        });
      }
    }, { once: true });
  } catch {
    // INP observer not supported in this browser
  }
}

/**
 * Initialize Web Vitals tracking.
 * Call once after app mount in main.tsx.
 */
export function initWebVitals() {
  if (typeof window === 'undefined') return;
  // Only run in production to avoid noise in dev
  if (import.meta.env.DEV) return;

  const report: VitalReporter = queueVital;

  observeLCP(report);
  observeFID(report);
  observeCLS(report);
  observeFCP(report);
  measureTTFB(report);
  observeINP(report);

  // Flush remaining vitals on page unload
  window.addEventListener('beforeunload', flushVitals);
}
