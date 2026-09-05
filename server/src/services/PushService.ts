import type { SupabaseClient } from '@supabase/supabase-js';
import { structuredLogger } from '@citrus/shared';
import { createPrivateKey, sign as cryptoSign, type KeyObject } from 'node:crypto';
import { connect as http2Connect, constants as H2, type ClientHttp2Session } from 'node:http2';

/**
 * PushService — APNs sender for draft-turn alerts ("you're on the clock").
 *
 * WHY THIS EXISTS, beyond the obvious: App Store guideline 4.2 rejects apps that
 * are "just a website in a box". A Capacitor shell needs at least one capability
 * the web cannot have. A push that fires the moment it becomes your turn is that
 * capability, and it is the feature users actually want from a draft app.
 *
 * NO NEW DEPENDENCIES, deliberately. APNs needs HTTP/2 and an ES256 JWT; both
 * are in the Node standard library (`node:http2`, `node:crypto`). The server
 * workspace has no entry in package-lock.json, so every added dependency is a
 * lockfile regeneration and a CI risk — a floor bump on `pg` already failed a
 * build on 2026-08-18. Zero deps means this ships without touching the lock.
 *
 * FAILURE POSTURE: every public method is total. If APNs credentials are absent
 * (local dev, CI, a staging deploy without secrets) `isConfigured()` is false and
 * `notifyOnTheClock` returns `{ sent: 0, skipped: true }` without throwing. The
 * caller is the draft engine's pick-deadline arm path — a push failure must never
 * be able to delay or break a pick.
 *
 * REQUIRED ENV (all four, or the service stays dormant):
 *   APNS_KEY_ID       10-char Key ID from the .p8 filename
 *   APNS_TEAM_ID      10-char Apple Team ID
 *   APNS_PRIVATE_KEY  contents of AuthKey_XXXXXXXXXX.p8 (PEM, \n-escaped is fine)
 * Optional:
 *   APNS_BUNDLE_ID    defaults to com.citrussports.app
 *   APNS_PRODUCTION   'true' -> api.push.apple.com, else sandbox host
 */

const PROD_HOST = 'api.push.apple.com';
const SANDBOX_HOST = 'api.sandbox.push.apple.com';
const DEFAULT_BUNDLE_ID = 'com.citrussports.app';

/** Apple rejects tokens older than 1h and rate-limits minting. Refresh at 50m. */
const JWT_TTL_MS = 50 * 60 * 1000;

/** A push that arrives after the pick clock expired is noise, not a nudge. */
const DEFAULT_EXPIRY_SECONDS = 120;

const REQUEST_TIMEOUT_MS = 5_000;

export interface ApnsConfig {
  keyId: string;
  teamId: string;
  bundleId: string;
  privateKeyPem: string;
  production: boolean;
}

export interface OnTheClockInput {
  leagueId: string;
  /** Overall pick number. Half of the dedupe key. */
  pickNumber: number;
  /** Team now on the clock; its owner is who we notify. */
  teamId: string;
  leagueName?: string | null;
  /** ISO deadline, used only for the notification body. */
  deadlineIso?: string | null;
}

export interface PushResult {
  sent: number;
  failed: number;
  skipped: boolean;
  reason?: string;
}

export function loadApnsConfigFromEnv(): ApnsConfig | null {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const raw = process.env.APNS_PRIVATE_KEY;
  if (!keyId || !teamId || !raw) {
    return null;
  }
  // Secret managers routinely flatten newlines; accept both forms.
  const privateKeyPem = raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
  return {
    keyId,
    teamId,
    bundleId: process.env.APNS_BUNDLE_ID || DEFAULT_BUNDLE_ID,
    privateKeyPem,
    production: process.env.APNS_PRODUCTION === 'true',
  };
}

export class PushService {
  private supabase: SupabaseClient;
  private config: ApnsConfig | null;
  private signingKey: KeyObject | null = null;
  private cachedJwt: { token: string; mintedAt: number } | null = null;
  private session: ClientHttp2Session | null = null;

  constructor(supabase: SupabaseClient, config: ApnsConfig | null = loadApnsConfigFromEnv()) {
    this.supabase = supabase;
    this.config = config;
    if (config) {
      try {
        this.signingKey = createPrivateKey(config.privateKeyPem);
      } catch (err) {
        // A malformed key is a deploy-time misconfiguration, not a runtime
        // condition. Log once and stay dormant rather than throwing on every pick.
        structuredLogger.error(
          `[push] APNS_PRIVATE_KEY could not be parsed — push disabled: ${(err as Error).message}`,
        );
        this.config = null;
      }
    }
  }

  isConfigured(): boolean {
    return this.config !== null && this.signingKey !== null;
  }

