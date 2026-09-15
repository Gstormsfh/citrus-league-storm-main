/**
 * APPLE-WRAP OAuth (2026-08-15) — the invariant that matters this week.
 *
 * The native branch ships THREE DAYS before THE TWELVE use the web
 * login page. The single highest-risk regression this feature could
 * cause is not "native sign-in doesn't work yet" (expected until
 * Tuesday's device build) — it is "the platform check misfires in a
 * browser and reroutes twelve humans' logins through a code path that
 * requires an iOS shell". So the first tests here pin, exactly:
 *
 *   isNativePlatform() === false  →  the web flow is UNCHANGED:
 *   same provider, same ${origin}/auth/callback redirect, NO
 *   skipBrowserRedirect, and the Browser plugin is never touched.
 *
 * The native-side tests then pin the hand-off order and the PKCE
 * completion, with @capacitor/* fully mocked (no shell in jsdom).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { isNativeMock, browserOpenMock, browserCloseMock, addListenerMock, getLaunchUrlMock, appleSignInMock } =
  vi.hoisted(() => ({
    isNativeMock: vi.fn(() => false),
    appleSignInMock: vi.fn(async (_opts: unknown): Promise<unknown> => ({ idToken: 'apple.jwt', givenName: 'Garrett', familyName: 'Storms', email: null })),
    browserOpenMock: vi.fn(async () => {}),
    browserCloseMock: vi.fn(async () => {}),
    addListenerMock: vi.fn(
      async (_evt: string, _cb: (e: { url: string }) => Promise<void>) => ({
        remove: vi.fn(),
      }),
    ),
    // Cold start. The real @capacitor/app exposes this; the mock did not, which
    // is how an un-guarded call to it slipped in unnoticed.
    getLaunchUrlMock: vi.fn(async (): Promise<{ url: string } | null> => null),
  }));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: isNativeMock },
}));
vi.mock('@capawesome/capacitor-apple-sign-in', () => ({
  AppleSignIn: { signIn: appleSignInMock },
  SignInScope: { Email: 'EMAIL', FullName: 'FULL_NAME' },
}));
vi.mock('@capacitor/browser', () => ({
  Browser: { open: browserOpenMock, close: browserCloseMock },
}));
vi.mock('@capacitor/app', () => ({
  App: { addListener: addListenerMock, getLaunchUrl: getLaunchUrlMock },
}));

import {
  isNativeShell,
  beginNativeOAuth,
  registerNativeAuthListener,
  registerNativeRecoveryListener,
  authRedirectUrl,
  NATIVE_AUTH_CALLBACK,
  NATIVE_RESET_CALLBACK,
  signInWithAppleNative,
} from '../nativeAuth';
import type { SupabaseClient } from '@supabase/supabase-js';

function mkSupabase(oauthResult: unknown = { data: { url: 'https://sb.example/authorize?x=1' }, error: null }) {
  return {
    auth: {
      signInWithOAuth: vi.fn(async () => oauthResult),
      exchangeCodeForSession: vi.fn(async () => ({ data: {}, error: null })),
      signInWithIdToken: vi.fn(async () => ({ data: {}, error: null })),
      updateUser: vi.fn(async () => ({ data: {}, error: null })),
    },
  } as unknown as SupabaseClient & {
    auth: {
      signInWithOAuth: ReturnType<typeof vi.fn>;
      exchangeCodeForSession: ReturnType<typeof vi.fn>;
      signInWithIdToken: ReturnType<typeof vi.fn>;
      updateUser: ReturnType<typeof vi.fn>;
    };
  };
}

/**
 * NATIVE SIGN IN WITH APPLE (2026-09-15, App Review rejection of 1.0 (18):
 * the browser-sheet flow rendered blank on iPad). Apple's sheet returns an
 * identity token; Supabase verifies it against the raw nonce. The plugin
 * passes `nonce` to Apple unchanged, so the HASH goes to Apple and the RAW
 * value to Supabase, and the two must be related by SHA-256.
 */
