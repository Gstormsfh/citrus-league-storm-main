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
  if (!isNativeShell()) {
    return () => {};
  }

  let removed = false;
  let remove: (() => void) | null = null;

  (async () => {
    const { App } = await import('@capacitor/app');
    const handle = await App.addListener('appUrlOpen', async ({ url }) => {
      if (!url.startsWith(NATIVE_AUTH_CALLBACK)) return;
      try {
        const { Browser } = await import('@capacitor/browser');
        await Browser.close().catch(() => {
          /* sheet may already be closed — not an error */
        });
        const code = new URL(url).searchParams.get('code');
        if (!code) {
          onError('Sign-in was cancelled or the callback was malformed.');
          return;
        }
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) onError(error.message);
      } catch (e) {
        onError(e instanceof Error ? e.message : 'Sign-in failed completing the session.');
      }
    });
    if (removed) {
      handle.remove();
    } else {
      remove = () => handle.remove();
    }
  })();

  return () => {
    removed = true;
    remove?.();
  };
}
