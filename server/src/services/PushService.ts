import type { SupabaseClient } from '@supabase/supabase-js';
import {
  structuredLogger,
  isCategoryEnabled,
  type NotificationCategory,
  type NotificationPreferences,
} from '@citrus/shared';
import { createPrivateKey, sign as cryptoSign, type KeyObject } from 'node:crypto';
import { connect as http2Connect, constants as H2, type ClientHttp2Session } from 'node:http2';

/**
 * PushService — push sender for draft-turn alerts ("you're on the clock"),
 * over APNs for iOS devices and FCM for Android ones.
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
 * TWO TRANSPORTS, ONE CONTRACT (FCM added 2026-09-09 for the Play build).
 * Apple will not deliver to an Android device and Google will not deliver to an
 * iPhone, so the token's `platform` column picks the road. The transports are
 * configured INDEPENDENTLY: iOS-only credentials keep working exactly as they
 * did, Android tokens are then skipped with a reason rather than failing, and
 * the reverse holds too. Neither can break the other, and neither can break a
 * pick.
 *
 * APNs ENV (all three, or iOS push stays dormant):
 *   APNS_KEY_ID       10-char Key ID from the .p8 filename
 *   APNS_TEAM_ID      10-char Apple Team ID
 *   APNS_PRIVATE_KEY  contents of AuthKey_XXXXXXXXXX.p8 (PEM, \n-escaped is fine)
 * Optional:
 *   APNS_BUNDLE_ID    defaults to com.citrussports.app
 *   APNS_PRODUCTION   'true' -> api.push.apple.com, else sandbox host
 *
 * FCM ENV:
 *   FCM_PROJECT_ID    required, e.g. citrus-fantasy-prod
 *   FCM_CLIENT_EMAIL  optional, ...@....iam.gserviceaccount.com
 *   FCM_PRIVATE_KEY   optional, that account's PEM (\n-escaped is fine)
 *
 * NO KEY FILE IN PRODUCTION (2026-09-09). FCM's HTTP v1 API wants a Google
 * OAuth access token, and the documented way to get one is a downloaded
 * service-account JSON. Citrus cannot download one: the organization enforces
 * `constraints/iam.disableServiceAccountKeyCreation`, and that policy is
 * RIGHT — a downloaded key is a permanent credential with no expiry that leaks
 * through a laptop backup or a CI log and cannot be noticed missing.
 *
 * So this uses the identity the code already runs as. Every Cloud Run instance
 * has a metadata server that mints an access token for its own service
 * account, scoped and short-lived, with nothing to store, rotate, or leak. The
 * only setup is an IAM role grant on the runtime service account. Cloud Run
 * sets K_SERVICE, so the presence of that variable is the (documented,
 * synchronous) signal that this road is available.
 *
 * The explicit-key path is kept because it is the only way to exercise Android
 * push OFF Cloud Run — a local run, or a future non-GCP host. If the two
 * optional variables are set they win; otherwise the runtime identity is used.
 *
 * STILL ZERO DEPENDENCIES either way. The JWT path is an RS256 signature and a
 * form POST; the metadata path is one GET. `firebase-admin` is a large
 * dependency tree for those thirty lines, against a lockfile the server
 * workspace deliberately does not have. (The legacy FCM server key would have
 * been one header and no token at all, and Google turned it off in 2024.)
 */

const PROD_HOST = 'api.push.apple.com';
const SANDBOX_HOST = 'api.sandbox.push.apple.com';
const DEFAULT_BUNDLE_ID = 'com.citrussports.app';

/** Apple rejects tokens older than 1h and rate-limits minting. Refresh at 50m. */
const JWT_TTL_MS = 50 * 60 * 1000;

/** A push that arrives after the pick clock expired is noise, not a nudge. */
const DEFAULT_EXPIRY_SECONDS = 120;
/**
 * A day. The 120s above is the pick clock's: a "you're on the clock" that
 * arrives after the pick auto-drafted is noise. Nothing else in the app has
 * that shape. A trade offer is worth reading tomorrow morning; a waiver
 * result is worth reading whenever the phone next wakes. Found 2026-09-09
 * when two trade offers claimed their dedupe rows, went to APNs, and never
 * reached phones that had been asleep for three hours — a 120s window is
 * shorter than an idle iPhone's reconnect.
 */
