/**
 * Yahoo OAuth 2.0, authorization-code grant, read-only fantasy scope.
 *
 * The browser goes to Yahoo, Yahoo sends it back to the web app's callback
 * page with a code, the page hands the code to the API with the user's own
 * JWT. So the API never sees a browser session and needs no server-side
 * OAuth state store: `state` is an HMAC over the user id and a timestamp,
 * signed with SUPABASE_JWT_SECRET (the one auth surface, per ADR-001), and
 * verified against the user the JWT proves. A code minted for one user
 * cannot be redeemed by another, and a stale state is refused.
 *
 * Token facts (Yahoo docs, third-party SDKs): the access token lives an hour;
 * the refresh token is rotated on every refresh, so the caller must persist
 * the one that comes back; `xoauth_yahoo_guid` is the user's stable account
 * id and the key every manager entry in a league carries.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const YAHOO_AUTHORIZE_URL = 'https://api.login.yahoo.com/oauth2/request_auth';
export const YAHOO_TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';
const STATE_TTL_MS = 15 * 60 * 1000;

export interface YahooOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Signs the OAuth state. SUPABASE_JWT_SECRET in production. */
  stateSecret: string;
}

export function yahooOAuthConfig(env: NodeJS.ProcessEnv = process.env): YahooOAuthConfig {
  return {
    clientId: env.YAHOO_CLIENT_ID || '',
    clientSecret: env.YAHOO_CLIENT_SECRET || '',
    redirectUri: env.YAHOO_REDIRECT_URI || '',
    stateSecret: env.SUPABASE_JWT_SECRET || '',
  };
}

export interface YahooTokenSet {
  accessToken: string;
  refreshToken: string;
  /** ISO timestamp. */
  expiresAt: string;
  guid: string;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Yahoo refused a token request. 400/401 mean the grant is gone (user revoked at Yahoo, or a stale rotated token). */
export class YahooTokenError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Yahoo token request failed (${status})`);
    this.name = 'YahooTokenError';
    this.status = status;
  }
  get grantGone(): boolean { return this.status === 400 || this.status === 401; }
}

export class YahooOAuth {
  constructor(private readonly config: YahooOAuthConfig = yahooOAuthConfig(), private readonly fetchImpl: FetchLike = (u, i) => fetch(u, i)) {}

  isConfigured(): boolean {
    return Boolean(this.config.clientId && this.config.clientSecret && this.config.redirectUri && this.config.stateSecret);
  }

  /** Where to send the browser. */
  authorizeUrl(userId: string): { url: string; state: string } {
    const state = this.mintState(userId);
    const qs = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      state,
    });
    return { url: `${YAHOO_AUTHORIZE_URL}?${qs.toString()}`, state };
  }

  mintState(userId: string, now = Date.now()): string {
    const payload = Buffer.from(JSON.stringify({ u: userId, t: now, n: randomBytes(8).toString('base64url') })).toString('base64url');
    return `${payload}.${this.sign(payload)}`;
  }

  /** True only for a state this server minted for this user within the window. */
  verifyState(state: string | null | undefined, userId: string, now = Date.now()): boolean {
    if (!state || !this.config.stateSecret) return false;
    const dot = state.lastIndexOf('.');
    if (dot <= 0) return false;
    const payload = state.slice(0, dot);
    const sig = state.slice(dot + 1);
    const expected = this.sign(payload);
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
    try {
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { u?: string; t?: number };
      if (parsed.u !== userId || typeof parsed.t !== 'number') return false;
      return now - parsed.t >= 0 && now - parsed.t <= STATE_TTL_MS;
    } catch {
      return false;
    }
  }

  async exchangeCode(code: string): Promise<YahooTokenSet> {
    return this.tokenRequest({ grant_type: 'authorization_code', redirect_uri: this.config.redirectUri, code });
  }

  async refresh(refreshToken: string): Promise<YahooTokenSet> {
    return this.tokenRequest({ grant_type: 'refresh_token', redirect_uri: this.config.redirectUri, refresh_token: refreshToken });
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.config.stateSecret).update(payload).digest('base64url');
  }

  private async tokenRequest(form: Record<string, string>): Promise<YahooTokenSet> {
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');
    const res = await this.fetchImpl(YAHOO_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status !== 200) {
      // Never echo the body: it can carry the code or token in an error description.
      throw new YahooTokenError(res.status);
    }
    const body = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number | string; xoauth_yahoo_guid?: string };
    if (!body.access_token || !body.refresh_token) throw new Error('Yahoo token response was incomplete');
    const expiresIn = Number(body.expires_in ?? 3600);
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: new Date(Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000).toISOString(),
      guid: String(body.xoauth_yahoo_guid ?? ''),
    };
  }
}