  /**
   * Notify the owner of the team that just came on the clock.
   *
   * Deduped on (league_id, pick_number) in public.push_deliveries. The engine
   * arms a pick deadline on a genuine turn change, but ALSO when a pod restarts
   * and replays the event log, and potentially from a second instance holding
   * the same lobby. Without the claim, a mid-draft deploy would re-notify
   * everyone. Exactly one team is on the clock per pick, so the pick number is
   * a sufficient key and the row carries no personal data.
   */
  async notifyOnTheClock(input: OnTheClockInput): Promise<PushResult> {
    if (!this.isConfigured()) {
      return { sent: 0, failed: 0, skipped: true, reason: 'not_configured' };
    }

    try {
      const claimed = await this.claimDelivery(input.leagueId, input.pickNumber);
      if (!claimed) {
        return { sent: 0, failed: 0, skipped: true, reason: 'already_delivered' };
      }

      const tokens = await this.tokensForTeamOwner(input.teamId);
      if (tokens === 'opted_out') {
        return { sent: 0, failed: 0, skipped: true, reason: 'opted_out' };
      }
      if (tokens.length === 0) {
        return { sent: 0, failed: 0, skipped: true, reason: 'no_devices' };
      }

      const payload = this.buildPayload(input);
      let sent = 0;
      let failed = 0;

      for (const token of tokens) {
        const result = await this.sendToToken(token, payload);
        if (result.ok) {
          sent += 1;
        } else {
          failed += 1;
          if (result.prune) {
            await this.pruneToken(token, result.reason);
          }
        }
      }

      structuredLogger.info(
        `[push] on_the_clock leagueId=${input.leagueId} pick=${input.pickNumber} sent=${sent} failed=${failed}`,
      );
      return { sent, failed, skipped: false };
    } catch (err) {
      // Total by contract: the draft must not care that a push failed.
      structuredLogger.error(
        `[push] on_the_clock threw leagueId=${input.leagueId} pick=${input.pickNumber}: ${(err as Error).message}`,
      );
      return { sent: 0, failed: 0, skipped: true, reason: 'error' };
    }
  }

  /** Register or refresh a device token. Called from the API on app launch. */
  async registerDevice(userId: string, token: string, platform = 'ios'): Promise<{ error: string | null }> {
    const { error } = await this.supabase
      .from('device_tokens')
      .upsert(
        { user_id: userId, token, platform, last_seen_at: new Date().toISOString() },
        { onConflict: 'token' },
      );
    return { error: error ? error.message : null };
  }

  /**
   * Claim the right to send for this pick. Returns true only for the caller that
   * actually inserted the row, so concurrent engine instances cannot double-send.
   */
  private async claimDelivery(leagueId: string, pickNumber: number): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('push_deliveries')
      .upsert({ league_id: leagueId, pick_number: pickNumber }, {
        onConflict: 'league_id,pick_number',
        ignoreDuplicates: true,
      })
      .select('pick_number');