const GENERAL_EXPIRY_SECONDS = 24 * 60 * 60;

const REQUEST_TIMEOUT_MS = 5_000;

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Cloud Run's metadata server. Reachable only from inside an instance. */
const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-account/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
/** Google's access tokens live an hour; refresh at 50m, same margin as APNs. */
const FCM_TOKEN_TTL_MS = 50 * 60 * 1000;

/**
 * The token's `platform` column, whose CHECK constraint is
 * ('ios','android','web'). Rows written before 2026-09-09 all say 'ios'
 * (the column defaults to it and the client hardcoded it), and every one of
 * them IS an iPhone because the Play build did not exist: reading a legacy row
 * as iOS is correct, not a guess. 'web' has no push transport here and is
 * skipped rather than mailed to Apple, which would fail and then prune a token
 * that was never Apple's.
 */
type DevicePlatform = 'ios' | 'android' | 'web';

interface DeviceToken {
  token: string;
  platform: DevicePlatform;
}

export interface ApnsConfig {
  keyId: string;
  teamId: string;
  bundleId: string;
  privateKeyPem: string;
  production: boolean;
}

export interface FcmConfig {
  projectId: string;
  /**
   * An explicit service-account key, or null to use the identity the process
   * already runs as (Cloud Run's metadata server). Null is the production
   * shape; see the header note on why no key file exists.
   */
  clientEmail: string | null;
  privateKeyPem: string | null;
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

/**
 * Everything that is not the draft clock.
 *
 * `notifyOnTheClock` above stays as it is: it is the one push that has run in
 * production, it has its own dedupe table keyed on the pick, and a draft is
 * the worst possible place to discover a refactor. This is the general path
 * every other notification uses.
 */
export interface NotifyInput {
  /** Who to tell. Deduplicated; an empty list is a no-op, not an error. */
  userIds: string[];
  /** Which switch decides. See packages/shared notificationCategories. */
  category: NotificationCategory;
  title: string;
  body: string;
  /**
   * Natural key for exactly-once delivery, e.g. `trade_offer:<offerId>`.
   * Built from ids the caller already has. Omit ONLY when the event has no
   * stable identity and a duplicate is harmless.
   *
   * The key covers the EVENT, so a fan-out to eight managers must include the
   * recipient (`roster_league:<txId>:<userId>`) or seven of them get nothing.
   */
  dedupeKey?: string;
  /** Deep-link payload. Values are stringified for FCM; keep it small. */
  data?: Record<string, string | number | null | undefined>;
  /** Interrupts a Focus mode. True only when missing it costs the manager. */
  timeSensitive?: boolean;
  /**
   * How long APNs/FCM keep trying if the device is unreachable. Defaults to
   * a day. Set short ONLY for something that is worthless once stale.
   */
  expirySeconds?: number;
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

export function loadFcmConfigFromEnv(): FcmConfig | null {
  const projectId = process.env.FCM_PROJECT_ID;
  if (!projectId) {
    return null;
  }
  const clientEmail = process.env.FCM_CLIENT_EMAIL;
  const raw = process.env.FCM_PRIVATE_KEY;
  if (clientEmail && raw) {
    // Same flattening as APNS_PRIVATE_KEY: a PEM pasted into a secret manager
    // comes back with literal backslash-n.
    const privateKeyPem = raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
    return { projectId, clientEmail, privateKeyPem };
  }
  // No key: use the runtime's own identity, which exists only on Cloud Run.
  // K_SERVICE is set by Cloud Run on every instance. Without it there is no
  // metadata server to ask, and claiming to be configured would turn a clean
  // dormant state into a DNS failure on every pick.
  if (process.env.K_SERVICE) {
    return { projectId, clientEmail: null, privateKeyPem: null };
  }
  return null;
}

export class PushService {
  private supabase: SupabaseClient;
  private config: ApnsConfig | null;
  private signingKey: KeyObject | null = null;
  private cachedJwt: { token: string; mintedAt: number } | null = null;
  private session: ClientHttp2Session | null = null;
  private fcmConfig: FcmConfig | null;
  private fcmSigningKey: KeyObject | null = null;
  private cachedFcmToken: { token: string; mintedAt: number } | null = null;

