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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto';
import {
  PushService,
  loadApnsConfigFromEnv,
  loadFcmConfigFromEnv,
  type ApnsConfig,
  type FcmConfig,
} from '../services/PushService';
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

/** A real RSA service-account key, so the assertion below is genuinely verified. */
function testFcmConfig(): FcmConfig {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    projectId: 'citrus-fantasy-prod',
    clientEmail: 'push@citrus-fantasy-prod.iam.gserviceaccount.com',
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
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
    // This assertion ends at the database claim. Keep recipient resolution
    // deterministic so it never opens a real APNs socket after winning it.
    const supabase = makeSupabase({
      device_tokens: createChain({ data: [], error: null }),
    });
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

  it('sends nothing when the owner turned the push off, and says so, without reading the devices', async () => {
    // profiles.push_notifications (2026-09-04): the account screen's one real
    // notification switch. Off means no nudge even with registered devices,
    // and the reason is distinct from "no devices" so the log can tell them apart.
    const supabase = makeSupabase({
      profiles: createChain({ data: { push_notifications: false }, error: null }),
    });
    const svc = new PushService(supabase, testConfig());

    const result = await svc.notifyOnTheClock(input);
    expect(result).toEqual({ sent: 0, failed: 0, skipped: true, reason: 'opted_out' });
    const from = (supabase as unknown as { from: ReturnType<typeof vi.fn> }).from;
    expect(from.mock.calls.map((c) => c[0])).not.toContain('device_tokens');
  });

  it('treats a missing or unreadable profile as opted in — the column defaults true', async () => {
    const opted = makeSupabase({ profiles: createChain({ data: null, error: { message: 'boom' } }) });
    const svc = new PushService(opted, testConfig());
    // Reaches the device lookup: makeSupabase's default device has one token,
    // and the APNs session is not mocked, so the send itself fails — which is
    // the point: the opt-out did not stop it.
    const result = await svc.notifyOnTheClock(input);
    expect(result.reason).not.toBe('opted_out');
    const from = (opted as unknown as { from: ReturnType<typeof vi.fn> }).from;
    expect(from.mock.calls.map((c) => c[0])).toContain('device_tokens');
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

/**
 * ANDROID (2026-09-09). Apple will not deliver to a Pixel, so the token's
 * `platform` column picks the transport. What is pinned here is that routing
 * and the independence of the two roads: an iOS-only deploy must not start
 * failing because an Android device registered, and vice versa.
 */
describe('PushService — transport routing by platform', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function androidDevices(rows: Array<{ token: string; platform?: string }>) {
    return makeSupabase({ device_tokens: createChain({ data: rows, error: null }) });
  }

  it('sends an Android token through FCM, not APNs', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({ access_token: 'ya29.test' }), { status: 200 });
      }
      calls.push({ url: href, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ name: 'projects/p/messages/1' }), { status: 200 });
    }) as typeof fetch;

    const service = new PushService(
      androidDevices([{ token: 'pixel-token', platform: 'android' }]),
      testConfig(),
      testFcmConfig(),
    );
    const result = await service.notifyOnTheClock(input);

    expect(result).toMatchObject({ sent: 1, failed: 0, skipped: false });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/v1/projects/citrus-fantasy-prod/messages:send');
    const message = (calls[0].body as { message: Record<string, unknown> }).message;
    expect(message).toMatchObject({ token: 'pixel-token' });
    // FCM 400s the whole send if any data value is not a string.
    for (const value of Object.values((message as { data: Record<string, unknown> }).data)) {
      expect(typeof value).toBe('string');
    }
  });

  it('skips an Android device when only APNs is configured, and does not call it a failure', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('fetch must not be called without FCM credentials');
    }) as typeof fetch;

    const service = new PushService(
      androidDevices([{ token: 'pixel-token', platform: 'android' }]),
      testConfig(),
      null,
    );
    const result = await service.notifyOnTheClock(input);
    expect(result).toMatchObject({ sent: 0, failed: 0, skipped: false });
  });

  it('skips an iPhone when only FCM is configured, so one credential cannot disable the other', async () => {
    const service = new PushService(
      androidDevices([{ token: 'iphone-token', platform: 'ios' }]),
      null,
      testFcmConfig(),
    );
    expect(service.isConfigured()).toBe(true);
    expect(service.isApnsConfigured()).toBe(false);
    const result = await service.notifyOnTheClock(input);
    expect(result).toMatchObject({ sent: 0, failed: 0, skipped: false });
  });

  it('reads a legacy row with no platform as iOS, never as Android', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('a legacy token must not be mailed to Google');
    }) as typeof fetch;
    // No APNs config, so the send is skipped before any socket opens; what is
    // being pinned is which road it was NOT put on.
    const service = new PushService(androidDevices([{ token: 'legacy' }]), null, testFcmConfig());
    const result = await service.notifyOnTheClock(input);
    expect(result).toMatchObject({ sent: 0, failed: 0 });
  });

  it('prunes an UNREGISTERED Android token, the FCM equivalent of APNs 410', async () => {
    const deleted: string[] = [];
    const supabase = makeSupabase({
      device_tokens: createChain({ data: [{ token: 'dead-pixel', platform: 'android' }], error: null }),
    });
    (supabase as unknown as { from: (t: string) => unknown }).from = vi.fn((table: string) => {
      if (table === 'device_tokens') {
        return {
          select: () => ({ eq: async () => ({ data: [{ token: 'dead-pixel', platform: 'android' }], error: null }) }),
          delete: () => ({ eq: async (_col: string, value: string) => { deleted.push(value); return { error: null }; } }),
        };
      }
      return (supabase as unknown as { _tables: Record<string, unknown> })._tables[table] ?? createChain();
    });

    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({ access_token: 'ya29.test' }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { status: 'UNREGISTERED' } }), { status: 404 });
    }) as typeof fetch;

    const service = new PushService(supabase, testConfig(), testFcmConfig());
    const result = await service.notifyOnTheClock(input);
    expect(result).toMatchObject({ sent: 0, failed: 1 });
    expect(deleted).toEqual(['dead-pixel']);
  });

  it('mints a verifiable RS256 assertion and caches the access token', async () => {
    const config = testFcmConfig();
    let assertion = '';
    let tokenExchanges = 0;
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('oauth2.googleapis.com')) {
        tokenExchanges += 1;
        assertion = new URLSearchParams(String(init?.body)).get('assertion') ?? '';
        return new Response(JSON.stringify({ access_token: 'ya29.test' }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const service = new PushService(
      androidDevices([{ token: 'pixel-token', platform: 'android' }]),
      null,
      config,
    );
    await service.notifyOnTheClock(input);
    await service.notifyOnTheClock({ ...input, pickNumber: 5 });

    // One mint for two picks: Google rate-limits the exchange, which is the
    // whole reason the token is cached.
    expect(tokenExchanges).toBe(1);

    const [header, claims, signature] = assertion.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toMatchObject({ alg: 'RS256' });
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toMatchObject({
      iss: config.clientEmail,
      aud: 'https://oauth2.googleapis.com/token',
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
    });
    const verifier = createVerify('sha256');
    verifier.update(`${header}.${claims}`);
    expect(
      verifier.verify(createPublicKey(config.privateKeyPem), Buffer.from(signature, 'base64url')),
    ).toBe(true);
  });
});

