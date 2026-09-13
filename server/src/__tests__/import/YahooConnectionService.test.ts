import { describe, it, expect, vi } from 'vitest';
import { YahooConnectionService } from '../../services/import/YahooConnectionService';
import { YahooOAuth, YahooTokenError, type YahooTokenSet } from '../../import/yahoo/oauth';
import { NeedsCredentialsError } from '../../import/types';
import { FakeSupabase } from './fakeSupabase';

const KEY = 'a'.repeat(64);
const USER = 'user-1';
const CONFIG = { clientId: 'cid', clientSecret: 'cs', redirectUri: 'https://x/cb', stateSecret: 's' };

function tokenSet(over: Partial<YahooTokenSet> = {}): YahooTokenSet {
  return { accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: new Date(Date.now() + 3600_000).toISOString(), guid: 'GUID1', ...over };
}

function make(db = new FakeSupabase(), oauthOver: Partial<YahooOAuth> = {}, key = KEY) {
  const oauth = new YahooOAuth(CONFIG);
  Object.assign(oauth, oauthOver);
  return { db, svc: new YahooConnectionService(db as any, oauth, key), oauth };
}

describe('YahooConnectionService sealing', () => {
  it('round-trips and binds to the user', () => {
    const { svc } = make();
    const sealed = svc.seal(USER, 'refresh-token');
    expect(sealed).not.toContain('refresh-token');
    expect(sealed.split('.')).toHaveLength(3);
    expect(svc.unseal(USER, sealed)).toBe('refresh-token');
    expect(() => svc.unseal('user-2', sealed)).toThrow(/Could not unlock/);
    // Flip a byte in the middle of the ciphertext (the last base64url char can
    // carry padding bits, so changing it does not always change the bytes).
    const [nonce, tag, body] = sealed.split('.');
    const mid = Math.floor(body.length / 2);
    const tampered = `${nonce}.${tag}.${body.slice(0, mid)}${body[mid] === 'A' ? 'B' : 'A'}${body.slice(mid + 1)}`;
    expect(() => svc.unseal(USER, tampered)).toThrow(/Could not unlock/);
    expect(() => svc.unseal(USER, `${nonce}.${tag === 'AAAA' ? 'BBBB' : 'AAAA'}${tag.slice(4)}.${body}`)).toThrow(/Could not unlock/);
  });

  it('refuses to run without a 64-hex key', () => {
    const { svc } = make(new FakeSupabase(), {}, 'short');
    expect(svc.isConfigured()).toBe(false);
    expect(() => svc.seal(USER, 'x')).toThrow(/not configured/);
  });

  it('is configured only with both the OAuth app and the key', () => {
    expect(make().svc.isConfigured()).toBe(true);
    const unconfigured = new YahooConnectionService(new FakeSupabase() as any, new YahooOAuth({ ...CONFIG, clientId: '' }), KEY);
    expect(unconfigured.isConfigured()).toBe(false);
  });
});

describe('YahooConnectionService.connect / status / disconnect', () => {
  it('stores the sealed refresh token server-side and the connection metadata beside it', async () => {
    const { db, svc } = make(new FakeSupabase(), { exchangeCode: vi.fn(async () => tokenSet()) });
    const res = await svc.connect(USER, 'code-1');
    expect(res).toEqual({ guid: 'GUID1' });
    const tok = db.rows('yahoo_provider_tokens')[0];
    expect(tok).toMatchObject({ user_id: USER, yahoo_guid: 'GUID1' });
    expect(tok.sealed_token).not.toContain('refresh-1');
    expect(svc.unseal(USER, tok.sealed_token)).toBe('refresh-1');
    const conn = db.rows('oauth_connections')[0];
    expect(conn).toMatchObject({ user_id: USER, platform: 'yahoo', external_user_id: 'GUID1', scopes: 'fspt-r', revoked_at: null });
    expect(conn.granted_at).toBeTruthy();
    expect(JSON.stringify(db.tables)).not.toContain('access-1'); // access tokens are never persisted
    expect(await svc.status(USER)).toMatchObject({ connected: true, guid: 'GUID1', revokedAt: null });
  });

  it('reports not connected before connecting and after disconnecting', async () => {
    const { db, svc } = make(new FakeSupabase(), { exchangeCode: vi.fn(async () => tokenSet()) });
    expect(await svc.status(USER)).toEqual({ connected: false, guid: null, grantedAt: null, revokedAt: null });
    await svc.connect(USER, 'code');
    await svc.disconnect(USER);
    expect(db.rows('yahoo_provider_tokens')).toHaveLength(0);
    const status = await svc.status(USER);
    expect(status.connected).toBe(false);
    expect(status.revokedAt).toBeTruthy();
  });

  it('reconnecting after a disconnect revives the connection and keeps one row', async () => {
    const { db, svc } = make(new FakeSupabase(), { exchangeCode: vi.fn(async () => tokenSet()) });
    await svc.connect(USER, 'code');
    await svc.disconnect(USER);
    await svc.connect(USER, 'code2');
    expect(db.rows('oauth_connections')).toHaveLength(1);
    expect(db.rows('oauth_connections')[0].revoked_at).toBeNull();
    expect(db.rows('yahoo_provider_tokens')).toHaveLength(1);
  });

  it('a storage failure never leaks the token into the error', async () => {
    const db = new FakeSupabase();
    db.failNext = { table: 'yahoo_provider_tokens', op: 'upsert', error: { message: 'disk' } };
    const { svc } = make(db, { exchangeCode: vi.fn(async () => tokenSet()) });
    const err = await svc.connect(USER, 'code').catch((e) => e);
    expect(err.message).toBe('Could not retain the Yahoo connection');
    expect(err.message).not.toContain('refresh-1');
  });
});

