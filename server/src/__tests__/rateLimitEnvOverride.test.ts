/**
 * The standard limiter's per-IP ceiling is overridable by env; nothing else is.
 *
 * Why this exists (2026-09-19). A single-origin load generator shares one
 * egress IP across every simulated user, and X-Forwarded-For cannot be used
 * to fake distinct clients because Google Frontend rewrites it before Cloud
 * Run sees it. So a 500-user run against an un-overridden limiter measures
 * the limiter, not the server. These tests pin the three properties that
 * make the override safe to ship: the default is unchanged, a bad value
 * falls back to the default rather than to "unlimited", and the per-user cap
 * is not reachable from the environment at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL = process.env.RATE_LIMIT_STANDARD_IP_MAX;

async function loadWithEnv(value: string | undefined) {
  vi.resetModules();
  if (value === undefined) delete process.env.RATE_LIMIT_STANDARD_IP_MAX;
  else process.env.RATE_LIMIT_STANDARD_IP_MAX = value;
  return import('../middleware/rateLimit');
}

/** Drive the middleware until it refuses, and report how many it allowed. */
async function allowedBefore429(mw: any, ip: string, ceiling = 5000): Promise<number> {
  let allowed = 0;
  for (let i = 0; i < ceiling; i++) {
    let nexted = false;
    const headers: Record<string, string> = {};
    const c: any = {
      req: { header: (n: string) => (n === 'x-forwarded-for' ? ip : undefined) },
      header: (k: string, v: string) => { headers[k] = v; },
      get: () => undefined,
      json: (_body: unknown, status: number) => ({ __status: status }),
    };
    const res = await mw(c, async () => { nexted = true; });
    if (nexted) { allowed++; continue; }
    if (res && res.__status === 429) return allowed;
    return allowed;
  }
  return allowed;
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-19T00:00:00Z')); });
afterEach(() => {
  vi.useRealTimers();
  if (ORIGINAL === undefined) delete process.env.RATE_LIMIT_STANDARD_IP_MAX;
  else process.env.RATE_LIMIT_STANDARD_IP_MAX = ORIGINAL;
});

describe('standardRateLimit per-IP ceiling', () => {
  it('defaults to 600 per IP when the variable is absent', async () => {
    const { standardRateLimit } = await loadWithEnv(undefined);
    expect(await allowedBefore429(standardRateLimit, '198.51.100.1', 900)).toBe(600);
  });

  it('honours an explicit override', async () => {
    const { standardRateLimit } = await loadWithEnv('1500');
    expect(await allowedBefore429(standardRateLimit, '198.51.100.2', 2000)).toBe(1500);
  });

  it.each(['0', '-5', 'abc', '12.5', ''])(
    'falls back to 600 for the unusable value %j rather than becoming unlimited',
    async (bad) => {
      const { standardRateLimit } = await loadWithEnv(bad);
      expect(await allowedBefore429(standardRateLimit, `198.51.100.${Math.random()}`, 900)).toBe(600);
    },
  );

  it('leaves the other limiters alone', async () => {
    const mod = await loadWithEnv('2000000');
    expect(await allowedBefore429(mod.strictRateLimit, '198.51.100.9', 50)).toBe(10);
    expect(await allowedBefore429(mod.authRateLimit, '198.51.100.10', 50)).toBe(5);
    expect(await allowedBefore429(mod.aiRateLimit, '198.51.100.11', 80)).toBe(30);
  });
});