describe('loadFcmConfigFromEnv', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env = { ...saved };
    delete process.env.FCM_PROJECT_ID;
    delete process.env.FCM_CLIENT_EMAIL;
    delete process.env.FCM_PRIVATE_KEY;
    delete process.env.K_SERVICE;
  });

  it('returns null without a project id, whatever else is set', () => {
    expect(loadFcmConfigFromEnv()).toBeNull();
    process.env.K_SERVICE = 'citrus-api';
    expect(loadFcmConfigFromEnv()).toBeNull();
  });

  /**
   * The org forbids service-account key creation
   * (constraints/iam.disableServiceAccountKeyCreation), so production has no
   * key to give. On Cloud Run the project id alone is enough: the instance
   * mints its own token. OFF Cloud Run there is no metadata server, and
   * claiming to be configured would turn a clean dormant state into a DNS
   * failure on every pick.
   */
  it('needs only the project id on Cloud Run, and refuses to pretend off it', () => {
    process.env.FCM_PROJECT_ID = 'citrus-fantasy-prod';
    expect(loadFcmConfigFromEnv()).toBeNull();

    process.env.K_SERVICE = 'citrus-api';
    expect(loadFcmConfigFromEnv()).toEqual({
      projectId: 'citrus-fantasy-prod',
      clientEmail: null,
      privateKeyPem: null,
    });
  });

  it('prefers an explicit key when one is supplied, on or off Cloud Run', () => {
    process.env.FCM_PROJECT_ID = 'citrus-fantasy-prod';
    process.env.FCM_CLIENT_EMAIL = 'push@example.iam.gserviceaccount.com';
    process.env.FCM_PRIVATE_KEY = 'pem';
    expect(loadFcmConfigFromEnv()).toMatchObject({
      clientEmail: 'push@example.iam.gserviceaccount.com',
      privateKeyPem: 'pem',
    });
  });

  it('ignores a half-supplied key rather than half-configuring', () => {
    process.env.FCM_PROJECT_ID = 'citrus-fantasy-prod';
    process.env.FCM_CLIENT_EMAIL = 'push@example.iam.gserviceaccount.com';
    expect(loadFcmConfigFromEnv()).toBeNull();
  });

  it('un-escapes \\n in the service-account key, same as the APNs one', () => {
    process.env.FCM_PROJECT_ID = 'citrus-fantasy-prod';
    process.env.FCM_CLIENT_EMAIL = 'push@example.iam.gserviceaccount.com';
    process.env.FCM_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----';
    const config = loadFcmConfigFromEnv();
    expect(config?.privateKeyPem).toContain('\n');
    expect(config?.privateKeyPem).not.toContain('\\n');
  });
});