describe('YahooConnectionService.tokenProvider', () => {
  it('refreshes on first use, persists the rotated refresh token, caches the access token', async () => {
    const refresh = vi.fn(async (rt: string) => tokenSet({ accessToken: `access-for-${rt}`, refreshToken: `${rt}-rotated` }));
    const { db, svc } = make(new FakeSupabase(), { exchangeCode: vi.fn(async () => tokenSet()), refresh });
    await svc.connect(USER, 'code');
    const provider = svc.tokenProvider(USER);
    expect(await provider.get()).toBe('access-for-refresh-1');
    expect(await provider.get()).toBe('access-for-refresh-1');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(svc.unseal(USER, db.rows('yahoo_provider_tokens')[0].sealed_token)).toBe('refresh-1-rotated');
    // granted_at is the original grant, not the refresh.
    const grantedAt = db.rows('oauth_connections')[0].granted_at;
    provider.invalidate();
    expect(await provider.get()).toBe('access-for-refresh-1-rotated');
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(db.rows('oauth_connections')[0].granted_at).toBe(grantedAt);
  });

  it('concurrent first calls share one refresh', async () => {
    const refresh = vi.fn(async () => tokenSet());
    const { svc } = make(new FakeSupabase(), { exchangeCode: vi.fn(async () => tokenSet()), refresh });
    await svc.connect(USER, 'code');
    const provider = svc.tokenProvider(USER);
    await Promise.all([provider.get(), provider.get(), provider.get()]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a token about to expire is refreshed', async () => {
    const refresh = vi.fn(async () => tokenSet({ expiresAt: new Date(Date.now() + 30_000).toISOString() }));
    const { svc } = make(new FakeSupabase(), { exchangeCode: vi.fn(async () => tokenSet()), refresh });
    await svc.connect(USER, 'code');
    const provider = svc.tokenProvider(USER);
    await provider.get();
    await provider.get();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('no connection: asks to connect, never calls Yahoo', async () => {
    const refresh = vi.fn();
    const { svc } = make(new FakeSupabase(), { refresh });
    const err = await svc.tokenProvider(USER).get().catch((e) => e);
    expect(err).toBeInstanceOf(NeedsCredentialsError);
    expect(err.message).toMatch(/Connect Yahoo/);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a dead grant disconnects and asks to connect again', async () => {
    const refresh = vi.fn(async () => { throw new YahooTokenError(400); });
    const { db, svc } = make(new FakeSupabase(), { exchangeCode: vi.fn(async () => tokenSet()), refresh });
    await svc.connect(USER, 'code');
    const err = await svc.tokenProvider(USER).get().catch((e) => e);
    expect(err).toBeInstanceOf(NeedsCredentialsError);
    expect(err.message).toMatch(/expired/);
    expect(db.rows('yahoo_provider_tokens')).toHaveLength(0);
    expect(db.rows('oauth_connections')[0].revoked_at).toBeTruthy();
  });

  it('a Yahoo outage is not treated as a dead grant', async () => {
    const refresh = vi.fn(async () => { throw new YahooTokenError(503); });
    const { db, svc } = make(new FakeSupabase(), { exchangeCode: vi.fn(async () => tokenSet()), refresh });
    await svc.connect(USER, 'code');
    const err = await svc.tokenProvider(USER).get().catch((e) => e);
    expect(err).toBeInstanceOf(YahooTokenError);
    expect(db.rows('yahoo_provider_tokens')).toHaveLength(1);
  });
});
