import { describe, it, expect, vi } from 'vitest';
import { YahooOAuth, YahooTokenError, YAHOO_AUTHORIZE_URL, YAHOO_TOKEN_URL, yahooOAuthConfig } from '../../import/yahoo/oauth';
import { YahooClient, YAHOO_API_BASE } from '../../import/yahoo/client';
import { NeedsCredentialsError, SourceThrottledError } from '../../import/types';
import { yahooRouter, yahooUserLeagues } from './yahooFixtures';

const CONFIG = { clientId: 'cid', clientSecret: 'csecret', redirectUri: 'https://citrusfantasysports.com/import/yahoo/callback', stateSecret: 'jwt-secret-for-tests' };

function tokenFetch(status = 200, body: unknown = { access_token: 'at', refresh_token: 'rt2', expires_in: 3600, token_type: 'bearer', xoauth_yahoo_guid: 'GUID1' }) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = async (url: string, init?: RequestInit) => { calls.push({ url, init }); return { status, json: async () => body } as unknown as Response; };
  return { impl, calls };
}

describe('YahooOAuth config', () => {
  it('reads the four env vars and is unconfigured when any is missing', () => {
    const full = yahooOAuthConfig({ YAHOO_CLIENT_ID: 'a', YAHOO_CLIENT_SECRET: 'b', YAHOO_REDIRECT_URI: 'https://x/cb', SUPABASE_JWT_SECRET: 's' } as NodeJS.ProcessEnv);
    expect(new YahooOAuth(full).isConfigured()).toBe(true);
    expect(new YahooOAuth(yahooOAuthConfig({ YAHOO_CLIENT_ID: 'a' } as NodeJS.ProcessEnv)).isConfigured()).toBe(false);
  });
});

describe('YahooOAuth state', () => {
  const oauth = new YahooOAuth(CONFIG, tokenFetch().impl);

  it('authorize URL points at Yahoo with the client id, redirect and a signed state', () => {
    const { url, state } = oauth.authorizeUrl('user-1');
    const u = new URL(url);
    expect(`${u.origin}${u.pathname}`).toBe(YAHOO_AUTHORIZE_URL);
    expect(u.searchParams.get('client_id')).toBe('cid');
    expect(u.searchParams.get('redirect_uri')).toBe(CONFIG.redirectUri);
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('state')).toBe(state);
    expect(url).not.toContain('csecret');
  });

  it('verifies only its own state, for the same user, within the window', () => {
    const now = Date.now();
    const state = oauth.mintState('user-1', now);
    expect(oauth.verifyState(state, 'user-1', now + 1000)).toBe(true);
    expect(oauth.verifyState(state, 'user-2', now + 1000)).toBe(false);
    expect(oauth.verifyState(state, 'user-1', now + 16 * 60 * 1000)).toBe(false);
    expect(oauth.verifyState(state, 'user-1', now - 1000)).toBe(false);
    expect(oauth.verifyState(`${state}x`, 'user-1', now)).toBe(false);
    expect(oauth.verifyState(state.slice(0, -3), 'user-1', now)).toBe(false);
    expect(oauth.verifyState('', 'user-1', now)).toBe(false);
    expect(oauth.verifyState(null, 'user-1', now)).toBe(false);
    // Another server with another secret cannot mint one.
    const other = new YahooOAuth({ ...CONFIG, stateSecret: 'different' });
    expect(oauth.verifyState(other.mintState('user-1', now), 'user-1', now)).toBe(false);
    expect(new YahooOAuth({ ...CONFIG, stateSecret: '' }).verifyState(state, 'user-1', now)).toBe(false);
  });

  it('two states for the same user differ (nonce)', () => {
    expect(oauth.mintState('u', 1)).not.toBe(oauth.mintState('u', 1));
  });
});

