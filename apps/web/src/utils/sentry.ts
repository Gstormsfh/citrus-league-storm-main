/**
 * Sentry error tracking — scaffolding for production error monitoring.
 *
 * To activate:
 *   1. npm install @sentry/react
 *   2. Set VITE_SENTRY_DSN in .env
 *   3. Uncomment the dynamic import in initSentry() below
 *   4. Call initSentry() in main.tsx before ReactDOM.createRoot()
 *
 * Currently provides no-op stubs so the rest of the codebase can reference
 * captureException() and setSentryUser() without the dependency installed.
 */

let sentryInstance: any = null;

/**
 * Initialize Sentry error tracking.
 *
 * Currently a no-op stub. To activate, install @sentry/react and
 * uncomment the init block below.
 */
export async function initSentry(): Promise<void> {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  // ─── Uncomment when @sentry/react is installed ───
  // try {
  //   const Sentry = await import(/* @vite-ignore */ '@sentry/react');
  //   Sentry.init({
  //     dsn,
  //     environment: import.meta.env.MODE || 'production',
  //     release: `citrus-web@${import.meta.env.VITE_APP_VERSION || '1.0.0'}`,
  //     tracesSampleRate: 0.1,
  //     replaysSessionSampleRate: 0.01,
  //     replaysOnErrorSampleRate: 1.0,
  //     integrations: [
  //       Sentry.browserTracingIntegration(),
  //       Sentry.replayIntegration(),
  //     ],
  //     ignoreErrors: [
  //       'ResizeObserver loop',
  //       'ChunkLoadError',
  //       'Loading chunk',
  //       'Network request failed',
  //       'AbortError',
  //     ],
  //   });
  //   sentryInstance = Sentry;
  // } catch {
  //   // @sentry/react not installed
  // }
}

/**
 * Capture an exception in Sentry (if initialized).
 * Safe to call even if Sentry is not installed — will no-op.
 */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!sentryInstance) return;
  try {
    sentryInstance.captureException(error, { extra: context });
  } catch {
    // Silent fail
  }
}

/**
 * Set user context in Sentry (call after auth).
 */
export function setSentryUser(user: { id: string; email?: string } | null): void {
  if (!sentryInstance) return;
  try {
    sentryInstance.setUser(user ? { id: user.id, email: user.email } : null);
  } catch {
    // Silent fail
  }
}
