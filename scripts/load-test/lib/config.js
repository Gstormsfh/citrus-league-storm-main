// Shared configuration for k6 load-test scenarios.
//
// Target URL and auth credentials are pulled from environment variables
// so the same scripts run against local dev, staging, and production.
// Never commit real keys here.

export const TARGET_URL =
  __ENV.TARGET_URL || 'https://api.citrusfantasysports.com';

export const WEB_URL =
  __ENV.WEB_URL || 'https://citrusfantasysports.com';

export const SUPABASE_URL = __ENV.SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY || '';

// Test account pool — populated before run. See scenarios/README.md
// for provisioning. Each entry: { email, password }
// In k6, __ENV values are strings, so we parse a JSON blob.
export const TEST_ACCOUNTS = __ENV.TEST_ACCOUNTS
  ? JSON.parse(__ENV.TEST_ACCOUNTS)
  : [];

// Default per-scenario thresholds. Individual scenarios may override.
// These numbers come from the postmortem capacity math for 200
// concurrent users on a properly-configured Cloud Run (2Gi / 2CPU /
// minScale=1 / maxScale=10) behind Supabase Pro.
export const THRESHOLDS = {
  // p95 latency budget per endpoint class
  http_req_duration: ['p(95)<1000', 'p(99)<2000'],
  // Fewer than 1 in 1000 requests may error
  http_req_failed: ['rate<0.001'],
  // No request may take longer than 5s (hard ceiling)
  'http_req_duration{status:timeout}': ['count<1'],
};

// Pre-flight: fail fast if a scenario is missing required env.
export function requireEnv(name, value) {
  if (!value) {
    throw new Error(
      `Missing required env var: ${name}. ` +
      `See scripts/load-test/README.md for setup.`
    );
  }
  return value;
}
