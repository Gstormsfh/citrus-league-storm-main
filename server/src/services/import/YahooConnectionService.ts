/**
 * A user's Yahoo connection: the OAuth exchange, the sealed refresh token,
 * and access tokens on demand.
 *
 * Same posture as AppleAccountService: the refresh token is sealed with
 * AES-256-GCM under YAHOO_TOKEN_ENCRYPTION_KEY (held only by the API server,
 * user id as additional authenticated data) and stored in a service-role-only
 * table. Yahoo rotates refresh tokens on every use, so every refresh re-seals
 * the row. Access tokens live an hour and exist only in memory. Nothing in
 * this file writes a token to a log, an error message, or an audit event.
 *
 * Writes go through the admin client because the caller has already been
 * proven by the route's JWT check and yahoo_provider_tokens has no client
 * policy by design.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { YahooOAuth, YahooTokenError, type YahooTokenSet } from '../../import/yahoo/oauth';
import type { AccessTokenProvider } from '../../import/yahoo/client';
import { NeedsCredentialsError } from '../../import/types';

export interface YahooConnectionStatus {
  connected: boolean;
  guid: string | null;
  grantedAt: string | null;
  revokedAt: string | null;
}

const CONNECTION_COLUMNS = 'id, user_id, platform, external_user_id, access_token_expires_at, scopes, granted_at, revoked_at';

export function yahooEncryptionKey(env: NodeJS.ProcessEnv = process.env): string {
  return env.YAHOO_TOKEN_ENCRYPTION_KEY || '';
}

export class YahooConnectionService {
  constructor(
    private readonly admin: SupabaseClient,
    private readonly oauth: YahooOAuth = new YahooOAuth(),
    private readonly encryptionKey: string = yahooEncryptionKey(),
  ) {}

  isConfigured(): boolean {
    return this.oauth.isConfigured() && /^[a-f0-9]{64}$/i.test(this.encryptionKey);
  }

  private key(): Buffer {
    if (!/^[a-f0-9]{64}$/i.test(this.encryptionKey)) throw new Error('Yahoo import is not configured');
    return Buffer.from(this.encryptionKey, 'hex');
  }

  seal(userId: string, token: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), nonce);
    cipher.setAAD(Buffer.from(userId));
    const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return [nonce, cipher.getAuthTag(), encrypted].map((p) => p.toString('base64url')).join('.');
  }

  unseal(userId: string, sealed: string): string {
    const [nonce, tag, ciphertext] = String(sealed).split('.').map((p) => Buffer.from(p, 'base64url'));
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key(), nonce);
      decipher.setAAD(Buffer.from(userId));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('Could not unlock the Yahoo connection');
    }
  }

  /** Redeem the authorization code and store the connection. */
  async connect(userId: string, code: string): Promise<{ guid: string }> {
    const tokens = await this.oauth.exchangeCode(code);
    await this.persist(userId, tokens, { firstGrant: true });
    return { guid: tokens.guid };
  }

  private async persist(userId: string, tokens: YahooTokenSet, opts: { firstGrant: boolean }): Promise<void> {
    const sealed = this.seal(userId, tokens.refreshToken);
    const now = new Date().toISOString();
    const { error: tErr } = await this.admin
      .from('yahoo_provider_tokens')
      .upsert({ user_id: userId, yahoo_guid: tokens.guid, sealed_token: sealed, updated_at: now }, { onConflict: 'user_id' });
    if (tErr) throw new Error('Could not retain the Yahoo connection');
    const row: Record<string, unknown> = {
      user_id: userId, platform: 'yahoo', external_user_id: tokens.guid,
      access_token_expires_at: tokens.expiresAt, scopes: 'fspt-r', revoked_at: null, updated_at: now,
    };
    if (opts.firstGrant) row.granted_at = now;
    const { error: cErr } = await this.admin.from('oauth_connections').upsert(row, { onConflict: 'user_id,platform' });
    if (cErr) throw new Error('Could not record the Yahoo connection');
  }

  async status(userId: string): Promise<YahooConnectionStatus> {
    const { data, error } = await this.admin
      .from('oauth_connections')
      .select(CONNECTION_COLUMNS)
      .eq('user_id', userId)
      .eq('platform', 'yahoo')
      .maybeSingle();
    if (error) throw new Error(`oauth_connections read failed: ${error.message}`);
    const row = data as { external_user_id: string; granted_at: string; revoked_at: string | null } | null;
    if (!row) return { connected: false, guid: null, grantedAt: null, revokedAt: null };
    return { connected: row.revoked_at == null, guid: row.external_user_id, grantedAt: row.granted_at, revokedAt: row.revoked_at };
  }

  /** Forget the refresh token and mark the connection dead. Yahoo-side consent is revoked by the user at Yahoo. */
  async disconnect(userId: string): Promise<void> {
    const { error: dErr } = await this.admin.from('yahoo_provider_tokens').delete().eq('user_id', userId);
    if (dErr) throw new Error('Could not remove the Yahoo connection');
    const { error: uErr } = await this.admin
      .from('oauth_connections')
      .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('platform', 'yahoo');
    if (uErr) throw new Error('Could not record the Yahoo disconnect');
  }

  /**
   * An access token source for one user, for the life of one job. The first
   * get() refreshes (the stored refresh token is all we keep); later calls
   * reuse the access token until a minute before it expires or a 401 asks
   * for a new one.
   */
  tokenProvider(userId: string): AccessTokenProvider {
    let cached: { token: string; expiresAt: number } | null = null;
    let inflight: Promise<string> | null = null;
    const refresh = async (): Promise<string> => {
      const { data, error } = await this.admin.from('yahoo_provider_tokens').select('sealed_token').eq('user_id', userId).maybeSingle();
      if (error) throw new Error(`yahoo_provider_tokens read failed: ${error.message}`);
      const row = data as { sealed_token: string } | null;
      if (!row) throw new NeedsCredentialsError(0, 'Yahoo is not connected for this account. Connect Yahoo to import.');
      let tokens: YahooTokenSet;
      try {
        tokens = await this.oauth.refresh(this.unseal(userId, row.sealed_token));
      } catch (e) {
        if (e instanceof YahooTokenError && e.grantGone) {
          // The grant is dead (revoked at Yahoo, or a rotated token we never saw). Say so once and forget it.
          await this.disconnect(userId);
          throw new NeedsCredentialsError(0, 'Your Yahoo connection has expired. Connect Yahoo again to continue.');
        }
        throw e;
      }
      await this.persist(userId, tokens, { firstGrant: false }); // Yahoo rotated the refresh token
      cached = { token: tokens.accessToken, expiresAt: Date.parse(tokens.expiresAt) };
      return tokens.accessToken;
    };
    return {
      get: async () => {
        if (cached && cached.expiresAt - Date.now() > 60_000) return cached.token;
        if (!inflight) inflight = refresh().finally(() => { inflight = null; });
        return inflight;
      },
      invalidate: () => { cached = null; },
    };
  }
}