describe('PushService — FCM credentials', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('mints from the Cloud Run metadata server when no key is supplied', async () => {
    let metadataCalls = 0;
    let sendAuth = '';
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.startsWith('http://metadata.google.internal/')) {
        metadataCalls += 1;
        // The header is not optional: the metadata server refuses without it.
        expect((init?.headers as Record<string, string>)['Metadata-Flavor']).toBe('Google');
        return new Response(JSON.stringify({ access_token: 'metadata-token' }), { status: 200 });
      }
      sendAuth = (init?.headers as Record<string, string>).authorization;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const service = new PushService(
      makeSupabase({ device_tokens: createChain({ data: [{ token: 'pixel', platform: 'android' }], error: null }) }),
      null,
      { projectId: 'citrus-fantasy-prod', clientEmail: null, privateKeyPem: null },
    );
    expect(service.isFcmConfigured()).toBe(true);

    const result = await service.notifyOnTheClock(input);
    expect(result).toMatchObject({ sent: 1, failed: 0 });
    expect(metadataCalls).toBe(1);
    expect(sendAuth).toBe('Bearer metadata-token');

    // Cached, like the assertion path.
    await service.notifyOnTheClock({ ...input, pickNumber: 6 });
    expect(metadataCalls).toBe(1);
  });

  it('a malformed explicit key disables Android push and leaves iOS alone', () => {
    const service = new PushService(makeSupabase(), testConfig(), {
      projectId: 'p',
      clientEmail: 'push@example.iam.gserviceaccount.com',
      privateKeyPem: 'not a pem',
    });
    expect(service.isFcmConfigured()).toBe(false);
    expect(service.isApnsConfigured()).toBe(true);
    expect(service.isConfigured()).toBe(true);
  });
});