  constructor(
    supabase: SupabaseClient,
    config: ApnsConfig | null = loadApnsConfigFromEnv(),
    fcmConfig: FcmConfig | null = loadFcmConfigFromEnv(),
  ) {
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
    this.fcmConfig = fcmConfig;
    if (fcmConfig?.privateKeyPem) {
      try {
        this.fcmSigningKey = createPrivateKey(fcmConfig.privateKeyPem);
      } catch (err) {
        // Same posture as the APNs key: Android push goes dormant, iOS is
        // untouched. One broken credential must not disable the other.
        structuredLogger.error(
          `[push] FCM_PRIVATE_KEY could not be parsed — Android push disabled: ${(err as Error).message}`,
        );
        this.fcmConfig = null;
      }
    }
  }

  /** True when at least one transport can send. */
  isConfigured(): boolean {
    return this.isApnsConfigured() || this.isFcmConfigured();
  }

  isApnsConfigured(): boolean {
    return this.config !== null && this.signingKey !== null;
  }

  isFcmConfigured(): boolean {
    if (this.fcmConfig === null) return false;
    // Either an explicit key was parsed, or there is no key to parse because
    // the runtime identity is being used.
    return this.fcmSigningKey !== null || this.fcmConfig.clientEmail === null;
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
      let skippedNoTransport = 0;

      for (const device of tokens) {
        const android = device.platform === 'android';
        // A device whose transport has no credentials is SKIPPED, not failed:
        // iOS-only credentials plus an Android tester is a deploy that has not
        // finished, and counting it as a failure would hide real ones. A 'web'
        // row has no transport at all.
        if (
          device.platform === 'web' ||
          (android ? !this.isFcmConfigured() : !this.isApnsConfigured())
        ) {
          skippedNoTransport += 1;
          continue;
        }
        const result = android
          ? await this.sendToFcmToken(device.token, input)
          : await this.sendToToken(device.token, payload);
        if (result.ok) {
          sent += 1;
        } else {
          failed += 1;
          if (result.prune) {
            await this.pruneToken(device.token, result.reason);
          }
        }
      }

      structuredLogger.info(
        `[push] on_the_clock leagueId=${input.leagueId} pick=${input.pickNumber} ` +
          `sent=${sent} failed=${failed} no_transport=${skippedNoTransport}`,
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

  /**
   * Send one notification to one or more managers.
   *
   * Four gates, in this order and for this reason:
   *   1. transport configured — nothing to send with;
   *   2. dedupe claim — a retry, a replayed webhook or a second instance must
   *      not double-send. Claimed BEFORE the per-user work so the losers do no
   *      database reads at all;
   *   3. master switch (profiles.push_notifications) — off means silence;
   *   4. the category switch — on by the category's own default unless the
   *      manager overrode it.
   *
   * Total by contract, like notifyOnTheClock: a trade must not fail because a
   * push did. Every path returns a PushResult and nothing throws out of here.
   */
  async notify(input: NotifyInput): Promise<PushResult> {
    if (!this.isConfigured()) {
      return { sent: 0, failed: 0, skipped: true, reason: 'not_configured' };
    }

    const userIds = Array.from(new Set(input.userIds.filter(Boolean)));
    if (userIds.length === 0) {
      return { sent: 0, failed: 0, skipped: true, reason: 'no_recipients' };
    }

    try {
      if (input.dedupeKey) {
        const claimed = await this.claimKey(input.dedupeKey);
        if (!claimed) {
          return { sent: 0, failed: 0, skipped: true, reason: 'already_delivered' };
        }
      }

      const recipients = await this.recipientsFor(userIds, input.category);
      if (recipients.length === 0) {
        structuredLogger.info(
          `[push] ${input.category} no eligible devices for ${userIds.length} user(s)`,
        );
        return { sent: 0, failed: 0, skipped: true, reason: 'no_devices' };
      }

      const apnsPayload = this.buildGenericApnsPayload(input);
      let sent = 0;
      let failed = 0;
      let skippedNoTransport = 0;

      for (const device of recipients) {
        const android = device.platform === 'android';
        // Same posture as the draft sender: a device whose transport has no
        // credentials is SKIPPED, not failed, so a half-finished deploy does
        // not look like a delivery bug.
        if (
          device.platform === 'web' ||
          (android ? !this.isFcmConfigured() : !this.isApnsConfigured())
        ) {
          skippedNoTransport += 1;
          continue;
        }
        const expiry = input.expirySeconds ?? GENERAL_EXPIRY_SECONDS;
        const result = android
          ? await this.sendGenericToFcmToken(device.token, input, expiry)
          : await this.sendToToken(device.token, apnsPayload, expiry);
        if (result.ok) {
          sent += 1;
        } else {
          failed += 1;
          if (result.prune) {
            await this.pruneToken(device.token, result.reason);
          }
        }
      }

      structuredLogger.info(
        `[push] ${input.category} users=${userIds.length} devices=${recipients.length} ` +
          `sent=${sent} failed=${failed} no_transport=${skippedNoTransport}`,
      );
      return { sent, failed, skipped: false };
    } catch (err) {
      structuredLogger.error(
        `[push] ${input.category} threw: ${(err as Error).message}`,
      );
      return { sent: 0, failed: 0, skipped: true, reason: 'error' };
    }
  }

  /**
   * Claim the right to send for this key. True only for the caller that
   * actually inserted, so concurrent senders cannot double-deliver.
   *
   * A claim that ERRORS returns false — we would rather drop a notification
   * than send it twice, because the duplicate is the one the manager notices.
   */
  private async claimKey(key: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('push_dedupe')
      .upsert({ key }, { onConflict: 'key', ignoreDuplicates: true })
      .select('key');

    if (error) {
      structuredLogger.warn(`[push] dedupe claim failed key=${key}: ${error.message}`);
      return false;
    }
    return Array.isArray(data) && data.length > 0;
  }

  /**
   * The devices of every manager in `userIds` who wants this category.
   *
   * One `profiles` read and one `device_tokens` read for the whole batch, not
   * per user: a league-wide notification is twelve managers, and twenty-four
   * round trips per roster move is how draft night falls over.
   *
   * A profile that cannot be read is treated as opted IN, matching the draft
   * sender: the columns default to on, and a nudge nobody asked to stop is
   * the smaller failure.
   */
  private async recipientsFor(
    userIds: string[],
    category: NotificationCategory,
  ): Promise<DeviceToken[]> {
    const { data: profiles, error: profileError } = await this.supabase
      .from('profiles')
      .select('id, push_notifications, push_categories')
      .in('id', userIds);

    let eligible = userIds;
    if (!profileError && Array.isArray(profiles)) {
      const rows = profiles as Array<{
        id: string;
        push_notifications: boolean | null;
        push_categories: NotificationPreferences | null;
      }>;
      const byId = new Map(rows.map((r) => [r.id, r]));
      eligible = userIds.filter((id) => {
        const row = byId.get(id);
        if (!row) return true; // unreadable → opted in, see above
        if (row.push_notifications === false) return false;
        return isCategoryEnabled(category, row.push_categories);
      });
      const off = userIds.length - eligible.length;
      if (off > 0) {
        structuredLogger.info(`[push] ${category} skipped ${off} user(s) reason=category_off_or_opted_out`);
      }
    }

    if (eligible.length === 0) return [];

    const { data, error } = await this.supabase
      .from('device_tokens')
      .select('token, platform')
      .in('user_id', eligible);

    if (error || !data) return [];
    return (data as Array<{ token: string; platform?: string | null }>)
      .filter((row) => Boolean(row.token))
      .map((row) => ({
        token: row.token,
        platform:
          row.platform === 'android' ? 'android' : row.platform === 'web' ? 'web' : 'ios',
      }));
  }

  /** APNs body for the general path. */
  private buildGenericApnsPayload(input: NotifyInput): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input.data ?? {})) {
      if (v !== undefined && v !== null) data[k] = v;
    }
    return {
      aps: {
        alert: { title: input.title, body: input.body },
        sound: 'default',
        // Only the draft clock and a trade you must answer earn a Focus
        // interruption; everything else waits for the manager to look.
        'interruption-level': input.timeSensitive ? 'time-sensitive' : 'active',
      },
      ...data,
      type: input.category,
    };
  }

