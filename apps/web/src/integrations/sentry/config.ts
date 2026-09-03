/**
 * Sentry Error Monitoring Configuration
 *
 * Provides production-grade error tracking, performance monitoring,
 * and session replay. Initializes only when @sentry/react is installed
 * and VITE_SENTRY_DSN is configured.
 *
 * Setup:
 *   1. npm install @sentry/react
 *   2. Set VITE_SENTRY_DSN in your .env file
 *   3. This file auto-initializes on import (imported in main.tsx)
 *
 * Sentry Dashboard: https://sentry.io (create project for "citrus-fantasy-sports")
 */

let _sentry: any = null;
let sentryInitialized = false;

/**
 * Lazily load @sentry/react.
 *
 * This MUST be a plain `import('@sentry/react')`. It used to build the module
 * name at runtime (`['@sentry','react'].join('/')` fed through `Function`) to
 * hide it from Rollup so the build would succeed with the package absent.
 * That worked — and it also meant Sentry could NEVER load, installed or not:
 * Rollup never bundled it, and a browser cannot resolve a bare specifier at
 * runtime. The import threw, the catch below swallowed it, and monitoring was
 * silently off while everything looked wired. Do not reintroduce that trick.
 *
 * Consequence of the honest version: @sentry/react is now a real build
 * dependency. Remove the package and the build FAILS rather than quietly
 * shipping without monitoring. That is the intended trade.
 */
async function loadSentry() {
  if (_sentry) return _sentry;
  try {
    _sentry = await import('@sentry/react');
    return _sentry;
  } catch {
    return null;
  }
}

/**
 * Initialize Sentry error monitoring.
 * Safe to call multiple times — only initializes once.
 * No-ops gracefully if @sentry/react is not installed or DSN is missing.
 */
export async function initSentry(): Promise<void> {
  if (sentryInitialized) return;

  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  const mod = await loadSentry();
  if (!mod) return;

  try {
    mod.init({
      dsn,
      environment: import.meta.env.MODE,
      release: `citrus-fantasy@${import.meta.env.VITE_APP_VERSION || '0.0.0'}`,
      tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
      replaysSessionSampleRate: 0.01,
      replaysOnErrorSampleRate: 1.0,

      beforeSend(event: any) {
        const message = event.exception?.values?.[0]?.value || '';
        if (
          message.includes('Failed to fetch dynamically imported module') ||
          message.includes('Loading chunk') ||
          message.includes('Loading CSS chunk') ||
          message.includes('net::ERR_BLOCKED_BY_CLIENT')
        ) {
          return null;
        }
        return event;
      },

      beforeBreadcrumb(breadcrumb: any) {
        if (breadcrumb.category === 'fetch' || breadcrumb.category === 'xhr') {
          const url = breadcrumb.data?.url || '';
          if (url.includes('/auth/') || url.includes('token')) {
            breadcrumb.data = { ...breadcrumb.data, url: '[REDACTED_AUTH_URL]' };
          }
        }
        return breadcrumb;
      },
      integrations: [],
    });
    sentryInitialized = true;
  } catch {
    // Initialization failed — app continues without monitoring
  }
}

/**
 * Set the authenticated user context in Sentry.
 * Call after login to associate errors with user IDs.
 */
export async function setSentryUser(user: { id: string; email?: string } | null): Promise<void> {
  if (!sentryInitialized) return;
  try {
    const mod = await loadSentry();
    if (!mod) return;
    mod.setUser(user ? { id: user.id, email: user.email } : null);
  } catch { /* non-critical */ }
}

/**
 * Capture an exception manually (for caught errors in services).
 */
export async function captureException(error: unknown, context?: Record<string, unknown>): Promise<void> {
  if (!sentryInitialized) return;
  try {
    const mod = await loadSentry();
    if (!mod) return;
    mod.captureException(error, { extra: context });
  } catch { /* non-critical */ }
}
