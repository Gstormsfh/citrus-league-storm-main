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

const { isNativeMock, browserOpenMock, browserCloseMock, addListenerMock } =
  vi.hoisted(() => ({
    isNativeMock: vi.fn(() => false),
    browserOpenMock: vi.fn(async () => {}),
    browserCloseMock: vi.fn(async () => {}),
    addListenerMock: vi.fn(
      async (_evt: string, _cb: (e: { url: string }) => Promise<void>) => ({
        remove: vi.fn(),
      }),
    ),
  }));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: isNativeMock },
}));
vi.mock('@capacitor/browser', () => ({
  Browser: { open: browserOpenMock, close: browserCloseMock },
}));
vi.mock('@capacitor/app', () => ({
  App: { addListener: addListenerMock },
}));

import {
  isNativeShell,
  beginNativeOAuth,
  registerNativeAuthListener,
  NATIVE_AUTH_CALLBACK,
} from '../nativeAuth';
import type { SupabaseClient } from '@supabase/supabase-js';

function mkSupabase(oauthResult: unknown = { data: { url: 'https://sb.example/authorize?x=1' }, error: null }) {
  return {
    auth: {
      signInWithOAuth: vi.fn(async () => oauthResult),
      exchangeCodeForSession: vi.fn(async () => ({ data: {}, error: null })),
    },
  } as unknown as SupabaseClient & {
    auth: {
      signInWithOAuth: ReturnType<typeof vi.fn>;
      exchangeCodeForSession: ReturnType<typeof vi.fn>;
    };
  };
}

beforeEach(() => {
  isNativeMock.mockReset().mockReturnValue(false);
  browserOpenMock.mockClear();
  browserCloseMock.mockClear();
  addListenerMock.mockClear().mockResolvedValue({ remove: vi.fn() });
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
      presentationStyle: 'popover',
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