  /** FCM body for the general path. FCM data values must be strings. */
  private async sendGenericToFcmToken(
    token: string,
    input: NotifyInput,
    expirySeconds: number = GENERAL_EXPIRY_SECONDS,
  ): Promise<{ ok: boolean; status?: number; reason?: string; prune?: boolean }> {
    const config = this.fcmConfig;
    if (!config) return { ok: false, reason: 'fcm_not_configured' };
    try {
      const accessToken = await this.currentFcmAccessToken();
      const data: Record<string, string> = { type: input.category };
      for (const [k, v] of Object.entries(input.data ?? {})) {
        if (v !== undefined && v !== null) data[k] = String(v);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(
          `https://fcm.googleapis.com/v1/projects/${config.projectId}/messages:send`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${accessToken}`,
              'content-type': 'application/json',
            },
            signal: controller.signal,
            body: JSON.stringify({
              message: {
                token,
                notification: { title: input.title, body: input.body },
                data,
                android: {
                  priority: input.timeSensitive ? 'HIGH' : 'NORMAL',
                  ttl: `${expirySeconds}s`,
                  notification: { sound: 'default' },
                },
              },
            }),
          },
        );
      } finally {
        clearTimeout(timer);
      }

      if (res.ok) return { ok: true, status: res.status };
      const raw = await res.text();
      let reason = raw;
      try {
        reason = (JSON.parse(raw) as { error?: { status?: string; message?: string } }).error?.status ?? raw;
      } catch {
        /* keep the raw body */
      }
      const prune = res.status === 404 || reason === 'UNREGISTERED' || reason === 'INVALID_ARGUMENT';
      return { ok: false, status: res.status, reason, prune };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
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

  /** The owner's devices, or `'opted_out'` when the owner turned the push off. */
  private async tokensForTeamOwner(teamId: string): Promise<DeviceToken[] | 'opted_out'> {
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
      .select('token, platform')
      .eq('user_id', team.owner_id);

    if (error || !data) {
      return [];
    }
    return (data as Array<{ token: string; platform?: string | null }>)
      .filter((row) => Boolean(row.token))
      .map((row) => ({
        token: row.token,
        // Only the two explicit values move off the APNs default; see
        // DevicePlatform for why an unrecognised value reads as iOS.
        platform:
          row.platform === 'android' ? 'android' : row.platform === 'web' ? 'web' : 'ios',
      }));
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
    expirySeconds: number = DEFAULT_EXPIRY_SECONDS,
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
          'apns-expiration': String(Math.floor(Date.now() / 1000) + expirySeconds),
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

  /**
   * FCM HTTP v1 send. Mirrors `sendToToken`'s contract exactly, so the loop
   * above does not care which road a device is on.
   *
   * The payload is built here rather than shared with APNs because the two
   * wire formats disagree about everything except the words: APNs nests the
   * alert under `aps`, FCM under `message.notification`, and FCM requires
   * every `data` value to be a STRING (a number silently 400s the whole send).
   */
  private async sendToFcmToken(
    token: string,
    input: OnTheClockInput,
  ): Promise<{ ok: boolean; status?: number; reason?: string; prune?: boolean }> {
    const config = this.fcmConfig;
    if (!config) {
      return { ok: false, reason: 'fcm_not_configured' };
    }
    try {
      const accessToken = await this.currentFcmAccessToken();
      const league = input.leagueName?.trim();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(
          `https://fcm.googleapis.com/v1/projects/${config.projectId}/messages:send`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${accessToken}`,
              'content-type': 'application/json',
            },
            signal: controller.signal,
            body: JSON.stringify({
              message: {
                token,
                notification: {
                  title: "You're on the clock",
                  body: league ? `It's your pick in ${league}.` : 'It’s your turn to pick.',
                },
                // Strings only. The tap handler parses pickNumber back.
                data: {
                  leagueId: input.leagueId,
                  pickNumber: String(input.pickNumber),
                  deadline: input.deadlineIso ?? '',
                  type: 'draft_on_the_clock',
                },
                android: {
                  priority: 'HIGH',
                  // Same reasoning as apns-expiration: a nudge that outlives
                  // the pick clock is noise.
                  ttl: `${DEFAULT_EXPIRY_SECONDS}s`,
                  notification: { sound: 'default' },
                },
              },
            }),
          },
        );
      } finally {
        clearTimeout(timer);
      }

