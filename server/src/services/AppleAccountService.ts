import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { SupabaseClient, User } from '@supabase/supabase-js';

interface AppleConfiguration { clientId: string; clientSecret: string; encryptionKey: string }
export function appleConfiguration(): AppleConfiguration {
  return { clientId: process.env.APPLE_CLIENT_ID || '', clientSecret: process.env.APPLE_CLIENT_SECRET || '',
    encryptionKey: process.env.APPLE_TOKEN_ENCRYPTION_KEY || '' };
}

/** Private credential storage: caller must supply a freshly authenticated user.
 * No token or provider response is ever included in an error or audit event.
 */
export class AppleAccountService {
  constructor(private admin: SupabaseClient, private config = appleConfiguration(), private request: typeof fetch = fetch) {}

  private key() {
    if (!/^[a-f0-9]{64}$/i.test(this.config.encryptionKey) || !this.config.clientId || !this.config.clientSecret) {
      throw new Error('Apple account cleanup is not configured');
    }
    return Buffer.from(this.config.encryptionKey, 'hex');
  }

  async storeToken(user: User, refreshToken: string) {
    const key = this.key();
    const identity = user.identities?.find((entry) => entry.provider === 'apple');
    const subject = identity?.identity_data?.sub;
    if (typeof subject !== 'string') throw new Error('Apple identity required');
    // Ask Apple to validate the refresh token, then bind its subject to the
    // server-authenticated identity. Never trust a client-supplied ID token.
    const response = await this.request('https://appleid.apple.com/auth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret,
        grant_type: 'refresh_token', refresh_token: refreshToken }), signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Apple token validation failed');
    const result: { id_token?: string; refresh_token?: string } = await response.json();
    let claims: { sub?: string; aud?: string; iss?: string; exp?: number };
    try { claims = JSON.parse(Buffer.from(result.id_token!.split('.')[1], 'base64url').toString()); }
    catch { throw new Error('Apple identity validation failed'); }
    // These claims come directly from Apple's HTTPS token endpoint, not the browser.
    if (claims.sub !== subject || claims.aud !== this.config.clientId || claims.iss !== 'https://appleid.apple.com'
      || typeof claims.exp !== 'number' || claims.exp <= Date.now() / 1000) throw new Error('Apple identity validation failed');
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(user.id));
    const encrypted = Buffer.concat([cipher.update(result.refresh_token || refreshToken, 'utf8'), cipher.final()]);
    const sealed = [nonce, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
    const { error } = await this.admin.from('apple_provider_tokens').upsert({ user_id: user.id,
      client_id: this.config.clientId, sealed_token: sealed, updated_at: new Date().toISOString() });
    if (error) throw new Error('Could not retain Apple cleanup token');
  }

  async revoke(user: User): Promise<'revoked' | 'manual' | 'not_applicable'> {
    if (!user.identities?.some((entry) => entry.provider === 'apple')) return 'not_applicable';
    const { data, error } = await this.admin.from('apple_provider_tokens').select('client_id,sealed_token')
      .eq('user_id', user.id).maybeSingle();
    if (error) throw new Error('Could not read Apple cleanup status');
    // Older accounts may predate secure token retention. Apple TN3194 permits
    // deletion with manual revocation guidance when the token is unavailable.
    if (!data) return 'manual';
    const key = this.key();
    if (data.client_id !== this.config.clientId) throw new Error('Apple client configuration changed');
    const [nonce, tag, ciphertext] = String(data.sealed_token).split('.').map((part) => Buffer.from(part, 'base64url'));
    let token: string;
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAAD(Buffer.from(user.id));
      decipher.setAuthTag(tag);
      token = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch { throw new Error('Could not unlock Apple cleanup token'); }
    const response = await this.request('https://appleid.apple.com/auth/revoke', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret,
        token, token_type_hint: 'refresh_token' }), signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Apple could not revoke access. Please retry deletion.');
    // Keep the encrypted row until account deletion commits (FK cascade), so a
    // later storage/DB failure leaves a repeatable cleanup path.
    return 'revoked';
  }
}