    if (error) {
      structuredLogger.warn(`[push] claim failed leagueId=${leagueId} pick=${pickNumber}: ${error.message}`);
      return false;
    }
    // ignoreDuplicates means a losing race returns zero rows.
    return Array.isArray(data) && data.length > 0;
  }

  /** The owner's device tokens, or `'opted_out'` when the owner turned the push off. */
  private async tokensForTeamOwner(teamId: string): Promise<string[] | 'opted_out'> {
    const { data: team, error: teamError } = await this.supabase
      .from('teams')
      .select('owner_id')
      .eq('id', teamId)
      .maybeSingle();

    if (teamError || !team?.owner_id) {
      // Unowned seat (AI team) — nobody to nudge. Not an error.
      return [];
    }

    // The manager's own switch (profiles.push_notifications, 2026-09-04).
    // Read before the tokens: an opted-out owner with three registered
    // devices gets nothing, and the log says why. A read error is treated
    // as opted IN — the column defaults true and a nudge nobody asked to
    // stop is the smaller failure during a draft.
    const { data: profile, error: profileError } = await this.supabase
      .from('profiles')
      .select('push_notifications')
      .eq('id', team.owner_id)
      .maybeSingle();
    if (!profileError && profile && profile.push_notifications === false) {
      structuredLogger.info(`[push] owner opted out userId=${team.owner_id} teamId=${teamId}`);
      return 'opted_out';
    }

    const { data, error } = await this.supabase
      .from('device_tokens')
      .select('token')
      .eq('user_id', team.owner_id);

    if (error || !data) {
      return [];
    }
    return data.map((row: { token: string }) => row.token).filter(Boolean);
  }

  private async pruneToken(token: string, reason?: string): Promise<void> {
    structuredLogger.info(`[push] pruning dead token reason=${reason ?? 'unknown'}`);
    await this.supabase.from('device_tokens').delete().eq('token', token);
  }

  private buildPayload(input: OnTheClockInput): Record<string, unknown> {
    const league = input.leagueName?.trim();
    return {
      aps: {
        alert: {
          title: "You're on the clock",
          body: league ? `It's your pick in ${league}.` : 'It’s your turn to pick.',
        },
        sound: 'default',
        'interruption-level': 'time-sensitive',
      },
      // Consumed by the tap handler to deep-link straight into the draft room.
      leagueId: input.leagueId,
      pickNumber: input.pickNumber,
      deadline: input.deadlineIso ?? null,
      type: 'draft_on_the_clock',
    };
  }

  /**
   * ES256 JWT for APNs. Apple wants the JOSE fixed-width R||S signature, not
   * DER — `dsaEncoding: 'ieee-p1363'` is exactly that, which is why this needs
   * no JWT library.
   */
  private currentJwt(): string {
    const now = Date.now();
    if (this.cachedJwt && now - this.cachedJwt.mintedAt < JWT_TTL_MS) {
      return this.cachedJwt.token;
    }
    const config = this.config;
    const key = this.signingKey;
    if (!config || !key) {
      throw new Error('push not configured');
    }

    const header = { alg: 'ES256', kid: config.keyId };
    const claims = { iss: config.teamId, iat: Math.floor(now / 1000) };
    const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
    const signature = cryptoSign('sha256', Buffer.from(signingInput), {
      key,
      dsaEncoding: 'ieee-p1363',
    });
    const token = `${signingInput}.${signature.toString('base64url')}`;
    this.cachedJwt = { token, mintedAt: now };
    return token;
  }

  private getSession(): ClientHttp2Session {
    if (this.session && !this.session.closed && !this.session.destroyed) {
      return this.session;
    }
    const host = this.config?.production ? PROD_HOST : SANDBOX_HOST;
    const session = http2Connect(`https://${host}`);
    session.on('error', (err) => {
      structuredLogger.warn(`[push] apns session error: ${err.message}`);
    });
    // Never let a dead session wedge the next send.
    session.on('close', () => {
      if (this.session === session) {
        this.session = null;
      }
    });
    this.session = session;
    return session;
  }

  private sendToToken(
    token: string,
    payload: Record<string, unknown>,
  ): Promise<{ ok: boolean; status?: number; reason?: string; prune?: boolean }> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (r: { ok: boolean; status?: number; reason?: string; prune?: boolean }) => {
        if (!settled) {
          settled = true;
          resolve(r);
        }
      };

      try {
        const body = Buffer.from(JSON.stringify(payload));
        const stream = this.getSession().request({
          [H2.HTTP2_HEADER_METHOD]: 'POST',
          [H2.HTTP2_HEADER_PATH]: `/3/device/${token}`,
          authorization: `bearer ${this.currentJwt()}`,
          'apns-topic': this.config?.bundleId ?? DEFAULT_BUNDLE_ID,
          'apns-push-type': 'alert',
          'apns-priority': '10',
          'apns-expiration': String(Math.floor(Date.now() / 1000) + DEFAULT_EXPIRY_SECONDS),
          'content-type': 'application/json',
          'content-length': body.length,
        });

        stream.setTimeout(REQUEST_TIMEOUT_MS, () => {
          stream.close();
          done({ ok: false, reason: 'timeout' });
        });

        let status = 0;
        let raw = '';
        stream.on('response', (headers) => {
          status = Number(headers[H2.HTTP2_HEADER_STATUS]) || 0;
        });
        stream.on('data', (chunk) => {
          raw += chunk;
        });
        stream.on('end', () => {
          if (status === 200) {
            done({ ok: true, status });
            return;
          }
          let reason = raw;
          try {
            reason = (JSON.parse(raw) as { reason?: string }).reason ?? raw;
          } catch {
            /* keep the raw body */
          }
          // 410 Unregistered and 400 BadDeviceToken mean the token is dead for
          // good — the user deleted the app or reinstalled. Drop it so we stop
          // paying for it on every pick.
          const prune = status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered';
          done({ ok: false, status, reason, prune });
        });
        stream.on('error', (err) => {
          done({ ok: false, reason: err.message });
        });

        stream.end(body);
      } catch (err) {
        done({ ok: false, reason: (err as Error).message });
      }
    });
  }

  /** Release the HTTP/2 session. Call on graceful shutdown. */
  close(): void {
    if (this.session && !this.session.closed) {
      this.session.close();
    }
    this.session = null;
  }
}

function b64url(input: string): string {
  return Buffer.from(input).toString('base64url');
}

let sharedInstance: PushService | null = null;

/**
 * Process-wide PushService.
 *
 * The draft engine calls this from every pick-clock arm, across every lobby. A
 * per-lobby instance would mean a separate HTTP/2 session to Apple per league
 * and a fresh JWT mint per pick — Apple rate-limits token minting, which is the
 * reason the JWT is cached for 50 minutes in the first place. One session, one
 * cached token, shared.
 */
export function getPushService(supabase: SupabaseClient): PushService {
  if (!sharedInstance) {
    sharedInstance = new PushService(supabase);
  }
  return sharedInstance;
}

/** Test seam — drops the singleton so a suite can install its own. */
export function resetPushService(): void {
  sharedInstance?.close();
  sharedInstance = null;
}