describe('native Sign in with Apple', () => {
  const sha256Hex = async (v: string) =>
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))), (b) => b.toString(16).padStart(2, '0')).join('');

  beforeEach(() => { appleSignInMock.mockClear(); });

  it('sends Apple the SHA-256 of the nonce and Supabase the raw nonce with the identity token', async () => {
    const supabase = mkSupabase();
    const { error, cancelled } = await signInWithAppleNative(supabase);
    expect(error).toBeNull();
    expect(cancelled).toBeUndefined();

    const sent = appleSignInMock.mock.calls[0][0] as { nonce: string; scopes: string[] };
    expect(sent.scopes).toEqual(['EMAIL', 'FULL_NAME']);
    const call = supabase.auth.signInWithIdToken.mock.calls[0][0] as { provider: string; token: string; nonce: string };
    expect(call.provider).toBe('apple');
    expect(call.token).toBe('apple.jwt');
    expect(call.nonce).not.toBe(sent.nonce);
    expect(await sha256Hex(call.nonce)).toBe(sent.nonce);
    // No browser sheet is involved at all.
    expect(browserOpenMock).not.toHaveBeenCalled();
  });

  it('records the name Apple sends on first authorization', async () => {
    const supabase = mkSupabase();
    await signInWithAppleNative(supabase);
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({ data: { full_name: 'Garrett Storms', first_name: 'Garrett', last_name: 'Storms' } });
  });

  it('treats a dismissed sheet as cancelled, not as an error', async () => {
    appleSignInMock.mockRejectedValueOnce(Object.assign(new Error('Sign in was canceled.'), { code: 'SIGN_IN_CANCELED' }));
    const supabase = mkSupabase();
    const result = await signInWithAppleNative(supabase);
    expect(result).toEqual({ error: null, cancelled: true });
    expect(supabase.auth.signInWithIdToken).not.toHaveBeenCalled();
  });

  it('surfaces a Supabase rejection of the token', async () => {
    const supabase = mkSupabase();
    supabase.auth.signInWithIdToken.mockResolvedValueOnce({ data: null, error: { message: 'audience mismatch' } });
    const { error } = await signInWithAppleNative(supabase);
    expect(error).toMatchObject({ message: 'audience mismatch' });
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });
});

beforeEach(() => {
  isNativeMock.mockReset().mockReturnValue(false);
  browserOpenMock.mockClear();
  browserCloseMock.mockClear();
  addListenerMock.mockClear().mockResolvedValue({ remove: vi.fn() });
  getLaunchUrlMock.mockReset().mockResolvedValue(null);
});

describe('the web path must be untouched (THE invariant)', () => {
  it('isNativeShell() is false in a browser', () => {
    expect(isNativeShell()).toBe(false);
  });

  it('registerNativeAuthListener is a synchronous no-op on web — the App plugin is never loaded', () => {
    const supabase = mkSupabase();
    const off = registerNativeAuthListener(supabase, vi.fn());
    expect(typeof off).toBe('function');
    off();
    expect(addListenerMock).not.toHaveBeenCalled();
  });
});

describe('the native hand-off', () => {
  it('requests the OAuth URL without navigating, then opens the SYSTEM browser', async () => {
    isNativeMock.mockReturnValue(true);
    const supabase = mkSupabase();

    const { error } = await beginNativeOAuth(supabase, 'google', {
      scopes: 'email profile',
      queryParams: { access_type: 'offline', prompt: 'consent' },
    });

    expect(error).toBeNull();
    expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: NATIVE_AUTH_CALLBACK,
        scopes: 'email profile',
        queryParams: { access_type: 'offline', prompt: 'consent' },
        skipBrowserRedirect: true,
      },
    });
    expect(browserOpenMock).toHaveBeenCalledWith({
      url: 'https://sb.example/authorize?x=1',
      presentationStyle: 'fullscreen',
    });
  });

  it('surfaces the Supabase error and never opens a browser on failure', async () => {
    isNativeMock.mockReturnValue(true);
    const boom = Object.assign(new Error('redirect_to not allowed'), {
      // shape of a real AuthError, which is what Supabase actually throws
      code: 'validation_failed',
      status: 400,
    });
    const supabase = mkSupabase({ data: null, error: boom });

    const { error } = await beginNativeOAuth(supabase, 'apple', {});

    expect(error).toBe(boom);
    expect(browserOpenMock).not.toHaveBeenCalled();
  });
});

