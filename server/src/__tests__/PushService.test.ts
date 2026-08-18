/**
 * PushService — draft-turn push notifications.
 *
 * What is pinned here is the contract the draft engine depends on, not the APNs
 * wire format. The engine calls this from `armPickDeadline`, the single entry
 * point for arming a pick clock. If a push can throw, or block, or fire twice,
 * it stops being a nice-to-have and starts being a way to break a live draft.
 *
 *   1. TOTALITY. No public method throws — ever. Unconfigured, bad credentials,
 *      a Supabase error mid-call: all return a result object. A draft must not
 *      care that a notification failed.
 *   2. DEDUPE. The engine arms a deadline on a genuine turn change, but ALSO on
 *      pod restart (event-log replay) and potentially from a second instance
 *      holding the lobby. Only the caller that wins the (league_id, pick_number)
 *      row may send, or a mid-draft deploy re-notifies everyone.
 *   3. UNOWNED SEATS. 38 teams in prod are AI teams with owner_id NULL. Those
 *      must resolve to zero tokens quietly, not error.
 *   4. ES256. Apple wants the JOSE fixed-width R||S signature, not DER. Getting
 *      this wrong is a 403 InvalidProviderToken on every send, and it is exactly
 *      the reason people reach for a JWT library. The signature must be 64 bytes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { PushService, loadApnsConfigFromEnv, type ApnsConfig } from '../services/PushService';
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

/** Supabase double with per-table chains and a claim that succeeds by default. */
function makeSupabase(overrides: Record<string, unknown> = {}) {
  const tables: Record<string, unknown> = {
    push_deliveries: createChain({ data: [{ pick_number: 4 }], error: null }),
    teams: createChain({ data: { owner_id: 'user-1' }, error: null }),
    device_tokens: createChain({ data: [{ token: 'tok-a' }], error: null }),
    ...overrides,
  };
  return {
    from: vi.fn((table: string) => tables[table] ?? createChain()),
    _tables: tables,
  } as never;
}

const input = {
  leagueId: 'league-1',
  pickNumber: 4,
  teamId: 'team-1',
  leagueName: 'THE TWELVE',
  deadlineIso: '2026-08-18T12:00:00.000Z',
};

