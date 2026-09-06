import type { SupabaseClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';

/**
 * Draft-turn push notifications (iOS shell only).
 *
 * WHY: App Store guideline 4.2 rejects apps that are "just a website in a box".
 * A wrapped web app needs at least one capability the browser cannot provide,
 * and "you're on the clock" is both that capability and the thing users actually
 * want from a draft app. Server half is server/src/services/PushService.ts.
 *
 * FLOW
 *   1. `registerForPush` asks iOS for permission, then registers with APNs.
 *   2. APNs answers on the 'registration' event with an opaque device token.
 *   3. We upsert it into public.device_tokens (RLS-scoped to the signed-in user,
 *      unique on the token, cascading off profiles so account deletion clears it).
 *   4. When it becomes their turn, the draft engine sends to that token.
 *   5. Tapping the notification fires 'pushNotificationActionPerformed', and we
 *      deep-link into the draft room using the leagueId carried in the payload.
 *
 * Every export is gated on `Capacitor.isNativePlatform()` and returns a no-op in
 * a browser, exactly like nativeAuth.ts — the web app's behaviour is untouched.
 * The plugin is imported dynamically so the web bundle never pulls it in.
 *
 * Failures are logged and swallowed. A user who declines notifications must
 * still get a completely working app; this is an enhancement, not a gate.
 */

export type PushLogger = (message: string) => void;

const noop = () => {};
const DEVICE_TOKEN_KEY = 'citrus.push.device-token';
let currentToken: string | null = null;
// Serialize registration and sign-out so an in-flight upsert cannot restore
// the departing user's token after cleanup has finished.
let pushOperation: Promise<unknown> = Promise.resolve();
function serializePush<T>(operation: () => Promise<T>): Promise<T> {
  const result = pushOperation.then(operation, operation);
  pushOperation = result.catch(noop);
  return result;
}
function rememberToken(token: string): void {
  currentToken = token;
  try { localStorage.setItem(DEVICE_TOKEN_KEY, token); } catch { /* Memory fallback. */ }
}
function readToken(): string | null {
  try { return currentToken ?? localStorage.getItem(DEVICE_TOKEN_KEY); } catch { return currentToken; }
}

export function isPushSupported(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Ask for permission and register the device against the signed-in user.
 * Safe to call on every sign-in: the upsert is keyed on the token, so a
 * returning device refreshes its row rather than accumulating duplicates.
 *
 * Returns false when push is unavailable or the user declined — callers should
 * treat that as normal, not as an error worth showing anyone.
 */
async function registerDeviceForPush(
  supabase: SupabaseClient,
  userId: string,
  onError: PushLogger = noop,
): Promise<boolean> {
  if (!isPushSupported() || !userId) {
    return false;
  }

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    let status = await PushNotifications.checkPermissions();
    if (status.receive === 'prompt' || status.receive === 'prompt-with-rationale') {
      status = await PushNotifications.requestPermissions();
    }
    if (status.receive !== 'granted') {
      // Declined. Not an error — the draft works fine without it.
      return false;
    }

    // The token arrives asynchronously on the 'registration' event, never as a
    // return value, so the listener has to be attached before register() runs.
    const handles: Array<{ remove(): Promise<void> }> = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let finish!: (token: string | null) => void;
    const registration = new Promise<string | null>((resolve) => {
      finish = (token) => {
        if (settled) return;
        settled = true;
        resolve(token);
      };
    });
    let token: string | null;
    try {
      handles.push(await PushNotifications.addListener('registration', (result) => finish(result.value)));
      handles.push(await PushNotifications.addListener('registrationError', () => {
        onError('APNs registration failed');
        finish(null);
      }));
      timer = setTimeout(() => finish(null), 10_000);
      await PushNotifications.register();
      token = await registration;
    } finally {
      settled = true;
      clearTimeout(timer);
      await Promise.allSettled(handles.map((handle) => handle.remove()));
    }
    if (!token) {
      return false;
    }

    rememberToken(token);
    const { error } = await supabase.from('device_tokens').upsert(
      {
        user_id: userId,
        token,
        platform: 'ios',
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'token' },
    );

    if (error) {
      onError(`could not save device token: ${error.message}`);
      return false;
    }
    return true;
  } catch (e) {
    onError(e instanceof Error ? e.message : 'push registration failed');
    return false;
  }
}

export function registerForPush(
  supabase: SupabaseClient,
  userId: string,
  onError: PushLogger = noop,
): Promise<boolean> {
  return serializePush(() => registerDeviceForPush(supabase, userId, onError));
}

/**
 * Handle a tapped notification by deep-linking into the league it came from.
 *
 * Returns an unsubscriber so this can be an effect cleanup — without it,
 * StrictMode's double-mount stacks duplicate listeners and one tap navigates
 * twice. Mirrors registerNativeAuthListener's contract for the same reason.
 */
export function registerPushTapListener(
  onNavigate: (path: string) => void,
  onError: PushLogger = noop,
): () => void {
  if (!isPushSupported()) {
    return noop;
  }

  let removed = false;
  let remove: (() => void) | null = null;

  void (async () => {
    try {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      const handle = await PushNotifications.addListener(
        'pushNotificationActionPerformed',
        (action) => {
          try {
            const data = (action.notification?.data ?? {}) as Record<string, unknown>;
            const leagueId = typeof data.leagueId === 'string' ? data.leagueId : null;
            if (data.type === 'draft_on_the_clock' && leagueId) {
              // 2026-08-18 launch audit: this was `/draft/${leagueId}`,
              // which matches NO route — `/draft` is registered as an
              // exact path, so `/draft/<uuid>` fell through to the
              // catch-all 404. Tapping "you're on the clock" on the
              // native build sent the user to a Not Found page while
              // their pick clock ran down. `/draft-v2/:leagueId` is the
              // real route (App.tsx), and matches useStartDraftV2.
              onNavigate(`/draft-v2/${leagueId}`);
            }
          } catch (e) {
            onError(e instanceof Error ? e.message : 'push tap handling failed');
          }
        },
      );

      if (removed) {
        handle.remove();
      } else {
        remove = () => handle.remove();
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : 'could not attach push listener');
    }
  })();

  return () => {
    removed = true;
    remove?.();
  };
}

/**
 * Drop this device's token on sign-out, so the next person to use the phone
 * does not receive draft alerts for the previous user's leagues.
 */
async function unregisterCurrentDeviceToken(
  supabase: SupabaseClient,
  userId: string,
  onError: PushLogger = noop,
): Promise<void> {
  if (!isPushSupported() || !userId) {
    return;
  }
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    // Unregister delivery on this installation without removing the app-wide
    // notification-tap listener, which must survive another sign-in.
    try {
      await PushNotifications.unregister();
    } catch {
      onError('could not unregister native push delivery');
    }
    const token = readToken();
    if (!token) return;
    const { error } = await supabase.from('device_tokens').delete()
      .eq('user_id', userId).eq('token', token);
    if (error) {
      onError(`could not clear device token: ${error.message}`);
    }
  } catch (e) {
    onError(e instanceof Error ? e.message : 'push cleanup failed');
  }
}

export function unregisterDeviceToken(
  supabase: SupabaseClient,
  userId: string,
  onError: PushLogger = noop,
): Promise<void> {
  return serializePush(() => unregisterCurrentDeviceToken(supabase, userId, onError));
}