describe('the callback completes PKCE inside the app', () => {
  async function fireCallback(url: string, supabase: ReturnType<typeof mkSupabase>, onError = vi.fn()) {
    isNativeMock.mockReturnValue(true);
    let captured: ((e: { url: string }) => Promise<void>) | null = null;
    addListenerMock.mockImplementation(async (_evt: string, cb: (e: { url: string }) => Promise<void>) => {
      captured = cb;
      return { remove: vi.fn() };
    });
    registerNativeAuthListener(supabase, onError);
    await vi.waitFor(() => expect(captured).toBeTruthy());
    await captured!({ url });
    return onError;
  }

  it('exchanges the code from citrussports://auth-callback?code=…', async () => {
    const supabase = mkSupabase();
    await fireCallback(`${NATIVE_AUTH_CALLBACK}?code=abc123`, supabase);

    expect(browserCloseMock).toHaveBeenCalled();
    expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith('abc123');
  });

  it('ignores unrelated deep links entirely', async () => {
    const supabase = mkSupabase();
    await fireCallback('citrussports://league-invite/xyz', supabase);

    expect(supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(browserCloseMock).not.toHaveBeenCalled();
  });

  it('reports a callback with no code instead of exchanging garbage', async () => {
    const supabase = mkSupabase();
    const onError = await fireCallback(`${NATIVE_AUTH_CALLBACK}?error=access_denied`, supabase);

    expect(supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith('Sign-in was cancelled or the callback was malformed.');
  });
});

// ===========================================================================
// EMAIL REDIRECTS (2026-08-26)
//
// OAuth was given a native path in August; the EMAIL flows were not. They
// built their redirect from window.location.origin, which inside the shell is
// capacitor://localhost — a scheme iOS Mail cannot open and that Info.plist
// does not register. Password reset has no server-side alternative the way
// signUp does, so on device a forgotten password was an unrecoverable state.
// ===========================================================================

describe('authRedirectUrl', () => {
  it('uses the web origin in a browser — unchanged behaviour', () => {
    isNativeMock.mockReturnValue(false);
    expect(authRedirectUrl('/auth/callback')).toBe(`${window.location.origin}/auth/callback`);
    expect(authRedirectUrl('/reset-password')).toBe(`${window.location.origin}/reset-password`);
  });

  it('uses the custom scheme in the shell, never capacitor://localhost', () => {
    isNativeMock.mockReturnValue(true);
    expect(authRedirectUrl('/auth/callback')).toBe(NATIVE_AUTH_CALLBACK);
    expect(authRedirectUrl('/reset-password')).toBe(NATIVE_RESET_CALLBACK);
  });

  it('never emits a capacitor:// URL for any path', () => {
    isNativeMock.mockReturnValue(true);
    for (const p of ['/auth/callback', '/reset-password'] as const) {
      expect(authRedirectUrl(p)).not.toMatch(/^capacitor:/);
      expect(authRedirectUrl(p)).toMatch(/^citrussports:\/\//);
    }
  });
});

describe('the recovery deep link', () => {
  async function register(supabase: ReturnType<typeof mkSupabase>) {
    isNativeMock.mockReturnValue(true);
    const onRecovery = vi.fn();
    const onError = vi.fn();
    let captured: ((e: { url: string }) => void) | null = null;
    addListenerMock.mockImplementation(async (_evt: string, cb: (e: { url: string }) => void) => {
      captured = cb;
      return { remove: vi.fn() };
    });
    const off = registerNativeRecoveryListener(supabase, onRecovery, onError);
    await vi.waitFor(() => expect(captured).toBeTruthy());
    return { fire: (url: string) => captured!({ url }), onRecovery, onError, off };
  }

  it('is a no-op on web — the App plugin is never loaded', () => {
    isNativeMock.mockReturnValue(false);
    const off = registerNativeRecoveryListener(mkSupabase(), vi.fn(), vi.fn());
    expect(typeof off).toBe('function');
    off();
    expect(addListenerMock).not.toHaveBeenCalled();
  });

  it('exchanges the code and sends the user to the reset form', async () => {
    const supabase = mkSupabase();
    const { fire, onRecovery, onError } = await register(supabase);

    fire(`${NATIVE_RESET_CALLBACK}?code=rec123`);

    await vi.waitFor(() => expect(onRecovery).toHaveBeenCalledWith('/reset-password'));
    expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith('rec123');
    expect(onError).not.toHaveBeenCalled();
  });

  it('still navigates when the exchange fails, so the user sees an honest expired-link screen', async () => {
    const supabase = mkSupabase();
    supabase.auth.exchangeCodeForSession.mockResolvedValue({
      data: {},
      error: { message: 'code expired' },
    });
    const { fire, onRecovery, onError } = await register(supabase);

    fire(`${NATIVE_RESET_CALLBACK}?code=stale`);

    await vi.waitFor(() => expect(onRecovery).toHaveBeenCalledWith('/reset-password'));
    expect(onError).toHaveBeenCalledWith('code expired');
  });

  it('does not answer the OAuth callback — the two listeners never overlap', async () => {
    const supabase = mkSupabase();
    const { fire, onRecovery } = await register(supabase);

    fire(`${NATIVE_AUTH_CALLBACK}?code=oauth`);

    await new Promise((r) => setTimeout(r, 10));
    expect(supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(onRecovery).not.toHaveBeenCalled();
  });

  it('exchanges a given code ONCE even if the URL arrives twice', async () => {
    // A cold launch can surface the same URL through getLaunchUrl AND the
    // listener. A second exchange of one code fails and clobbers the session
    // the first one just established.
    const supabase = mkSupabase();
    const { fire, onRecovery } = await register(supabase);

    fire(`${NATIVE_RESET_CALLBACK}?code=dup`);
    fire(`${NATIVE_RESET_CALLBACK}?code=dup`);

    await vi.waitFor(() => expect(onRecovery).toHaveBeenCalled());
    expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
  });
});

describe('cold start', () => {
  it('picks up the link that LAUNCHED the app, not just warm re-entry', async () => {
    // The common case for an emailed reset link: the user is in Mail and the
    // app is not running. Handling only appUrlOpen works every time you test
    // it with the app open and fails for the people it was built for.
    isNativeMock.mockReturnValue(true);
    getLaunchUrlMock.mockResolvedValue({ url: `${NATIVE_RESET_CALLBACK}?code=cold` });
    const supabase = mkSupabase();
    const onRecovery = vi.fn();

    registerNativeRecoveryListener(supabase, onRecovery, vi.fn());

    await vi.waitFor(() => expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith('cold'));
    expect(onRecovery).toHaveBeenCalledWith('/reset-password');
  });

  it('ignores a launch URL belonging to someone else', async () => {
    isNativeMock.mockReturnValue(true);
    getLaunchUrlMock.mockResolvedValue({ url: 'citrussports://league-invite/xyz' });
    const supabase = mkSupabase();

    registerNativeRecoveryListener(supabase, vi.fn(), vi.fn());

    await new Promise((r) => setTimeout(r, 10));
    expect(supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('degrades to warm-launch-only when the plugin has no getLaunchUrl', async () => {
    // Regression guard: calling it outright rejected the whole registration on
    // a plugin build without it, taking the warm listener down too.
    isNativeMock.mockReturnValue(true);
    const { App } = await import('@capacitor/app');
    const saved = (App as unknown as Record<string, unknown>).getLaunchUrl;
    delete (App as unknown as Record<string, unknown>).getLaunchUrl;
    try {
      const supabase = mkSupabase();
      let captured: ((e: { url: string }) => void) | null = null;
      addListenerMock.mockImplementation(async (_evt: string, cb: (e: { url: string }) => void) => {
        captured = cb;
        return { remove: vi.fn() };
      });
      const onRecovery = vi.fn();
      registerNativeRecoveryListener(supabase, onRecovery, vi.fn());

      await vi.waitFor(() => expect(captured).toBeTruthy());
      captured!({ url: `${NATIVE_RESET_CALLBACK}?code=warm` });
      await vi.waitFor(() => expect(onRecovery).toHaveBeenCalledWith('/reset-password'));
    } finally {
      (App as unknown as Record<string, unknown>).getLaunchUrl = saved;
    }
  });
});