describe('PushService — dormancy', () => {
  it('is not configured when APNs env vars are absent, and says so without throwing', async () => {
    const svc = new PushService(makeSupabase(), null);
    expect(svc.isConfigured()).toBe(false);

    const result = await svc.notifyOnTheClock(input);
    expect(result).toEqual({ sent: 0, failed: 0, skipped: true, reason: 'not_configured' });
  });

  it('stays dormant rather than throwing when the private key is malformed', () => {
    const svc = new PushService(makeSupabase(), {
      ...testConfig(),
      privateKeyPem: '-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----',
    });
    expect(svc.isConfigured()).toBe(false);
  });

  it('never sends when dormant, even with a claimable pick', async () => {
    const supabase = makeSupabase();
    const svc = new PushService(supabase, null);
    await svc.notifyOnTheClock(input);
    // Not even the dedupe row is written — dormant means untouched.
    expect((supabase as unknown as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalled();
  });
});

describe('PushService — delivery dedupe', () => {
  it('skips when the (league, pick) row was already claimed by someone else', async () => {
    const supabase = makeSupabase({
      push_deliveries: createChain({ data: [], error: null }),
    });
    const svc = new PushService(supabase, testConfig());

    const result = await svc.notifyOnTheClock(input);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('already_delivered');
    expect(result.sent).toBe(0);
  });

  it('skips when the claim itself errors — a failed claim must not become a send', async () => {
    const supabase = makeSupabase({
      push_deliveries: createChain({ data: null, error: { message: 'deadlock detected' } }),
    });
    const svc = new PushService(supabase, testConfig());

    const result = await svc.notifyOnTheClock(input);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('already_delivered');
  });

  it('claims on (league_id, pick_number) with ignoreDuplicates so concurrent pods cannot double-send', async () => {
    const supabase = makeSupabase();
    const svc = new PushService(supabase, testConfig());
    await svc.notifyOnTheClock(input);

    const chain = (supabase as unknown as { _tables: Record<string, { upsert: ReturnType<typeof vi.fn> }> })
      ._tables.push_deliveries;
    expect(chain.upsert).toHaveBeenCalledWith(
      { league_id: 'league-1', pick_number: 4 },
      { onConflict: 'league_id,pick_number', ignoreDuplicates: true },
    );
  });
});

describe('PushService — recipient resolution', () => {
  it('sends nothing for an unowned AI seat, and does not treat it as a failure', async () => {
    const supabase = makeSupabase({
      teams: createChain({ data: { owner_id: null }, error: null }),
    });
    const svc = new PushService(supabase, testConfig());

    const result = await svc.notifyOnTheClock(input);
    expect(result).toEqual({ sent: 0, failed: 0, skipped: true, reason: 'no_devices' });
  });

  it('sends nothing when the owner has registered no devices', async () => {
    const supabase = makeSupabase({
      device_tokens: createChain({ data: [], error: null }),
    });
    const svc = new PushService(supabase, testConfig());

    const result = await svc.notifyOnTheClock(input);
    expect(result.reason).toBe('no_devices');
  });

  it('swallows a thrown Supabase error and reports it rather than propagating', async () => {
    const supabase = {
      from: vi.fn(() => {
        throw new Error('connection reset');
      }),
    } as never;
    const svc = new PushService(supabase, testConfig());

    const result = await svc.notifyOnTheClock(input);
    expect(result).toEqual({ sent: 0, failed: 0, skipped: true, reason: 'error' });
  });
});

describe('PushService — device registration', () => {
  it('upserts on the token so a reinstall refreshes rather than duplicates', async () => {
    const chain = createChain({ data: null, error: null });
    const supabase = { from: vi.fn(() => chain) } as never;
    const svc = new PushService(supabase, testConfig());

    const { error } = await svc.registerDevice('user-1', 'tok-new');
    expect(error).toBeNull();
    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', token: 'tok-new', platform: 'ios' }),
      { onConflict: 'token' },
    );
  });

  it('returns the error message instead of throwing', async () => {
    const chain = createChain({ data: null, error: { message: 'rls denied' } });
    const supabase = { from: vi.fn(() => chain) } as never;
    const svc = new PushService(supabase, testConfig());

    const { error } = await svc.registerDevice('user-1', 'tok');
    expect(error).toBe('rls denied');
  });
});

describe('PushService — APNs JWT', () => {
  /** The JWT is private; reach through the same way the send path does. */
  function mintJwt(svc: PushService): string {
    return (svc as unknown as { currentJwt: () => string }).currentJwt();
  }

  it('mints an ES256 token whose signature is JOSE R||S (64 bytes), not DER', () => {
    const config = testConfig();
    const svc = new PushService(makeSupabase(), config);
    const [rawHeader, rawClaims, rawSig] = mintJwt(svc).split('.');

    expect(JSON.parse(Buffer.from(rawHeader, 'base64url').toString())).toEqual({
      alg: 'ES256',
      kid: config.keyId,
    });
    const claims = JSON.parse(Buffer.from(rawClaims, 'base64url').toString());
    expect(claims.iss).toBe(config.teamId);
    expect(typeof claims.iat).toBe('number');

    // DER-encoded ECDSA is variable length (~70 bytes) and Apple rejects it.
    expect(Buffer.from(rawSig, 'base64url')).toHaveLength(64);
  });

  it('caches the token so a 12-round draft does not mint 200 of them', () => {
    const svc = new PushService(makeSupabase(), testConfig());
    expect(mintJwt(svc)).toBe(mintJwt(svc));
  });
});

describe('loadApnsConfigFromEnv', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env = { ...saved };
    delete process.env.APNS_KEY_ID;
    delete process.env.APNS_TEAM_ID;
    delete process.env.APNS_PRIVATE_KEY;
    delete process.env.APNS_BUNDLE_ID;
    delete process.env.APNS_PRODUCTION;
  });

  it('returns null when any required variable is missing', () => {
    expect(loadApnsConfigFromEnv()).toBeNull();
    process.env.APNS_KEY_ID = 'K';
    process.env.APNS_TEAM_ID = 'T';
    expect(loadApnsConfigFromEnv()).toBeNull();
  });

  it('un-escapes \\n in the private key, because secret managers flatten newlines', () => {
    process.env.APNS_KEY_ID = 'K';
    process.env.APNS_TEAM_ID = 'T';
    process.env.APNS_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----';
    const config = loadApnsConfigFromEnv();
    expect(config?.privateKeyPem).toContain('\n');
    expect(config?.privateKeyPem).not.toContain('\\n');
  });

  it('defaults to the sandbox host and the real bundle id', () => {
    process.env.APNS_KEY_ID = 'K';
    process.env.APNS_TEAM_ID = 'T';
    process.env.APNS_PRIVATE_KEY = 'pem';
    const config = loadApnsConfigFromEnv();
    expect(config?.production).toBe(false);
    expect(config?.bundleId).toBe('com.citrussports.app');
  });

  it('switches to production only on the exact string "true"', () => {
    process.env.APNS_KEY_ID = 'K';
    process.env.APNS_TEAM_ID = 'T';
    process.env.APNS_PRIVATE_KEY = 'pem';
    process.env.APNS_PRODUCTION = 'TRUE';
    expect(loadApnsConfigFromEnv()?.production).toBe(false);
    process.env.APNS_PRODUCTION = 'true';
    expect(loadApnsConfigFromEnv()?.production).toBe(true);
  });
});
