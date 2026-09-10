/**
 * PushService.notify — the general sender behind every push that is not the
 * draft clock (trades, roster moves, waivers, chat, matchups, league admin).
 *
 * What is pinned here is the gate ORDER and the failure posture, because both
 * are the difference between "a notification did not arrive" and "a trade
 * failed":
 *
 *   1. TOTALITY. Like notifyOnTheClock, nothing thrown escapes. A trade must
 *      not roll back because APNs was down.
 *   2. DEDUPE FIRST. The claim happens before any per-user read, so a losing
 *      race is cheap. A claim that ERRORS drops the send rather than risking a
 *      duplicate — a manager notices two pushes, not a missing one.
 *   3. THE MASTER SWITCH OUTRANKS THE CATEGORY. push_notifications=false is
 *      silence regardless of push_categories.
 *   4. DEFAULTS COME FROM THE CATEGORY, NOT THE ROW. An absent key in
 *      push_categories means the category's own default, which is what lets a
 *      new category ship without backfilling a million rows.
 *   5. AN UNREADABLE PROFILE IS OPTED IN, matching the draft sender: the
 *      columns default on, and a nudge nobody asked to stop is the smaller
 *      failure.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { PushService, type ApnsConfig } from '../services/PushService';
import { createChain } from './helpers';

vi.mock('@citrus/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@citrus/shared')>();
  return {
    ...actual,
    structuredLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
});

function testConfig(): ApnsConfig {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    keyId: 'ABCDE12345',
    teamId: 'TEAM123456',
    bundleId: 'com.citrussports.app',
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    production: false,
  };
}

/** Claim wins, one opted-in manager, one iOS device. */
function makeSupabase(overrides: Record<string, unknown> = {}) {
  const tables: Record<string, unknown> = {
    push_dedupe: createChain({ data: [{ key: 'k' }], error: null }),
    profiles: createChain({
      data: [{ id: 'user-1', push_notifications: true, push_categories: {} }],
      error: null,
    }),
    device_tokens: createChain({ data: [{ token: 'tok-a', platform: 'ios' }], error: null }),
    ...overrides,
  };
  return {
    from: vi.fn((table: string) => tables[table] ?? createChain()),
    _tables: tables,
  } as never;
}

const base = {
  userIds: ['user-1'],
  category: 'trade_offer' as const,
  title: 'Trade offered',
  body: 'Big Screen TV wants to talk.',
  dedupeKey: 'trade_offer:offer-1',
};

let svc: PushService;
beforeEach(() => {
  vi.restoreAllMocks();
  // Every send succeeds unless a test says otherwise; the APNs wire format is
  // pinned by PushService.test.ts, not here.
  // `sendToToken` is private; the APNs wire format is pinned by
  // PushService.test.ts, so here it is stubbed to a success.
  vi.spyOn(
    PushService.prototype as unknown as { sendToToken: () => Promise<unknown> },
    'sendToToken',
  ).mockResolvedValue({ ok: true, status: 200 });
});
afterEach(() => vi.restoreAllMocks());

describe('notify — dormancy and totality', () => {
  it('returns not_configured rather than throwing when no transport exists', async () => {
    svc = new PushService(makeSupabase(), null, null);
    await expect(svc.notify(base)).resolves.toEqual({
      sent: 0,
      failed: 0,
      skipped: true,
      reason: 'not_configured',
    });
  });

  it('does not throw when Supabase throws mid-call', async () => {
    const exploding = {
      from: vi.fn(() => {
        throw new Error('connection reset');
      }),
    } as never;
    svc = new PushService(exploding, testConfig(), null);
    await expect(svc.notify(base)).resolves.toEqual({
      sent: 0,
      failed: 0,
      skipped: true,
      reason: 'error',
    });
  });

  it('is a no-op, not an error, with no recipients', async () => {
    svc = new PushService(makeSupabase(), testConfig(), null);
    const result = await svc.notify({ ...base, userIds: [] });
    expect(result.reason).toBe('no_recipients');
    expect(result.sent).toBe(0);
  });

  it('deduplicates the recipient list', async () => {
    const supabase = makeSupabase();
    svc = new PushService(supabase, testConfig(), null);
    await svc.notify({ ...base, userIds: ['user-1', 'user-1', 'user-1'] });
    const profiles = (supabase as never as { _tables: Record<string, { in: ReturnType<typeof vi.fn> }> })
      ._tables.profiles;
    expect(profiles.in).toHaveBeenCalledWith('id', ['user-1']);
  });
});

describe('notify — expiry', () => {
  it('gives a general notification a day, not the pick clock’s two minutes', async () => {
    const supabase = makeSupabase();
    svc = new PushService(supabase, testConfig(), null);
    const spy = vi.spyOn(
      PushService.prototype as unknown as { sendToToken: () => Promise<unknown> },
      'sendToToken',
    ).mockResolvedValue({ ok: true, status: 200 });
    await svc.notify(base);
    // (token, payload, expirySeconds)
    expect(spy).toHaveBeenCalledWith('tok-a', expect.any(Object), 24 * 60 * 60);
  });

  it('honours an explicit short expiry for something worthless once stale', async () => {
    svc = new PushService(makeSupabase(), testConfig(), null);
    const spy = vi.spyOn(
      PushService.prototype as unknown as { sendToToken: () => Promise<unknown> },
      'sendToToken',
    ).mockResolvedValue({ ok: true, status: 200 });
    await svc.notify({ ...base, expirySeconds: 300 });
    expect(spy).toHaveBeenCalledWith('tok-a', expect.any(Object), 300);
  });
});