      if (res.ok) {
        return { ok: true, status: res.status };
      }
      const raw = await res.text();
      let reason = raw;
      try {
        reason = (JSON.parse(raw) as { error?: { status?: string; message?: string } }).error?.status ?? raw;
      } catch {
        /* keep the raw body */
      }
      // UNREGISTERED (404) is FCM's 410: the app was uninstalled. INVALID_ARGUMENT
      // on a send this simple means the token itself is malformed. Both are dead
      // for good, so stop paying for them on every pick.
      const prune = res.status === 404 || reason === 'UNREGISTERED' || reason === 'INVALID_ARGUMENT';
      return { ok: false, status: res.status, reason, prune };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  }

  /**
   * A Google OAuth access token for FCM, cached for 50 minutes because Google
   * rate-limits minting and a 12-round draft would otherwise ask 200 times.
   *
   * This is the whole of what firebase-admin would have been added for.
   */
  private async currentFcmAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedFcmToken && now - this.cachedFcmToken.mintedAt < FCM_TOKEN_TTL_MS) {
      return this.cachedFcmToken.token;
    }
    const token = this.fcmSigningKey
      ? await this.mintFcmTokenFromKey(now)
      : await this.mintFcmTokenFromMetadata();
    this.cachedFcmToken = { token, mintedAt: now };
    return token;
  }

  /**
   * The production path: ask Cloud Run's metadata server for a token for the
   * service account this instance already runs as. No credential is stored
   * anywhere, which is the point.
   *
   * The runtime service account needs a role carrying
   * `cloudmessaging.messages.create` (Firebase Cloud Messaging API Admin). A
   * missing grant surfaces as a 403 from the send, not from here.
   */
  private async mintFcmTokenFromMetadata(): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(METADATA_TOKEN_URL, {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`metadata token ${res.status}: ${await res.text()}`);
      }
      const body = (await res.json()) as { access_token?: string };
      if (!body.access_token) {
        throw new Error('metadata server returned no access_token');
      }
      return body.access_token;
    } finally {
      clearTimeout(timer);
    }
  }

  /** The off-Cloud-Run path: an RS256 assertion exchanged for a token. */
  private async mintFcmTokenFromKey(now: number): Promise<string> {
    const config = this.fcmConfig;
    const key = this.fcmSigningKey;
    if (!config?.clientEmail || !key) {
      throw new Error('fcm not configured');
    }

    const iat = Math.floor(now / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claims = {
      iss: config.clientEmail,
      scope: FCM_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat,
      exp: iat + 3600,
    };
    const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
    // RS256 is PKCS#1 v1.5 over SHA-256, which is `sign`'s default padding for
    // an RSA key, so unlike the APNs ES256 case no encoding option is needed.
    const assertion = `${signingInput}.${cryptoSign('sha256', Buffer.from(signingInput), key).toString('base64url')}`;

    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });
    if (!res.ok) {
      throw new Error(`google token exchange ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as { access_token?: string };
    if (!body.access_token) {
      throw new Error('google token exchange returned no access_token');
    }
    return body.access_token;
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
