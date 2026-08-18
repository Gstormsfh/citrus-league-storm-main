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
export async function registerForPush(
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
    const registration = new Promise<string | null>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      }, 10_000);

      void PushNotifications.addListener('registration', (token) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(token.value);
      });

      void PushNotifications.addListener('registrationError', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        onError(`APNs registration failed: ${JSON.stringify(err)}`);
        resolve(null);
      });
    });

    await PushNotifications.register();
    const token = await registration;
    if (!token) {
      return false;
    }

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
              onNavigate(`/draft/${leagueId}`);
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
export async function unregisterDeviceToken(
  supabase: SupabaseClient,
  userId: string,
  onError: PushLogger = noop,
): Promise<void> {
  if (!isPushSupported() || !userId) {
    return;
  }
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await PushNotifications.removeAllListeners();
    // We do not hold the token in memory across a session, and RLS scopes
    // device_tokens to the signed-in user, so clearing their rows is both
    // sufficient and all we are permitted to do.
    const { error } = await supabase.from('device_tokens').delete().eq('user_id', userId);
    if (error) {
      onError(`could not clear device token: ${error.message}`);
    }
  } catch (e) {
    onError(e instanceof Error ? e.message : 'push cleanup failed');
  }
}