describe('notify — dedupe', () => {
  it('sends when it wins the claim', async () => {
    svc = new PushService(makeSupabase(), testConfig(), null);
    const result = await svc.notify(base);
    expect(result.sent).toBe(1);
    expect(result.skipped).toBe(false);
  });

  it('sends nothing when another caller already claimed the key', async () => {
    svc = new PushService(
      makeSupabase({ push_dedupe: createChain({ data: [], error: null }) }),
      testConfig(),
      null,
    );
    const result = await svc.notify(base);
    expect(result).toEqual({ sent: 0, failed: 0, skipped: true, reason: 'already_delivered' });
  });

  it('drops the send when the claim itself errors — never risk a duplicate', async () => {
    svc = new PushService(
      makeSupabase({ push_dedupe: createChain({ data: null, error: { message: 'deadlock' } }) }),
      testConfig(),
      null,
    );
    const result = await svc.notify(base);
    expect(result.reason).toBe('already_delivered');
    expect(result.sent).toBe(0);
  });

  it('skips the claim entirely when no dedupe key is given', async () => {
    const supabase = makeSupabase();
    svc = new PushService(supabase, testConfig(), null);
    const { dedupeKey: _omitted, ...noKey } = base;
    const result = await svc.notify(noKey);
    expect(result.sent).toBe(1);
    expect((supabase as never as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalledWith(
      'push_dedupe',
    );
  });
});

describe('notify — who gets it', () => {
  it('the master switch outranks an explicitly enabled category', async () => {
    svc = new PushService(
      makeSupabase({
        profiles: createChain({
          data: [{ id: 'user-1', push_notifications: false, push_categories: { trade_offer: true } }],
          error: null,
        }),
      }),
      testConfig(),
      null,
    );
    const result = await svc.notify(base);
    expect(result).toEqual({ sent: 0, failed: 0, skipped: true, reason: 'no_devices' });
  });

  it('an explicit false on the category silences it', async () => {
    svc = new PushService(
      makeSupabase({
        profiles: createChain({
          data: [{ id: 'user-1', push_notifications: true, push_categories: { trade_offer: false } }],
          error: null,
        }),
      }),
      testConfig(),
      null,
    );
    expect((await svc.notify(base)).sent).toBe(0);
  });

  it('an absent key falls back to the category default — on for trade_offer', async () => {
    svc = new PushService(makeSupabase(), testConfig(), null);
    expect((await svc.notify(base)).sent).toBe(1);
  });

  it('an absent key falls back to the category default — OFF for draft_pick', async () => {
    svc = new PushService(makeSupabase(), testConfig(), null);
    const result = await svc.notify({ ...base, category: 'draft_pick', dedupeKey: 'draft_pick:1' });
    expect(result.sent).toBe(0);
    expect(result.reason).toBe('no_devices');
  });

  it('an opt-IN override turns a default-off category on', async () => {
    svc = new PushService(
      makeSupabase({
        profiles: createChain({
          data: [{ id: 'user-1', push_notifications: true, push_categories: { draft_pick: true } }],
          error: null,
        }),
      }),
      testConfig(),
      null,
    );
    const result = await svc.notify({ ...base, category: 'draft_pick', dedupeKey: 'draft_pick:1' });
    expect(result.sent).toBe(1);
  });

  it('treats an unreadable profile as opted in', async () => {
    svc = new PushService(
      makeSupabase({ profiles: createChain({ data: null, error: { message: 'timeout' } }) }),
      testConfig(),
      null,
    );
    expect((await svc.notify(base)).sent).toBe(1);
  });

  it('treats a missing profile row as opted in', async () => {
    svc = new PushService(
      makeSupabase({ profiles: createChain({ data: [], error: null }) }),
      testConfig(),
      null,
    );
    expect((await svc.notify(base)).sent).toBe(1);
  });

  it('reads profiles and tokens once for a league-wide fan-out, not once per manager', async () => {
    const supabase = makeSupabase({
      profiles: createChain({
        data: ['u1', 'u2', 'u3', 'u4'].map((id) => ({
          id,
          push_notifications: true,
          push_categories: {},
        })),
        error: null,
      }),
      device_tokens: createChain({
        data: [
          { token: 'a', platform: 'ios' },
          { token: 'b', platform: 'ios' },
          { token: 'c', platform: 'ios' },
          { token: 'd', platform: 'ios' },
        ],
        error: null,
      }),
    });
    svc = new PushService(supabase, testConfig(), null);
    const result = await svc.notify({ ...base, userIds: ['u1', 'u2', 'u3', 'u4'] });
    expect(result.sent).toBe(4);
    const from = (supabase as never as { from: ReturnType<typeof vi.fn> }).from;
    expect(from.mock.calls.filter((c) => c[0] === 'profiles')).toHaveLength(1);
    expect(from.mock.calls.filter((c) => c[0] === 'device_tokens')).toHaveLength(1);
  });

  it('skips a web token: there is no web transport', async () => {
    svc = new PushService(
      makeSupabase({
        device_tokens: createChain({ data: [{ token: 'w', platform: 'web' }], error: null }),
      }),
      testConfig(),
      null,
    );
    const result = await svc.notify(base);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('skips an Android token when FCM has no credentials, without counting a failure', async () => {
    svc = new PushService(
      makeSupabase({
        device_tokens: createChain({ data: [{ token: 'a', platform: 'android' }], error: null }),
      }),
      testConfig(),
      null,
    );
    const result = await svc.notify(base);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
  });
});