describe('YahooOAuth token requests', () => {
  it('exchanges a code with HTTP basic client auth and the redirect uri', async () => {
    const { impl, calls } = tokenFetch();
    const tokens = await new YahooOAuth(CONFIG, impl).exchangeCode('the-code');
    expect(tokens).toMatchObject({ accessToken: 'at', refreshToken: 'rt2', guid: 'GUID1' });
    expect(Date.parse(tokens.expiresAt) - Date.now()).toBeGreaterThan(3500 * 1000);
    expect(calls[0].url).toBe(YAHOO_TOKEN_URL);
    const init = calls[0].init!;
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('cid:csecret').toString('base64')}`);
    const form = new URLSearchParams(String(init.body));
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('the-code');
    expect(form.get('redirect_uri')).toBe(CONFIG.redirectUri);
  });

  it('refreshes with the refresh token grant', async () => {
    const { impl, calls } = tokenFetch();
    await new YahooOAuth(CONFIG, impl).refresh('old-rt');
    const form = new URLSearchParams(String(calls[0].init!.body));
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe('old-rt');
  });

  it('a refusal is a typed error that carries the status and never the body', async () => {
    const { impl } = tokenFetch(400, { error: 'invalid_grant', error_description: 'secret-ish detail' });
    const err = await new YahooOAuth(CONFIG, impl).refresh('dead').catch((e) => e);
    expect(err).toBeInstanceOf(YahooTokenError);
    expect(err.status).toBe(400);
    expect(err.grantGone).toBe(true);
    expect(err.message).not.toContain('secret-ish');
    expect(new YahooTokenError(503).grantGone).toBe(false);
  });

  it('an incomplete token response is an error', async () => {
    const { impl } = tokenFetch(200, { access_token: 'x' });
    await expect(new YahooOAuth(CONFIG, impl).exchangeCode('c')).rejects.toThrow(/incomplete/);
  });
});

describe('YahooClient', () => {
  it('builds JSON-format URLs and sends the bearer token', async () => {
    expect(YahooClient.url('league/453.l.1;out=settings')).toBe(`${YAHOO_API_BASE}/league/453.l.1;out=settings?format=json`);
    expect(YahooClient.url('/x?y=1')).toBe(`${YAHOO_API_BASE}/x?y=1&format=json`);
    const { client, requested } = yahooRouter({ 'users;use_login=1/games;game_codes=nhl;game_types=full/leagues': { status: 200, body: yahooUserLeagues('G', []) } });
    const res = await client.userLeagues();
    expect(requested).toEqual(['users;use_login=1/games;game_codes=nhl;game_types=full/leagues']);
    expect((res.content as any).users[0].guid).toBe('G');
    expect(res.endpoint).toContain('format=json');
    expect(res.raw).toEqual(yahooUserLeagues('G', []));
  });

  it('on a 401 it drops the cached token, refreshes once and retries', async () => {
    let token = 'stale';
    let gets = 0;
    const tokens = { get: async () => { gets += 1; return token; }, invalidate: () => { token = 'fresh'; } };
    const seen: string[] = [];
    const impl = async (_url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>).Authorization;
      seen.push(auth);
      return { status: auth === 'Bearer fresh' ? 200 : 401, json: async () => ({ fantasy_content: { ok: 1 } }) } as unknown as Response;
    };
    const client = new YahooClient(tokens, impl);
    const res = await client.get('league/1.l.1/metadata');
    expect(seen).toEqual(['Bearer stale', 'Bearer fresh']);
    expect(gets).toBe(2);
    expect(res.content).toEqual({ ok: 1 });
  });

  it('a second 401 means the connection is dead', async () => {
    const impl = async () => ({ status: 401, json: async () => null }) as unknown as Response;
    const err = await new YahooClient({ get: async () => 't', invalidate: () => undefined }, impl).get('x').catch((e) => e);
    expect(err).toBeInstanceOf(NeedsCredentialsError);
    expect(err.message).toMatch(/Connect Yahoo again/);
  });

  it('999 is throttling; 403 is not a member; anything else is a plain error', async () => {
    const mk = (status: number) => new YahooClient({ get: async () => 't', invalidate: () => undefined }, async () => ({ status, json: async () => null }) as unknown as Response);
    await expect(mk(999).get('x')).rejects.toBeInstanceOf(SourceThrottledError);
    await expect(mk(429).get('x')).rejects.toBeInstanceOf(SourceThrottledError);
    await expect(mk(403).get('x')).rejects.toBeInstanceOf(NeedsCredentialsError);
    await expect(mk(500).get('x')).rejects.toThrow(/Yahoo returned 500/);
  });

  it('players are requested in batches of 25 keys', async () => {
    const { client, requested } = yahooRouter({ 'league/453.l.1/players;player_keys=*': { status: 200, body: { fantasy_content: { league: [{ league_key: '453.l.1' }, { players: {} }] } } } });
    const keys = Array.from({ length: 60 }, (_, i) => `453.p.${i + 1}`);
    const pages = await client.players('453.l.1', keys);
    expect(pages).toHaveLength(3);
    expect(requested).toHaveLength(3);
    expect(requested[0].split(',').length).toBe(25);
    expect(requested[2].split(',').length).toBe(10);
  });

  it('paces calls when asked', async () => {
    vi.useFakeTimers();
    const impl = async () => ({ status: 200, json: async () => ({ fantasy_content: {} }) }) as unknown as Response;
    const client = new YahooClient({ get: async () => 't', invalidate: () => undefined }, impl, 250);
    let done = false;
    const p = client.get('x').then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(60);
    await p;
    expect(done).toBe(true);
    vi.useRealTimers();
  });
});
