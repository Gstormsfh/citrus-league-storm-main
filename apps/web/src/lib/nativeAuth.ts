/**
 * APPLE-WRAP OAuth (2026-08-15) — the native leg of sign-in.
 *
 * WHY THIS FILE EXISTS. Inside the iOS shell, `signInWithOAuth` as
 * written cannot work, twice over:
 *
 *   1. Google REJECTS OAuth from embedded webviews outright
 *      (`disallowed_useragent`) — the sign-in page itself refuses to
 *      render. The auth leg must run in the system browser
 *      (SFSafariViewController via @capacitor/browser).
 *   2. The web redirect (`${origin}/auth/callback`) points back at the
 *      website. Safari would finish the login on citrussports.app and
 *      strand the session THERE, while the app the user tapped stays
 *      logged out. The redirect must instead be a custom scheme —
 *      `citrussports://auth-callback` — registered in Info.plist, so
 *      iOS hands control back to the app, which then exchanges the
 *      PKCE code for a session itself.
 *
 * The flow, end to end:
 *   signInWithOAuth (native branch)
 *     → supabase.auth.signInWithOAuth({ skipBrowserRedirect: true,
 *         redirectTo: 'citrussports://auth-callback' })  // returns URL, no navigation
 *     → Browser.open(url)                                 // system browser sheet
 *     → user authenticates with Google/Apple
 *     → iOS opens the app via the custom scheme; Capacitor fires 'appUrlOpen'
 *     → registerNativeAuthListener catches it, closes the sheet,
 *         exchangeCodeForSession(code)                    // PKCE completes IN the app
 *
 * Everything here is gated on Capacitor.isNativePlatform(), which is
 * `false` in every browser — so the WEB sign-in path is bit-for-bit
 * unchanged. That invariant is pinned by
 * __tests__/nativeAuth.test.ts: the highest-risk regression this file
 * could cause is breaking the login page three days before THE TWELVE.
 *
 * Remaining non-code step (Supabase dashboard, one minute):
 * add `citrussports://auth-callback` to Auth → URL Configuration →
 * Redirect URLs. Until that allow-list entry exists, Supabase will
 * refuse the redirect and native sign-in fails fast with a clear error.
 */

import { Capacitor } from '@capacitor/core';
import { AuthError } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

export const NATIVE_AUTH_SCHEME = 'citrussports';
export const NATIVE_AUTH_CALLBACK = `${NATIVE_AUTH_SCHEME}://auth-callback`;

/**
 * Password recovery gets its OWN callback rather than reusing auth-callback,
 * because completing it means more than minting a session: the app has to land
 * the user on the form where they choose a new password. A distinct URL lets
 * the listener tell "you signed in" from "you are here to set a password"
 * without inspecting Supabase's query params, which differ between flows.
 */
export const NATIVE_RESET_CALLBACK = `${NATIVE_AUTH_SCHEME}://reset-password`;

/** Web paths an emailed auth link can legitimately return to. */
export type AuthRedirectPath = '/auth/callback' | '/reset-password';

/**
 * Where an emailed auth link should send the user back to.
 *
 * In a browser this is the web origin, unchanged. In the native shell it MUST
 * be the custom scheme, because `window.location.origin` there is
 * `capacitor://localhost` — a scheme iOS Mail cannot open, that is not
 * registered in Info.plist (only `citrussports` is), and that Supabase would
 * reject as un-allowlisted even if it could be opened. Building an email
 * redirect from the origin produces a link that is simply dead on device: the
 * user taps it and nothing at all happens.
 *
 * That was the state of every email flow in AuthContext before 2026-08-25 —
 * sign-up confirmation, resend, and password reset. OAuth had been fixed
 * (beginNativeOAuth above); the email flows were never brought along.
 */
export function authRedirectUrl(path: AuthRedirectPath): string {
  if (!isNativeShell()) {
    return `${window.location.origin}${path}`;
  }
  return path === '/reset-password' ? NATIVE_RESET_CALLBACK : NATIVE_AUTH_CALLBACK;
}

/** True only inside the iOS/Android shell — false in every browser. */
export function isNativeShell(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Run the OAuth authorization leg in the SYSTEM browser and return.
 * The session does not exist yet when this resolves — it is created
 * later by the appUrlOpen listener. Callers treat "no error" as
 * "hand-off to the system browser succeeded", nothing more.
 */
export async function beginNativeOAuth(
  supabase: SupabaseClient,
  provider: 'google' | 'apple',
  opts: { scopes?: string; queryParams?: Record<string, string> },
): Promise<{ error: AuthError | null }> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: NATIVE_AUTH_CALLBACK,
      scopes: opts.scopes,
      queryParams: opts.queryParams,
      // Do NOT navigate the webview — hand the URL to the system browser.
      skipBrowserRedirect: true,
    },
  });
  if (error) return { error };
  if (!data?.url) return { error: new AuthError('OAuth URL missing from Supabase response') };

  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url: data.url, presentationStyle: 'popover' });
  return { error: null };
}

/**
 * Subscribe to inbound deep links whose URL starts with `prefix`.
 *
 * Covers BOTH ways a link can arrive, which is the part that is easy to get
 * wrong:
 *
 *   • WARM  — the app is already running and iOS re-enters it. Capacitor fires
 *             'appUrlOpen'.
 *   • COLD  — the app was not running. The link is what launched it, and
 *             whether 'appUrlOpen' also fires is not something to rely on, so
 *             `getLaunchUrl()` is checked once at registration.
 *
 * Cold start is the COMMON case for an emailed password-reset link: the user
 * is in Mail, not in the app. Handling only 'appUrlOpen' would work every time
 * you tested it with the app open and fail for the people it was built for.
 *
 * `handled` guards the overlap — if a cold launch delivers the URL through
 * both routes, the PKCE code is exchanged once. A second exchange of the same
 * code fails and would clobber the session that just succeeded.
 *
 * Returns an unsubscriber. In every browser this is a no-op that registers
 * nothing, so the web app is untouched.
 */
function onDeepLink(prefix: string, handler: (url: string) => Promise<void>): () => void {
  if (!isNativeShell()) {
    return () => {};
  }

  let removed = false;
  let remove: (() => void) | null = null;
  const handled = new Set<string>();

  const dispatch = async (url: string | undefined | null) => {
    if (!url || !url.startsWith(prefix) || handled.has(url)) return;
    handled.add(url);
    await handler(url);
  };

  (async () => {
    const { App } = await import('@capacitor/app');

    // Returns the promise rather than firing and forgetting. Capacitor ignores
    // the return value, but it makes the handler awaitable, which is the
    // difference between a test that verifies the exchange and one that races it.
    const handle = await App.addListener('appUrlOpen', ({ url }) => dispatch(url));
    if (removed) {
      handle.remove();
    } else {
      remove = () => handle.remove();
    }

    // Cold start: the link that launched the app is not delivered by the
    // listener above on every path, so ask for it directly.
    //
    // Feature-detected rather than called outright. This is an optional extra
    // on top of a listener that is already registered, so a plugin build
    // without it must degrade to warm-launch-only — not reject and take the
    // whole registration down with it.
    const launch =
      typeof App.getLaunchUrl === 'function' ? await App.getLaunchUrl().catch(() => null) : null;
    if (!removed) void dispatch(launch?.url);
  })();

  return () => {
    removed = true;
    remove?.();
  };
}

/**
 * Exchange the PKCE code carried by a callback URL for a session.
 *
 * The code_verifier lives in the webview's own storage — the same storage the
 * flow was started from — which is why the exchange has to happen HERE, in the
 * app, and not in the system browser that handled the authorization leg.
 */
async function completeCodeExchange(
  supabase: SupabaseClient,
  url: string,
  onError: (message: string) => void,
): Promise<boolean> {
  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.close().catch(() => {
      /* sheet may already be closed — not an error */
    });
    const code = new URL(url).searchParams.get('code');
    if (!code) {
      onError('Sign-in was cancelled or the callback was malformed.');
      return false;
    }
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      onError(error.message);
      return false;
    }
    return true;
  } catch (e) {
    onError(e instanceof Error ? e.message : 'Sign-in failed completing the session.');
    return false;
  }
}

/**
 * Idempotent app-launch hook: completes the PKCE exchange when iOS
 * re-enters the app via citrussports://auth-callback?code=...
 *
 * Registered once from AuthContext's mount effect. Returns an
 * unsubscribe so React StrictMode double-mounting cannot stack
 * duplicate listeners (two exchanges of one code = second one fails
 * and clobbers the signed-in state).
 */
export function registerNativeAuthListener(
  supabase: SupabaseClient,
  onError: (message: string) => void,
): () => void {
  return onDeepLink(NATIVE_AUTH_CALLBACK, async (url) => {
    await completeCodeExchange(supabase, url, onError);
  });
}

/**
 * Completes a password-recovery deep link and reports where to send the user.
 *
 * Separate from registerNativeAuthListener because navigation needs a router,
 * and AuthProvider is mounted OUTSIDE BrowserRouter in App.tsx — it has no
 * useNavigate to give. So this is registered from a component inside the
 * router instead (components/NativeAuthDeepLink.tsx), the same arrangement
 * PushDeepLink already uses for notification taps.
 *
 * The two listeners cannot collide: NATIVE_AUTH_CALLBACK is
 * `citrussports://auth-callback` and this one is `citrussports://reset-password`,
 * so neither prefix matches the other's URLs.
 */
export function registerNativeRecoveryListener(
  supabase: SupabaseClient,
  onRecovery: (path: AuthRedirectPath) => void,
  onError: (message: string) => void,
): () => void {
  return onDeepLink(NATIVE_RESET_CALLBACK, async (url) => {
    const ok = await completeCodeExchange(supabase, url, onError);
    // Navigate even when the exchange failed: /reset-password renders an
    // honest "this link expired" state, which beats stranding the user on
    // whatever screen the app happened to launch into with no explanation.
    onRecovery('/reset-password');
    if (!ok) return;
  });
}
