/**
 * OAUTH CANCEL (2026-09-03), found on device, submission-blocking.
 *
 * THE BUG THIS LOCKS. Auth.tsx sets `oauthLoading` when Apple or Google is
 * tapped and cleared it in exactly two places: the `if (error)` branch and the
 * `catch`. In the iOS shell, signInWithOAuth resolves with NO error the moment
 * the system browser sheet is up (lib/nativeAuth.ts, beginNativeOAuth), and
 * the session arrives later by the citrussports://auth-callback deep link. So
 * if the user cancels the sheet, or the provider fails inside it, nothing
 * fires: oauthLoading stays 'google' or 'apple', and every button on the
 * screen is `disabled={loading || oauthLoading !== null}` (the email form's
 * submit included) until the app is force-quit. Two symptoms, one cause:
 * after a Google attempt the email form is dead, and a cancelled Apple or
 * Google attempt freezes the login screen.
 *
 * The fix: a resume effect in Auth.tsx that treats "the app came back with no
 * session" as a first-class path. It clears the flag on the Browser plugin's
 * browserFinished (the user closed the sheet), on the App plugin's appUrlOpen
 * (the callback arrived, with a code or with ?error=) and appStateChange
 * (isActive: the app regained focus), and on the web's visibilitychange /
 * pageshow.
 *
 * Two layers, modelled on the house pattern:
 *   1. RENDER tests, the way ResetPassword.pkce.test.tsx drives its page: tap
 *      Google, deliver the resume signal, prove every button is usable again.
 *      The REAL CitrusButton is mounted, because its
 *      `disabled={loading || disabled}` is the line that freezes the screen.
 *   2. SOURCE contracts on Auth.tsx, the way Auth.silentDeadEnd.test.tsx locks
 *      its fix, with a detector self-test in the aiVoiceGuard idiom: a copy of
 *      the pre-fix handleOAuthSignIn must FAIL the check, so the guard cannot
 *      go green while guarding nothing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const AUTH_PATH = resolve(HERE, '..', 'Auth.tsx');

type AppStateHandler = (state: { isActive: boolean }) => void;
type UrlOpenHandler = (event: { url: string }) => void;

const {
  isNativeMock,
  appAddListenerMock,
  appRemoveMock,
  browserAddListenerMock,
  browserRemoveMock,
  browserOpenMock,
  browserCloseMock,
  signInWithOAuthMock,
} = vi.hoisted(() => ({
  isNativeMock: vi.fn(() => false),
  appAddListenerMock: vi.fn(),
  appRemoveMock: vi.fn(async () => {}),
  browserAddListenerMock: vi.fn(),
  browserRemoveMock: vi.fn(async () => {}),
  browserOpenMock: vi.fn(async () => {}),
  browserCloseMock: vi.fn(async () => {}),
  // The native contract (nativeAuth.ts): no error means "the hand-off to the
  // system browser happened", nothing more. No session, no navigation.
  signInWithOAuthMock: vi.fn(
    async (_provider: 'google' | 'apple'): Promise<{ error: { message: string } | null }> => ({ error: null }),
  ),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: isNativeMock },
}));
vi.mock('@capacitor/app', () => ({
  App: { addListener: appAddListenerMock },
}));
vi.mock('@capacitor/browser', () => ({
  Browser: { addListener: browserAddListenerMock, open: browserOpenMock, close: browserCloseMock },
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    signIn: vi.fn(async () => ({ error: null })),
    signUp: vi.fn(async () => ({ data: null, error: null })),
    resetPassword: vi.fn(async () => ({ error: null })),
    signInWithOAuth: signInWithOAuthMock,
  }),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null } })),
      setSession: vi.fn(async () => ({ data: {}, error: null })),
    },
  },
}));
vi.mock('@/services/UserAccountService', () => ({
  UserAccountService: { recordConsent: vi.fn() },
}));
vi.mock('@/lib/openExternal', () => ({ interceptExternal: () => false }));
vi.mock('@/components/Navbar', () => ({ default: () => null }));
vi.mock('@/components/auth/PasswordStrength', () => ({ PasswordStrength: () => null }));
vi.mock('@/components/citrus2', async () => {
  // The real button, on purpose: `disabled={loading || buttonProps.disabled}`
  // in CitrusButton.tsx is the exact line that freezes the screen, so a stub
  // that re-implemented it would be testing the stub.
  const { CitrusButton } = await import('@/components/citrus2/CitrusButton');
  return {
    CitrusButton,
    DarkLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    CitrusCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    CitrusLogo: () => null,
  };
});

import Auth from '../Auth';

/** The listeners Auth.tsx registered, keyed by event name. */
let captured: {
  appStateChange?: AppStateHandler;
  appUrlOpen?: UrlOpenHandler;
  browserFinished?: () => void;
} = {};

const renderAuth = (wrap: (node: React.ReactElement) => React.ReactElement = (n) => n) =>
  render(wrap(<MemoryRouter initialEntries={['/auth']}><Auth /></MemoryRouter>));

const google = () => screen.getByRole('button', { name: /Continue with Google/ }) as HTMLButtonElement;
const apple = () => screen.getByRole('button', { name: /Continue with Apple/ }) as HTMLButtonElement;
const submit = () => screen.getByRole('button', { name: /^Sign in$/ }) as HTMLButtonElement;
const everyButton = () => [google(), apple(), submit()];

/** Pin document.visibilityState, then fire visibilitychange, inside act. */
function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/** Tap Google and wait for the frozen state the bug leaves behind. */
async function tapGoogleUntilFrozen() {
  fireEvent.click(google());
  await waitFor(() => expect(signInWithOAuthMock).toHaveBeenCalledWith('google'));
  // The hand-off resolved with no error, and nothing else will ever fire on
  // its own. Pre-fix, this is where the screen stayed.
  await waitFor(() => expect(google().disabled).toBe(true));
  expect(apple().disabled).toBe(true);
  expect(submit().disabled).toBe(true);
}

afterEach(() => {
  // A pinned visibilityState must not outlive its test.
  delete (document as unknown as Record<string, unknown>).visibilityState;
});

beforeEach(() => {
  captured = {};
  isNativeMock.mockReset().mockReturnValue(false);
  signInWithOAuthMock.mockClear().mockResolvedValue({ error: null });
  appRemoveMock.mockClear();
  browserRemoveMock.mockClear();
  browserOpenMock.mockClear();
  browserCloseMock.mockClear();
  appAddListenerMock.mockReset().mockImplementation(async (evt: string, cb: (...args: any[]) => void) => {
    if (evt === 'appStateChange') captured.appStateChange = cb;
    if (evt === 'appUrlOpen') captured.appUrlOpen = cb;
    return { remove: appRemoveMock };
  });
  browserAddListenerMock.mockReset().mockImplementation(async (evt: string, cb: () => void) => {
    if (evt === 'browserFinished') captured.browserFinished = cb;
    return { remove: browserRemoveMock };
  });
});

// ===========================================================================
// RENDER: the native shell
// ===========================================================================

describe('native: a cancelled or failed OAuth attempt hands the screen back', () => {
  beforeEach(() => {
    isNativeMock.mockReturnValue(true);
  });

  it('registers the resume signals on mount, and only in the shell', async () => {
    renderAuth();
    await waitFor(() => expect(captured.appStateChange).toBeTypeOf('function'));
    await waitFor(() => expect(captured.appUrlOpen).toBeTypeOf('function'));
    await waitFor(() => expect(captured.browserFinished).toBeTypeOf('function'));
    expect(appAddListenerMock).toHaveBeenCalledWith('appStateChange', expect.any(Function));
    expect(appAddListenerMock).toHaveBeenCalledWith('appUrlOpen', expect.any(Function));
    expect(browserAddListenerMock).toHaveBeenCalledWith('browserFinished', expect.any(Function));
  });

  it('SYMPTOM B: tap Google, cancel the sheet, the app resumes with no session: every button is enabled again', async () => {
    renderAuth();
    await waitFor(() => expect(captured.appStateChange).toBeTypeOf('function'));

    await tapGoogleUntilFrozen();

    // The sheet going UP resigns the app. That is not a resume and must not
    // clear the spinner while the provider page is still in front of the user.
    act(() => captured.appStateChange!({ isActive: false }));
    expect(google().disabled).toBe(true);
    expect(apple().disabled).toBe(true);

    // The user taps Cancel or Done. iOS hands the app back; no deep link fires.
    act(() => captured.appStateChange!({ isActive: true }));

    await waitFor(() => expect(google().disabled).toBe(false));
    for (const b of everyButton()) expect(b.disabled).toBe(false);
    // The spinner is gone too: the button is back to its idle content.
    expect(google().querySelector('svg.animate-spin')).toBeNull();
  });

  it('SYMPTOM A: after a Google attempt the email form can be submitted again', async () => {
    renderAuth();
    await waitFor(() => expect(captured.appStateChange).toBeTypeOf('function'));
    await tapGoogleUntilFrozen();
    expect(submit().disabled).toBe(true);

    act(() => captured.appStateChange!({ isActive: true }));

    await waitFor(() => expect(submit().disabled).toBe(false));
    // Typing was never the problem (inputs are not gated); submitting was.
    fireEvent.change(screen.getByLabelText(/^Email$/), { target: { value: 'gm@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password$/), { target: { value: 'correct-horse' } });
    expect(submit().disabled).toBe(false);
  });

  it('browserFinished (the user swiped the sheet away) also hands the screen back', async () => {
    // The Browser plugin fires this from safariViewControllerDidFinish and
    // presentationControllerDidDismiss, and NOT from the programmatic
    // Browser.close() the success path uses, so it is a pure cancel signal.
    renderAuth();
    await waitFor(() => expect(captured.browserFinished).toBeTypeOf('function'));
    await tapGoogleUntilFrozen();

    act(() => captured.browserFinished!());

    await waitFor(() => expect(google().disabled).toBe(false));
    for (const b of everyButton()) expect(b.disabled).toBe(false);
  });

  it('the provider fails INSIDE the sheet: the ?error= callback arrives by deep link and hands the screen back', async () => {
    // Supabase redirects a provider-side failure to
    // citrussports://auth-callback?error=... The deep link fires appUrlOpen;
    // nativeAuth.ts then closes the sheet with Browser.close(), which is
    // programmatic and therefore fires NO browserFinished. Without this
    // signal a misconfigured provider (the Apple dashboard problem) froze
    // the screen exactly like a cancel did.
    renderAuth();
    await waitFor(() => expect(captured.appUrlOpen).toBeTypeOf('function'));
    await tapGoogleUntilFrozen();

    act(() => captured.appUrlOpen!({ url: 'citrussports://auth-callback?error=access_denied' }));

    await waitFor(() => expect(google().disabled).toBe(false));
    for (const b of everyButton()) expect(b.disabled).toBe(false);
  });

  it('works for Apple too: the flag is per-provider, the clear is not', async () => {
    renderAuth();
    await waitFor(() => expect(captured.appStateChange).toBeTypeOf('function'));

    fireEvent.click(apple());
    await waitFor(() => expect(signInWithOAuthMock).toHaveBeenCalledWith('apple'));
    await waitFor(() => expect(apple().disabled).toBe(true));
    expect(google().disabled).toBe(true);

    act(() => captured.appStateChange!({ isActive: true }));

    await waitFor(() => expect(apple().disabled).toBe(false));
    for (const b of everyButton()) expect(b.disabled).toBe(false);
  });

  it('a genuine failure still surfaces its error and clears the flag on its own', async () => {
    // The pre-existing path is untouched: an error from the hand-off itself
    // (say, the redirect URL is not allow-listed) clears immediately and
    // needs no resume signal.
    signInWithOAuthMock.mockResolvedValue({ error: { message: 'provider is not enabled' } });
    renderAuth();
    await waitFor(() => expect(captured.appStateChange).toBeTypeOf('function'));

    fireEvent.click(google());

    await waitFor(() => expect(google().disabled).toBe(false));
    expect(screen.getByText(/isn't hooked up yet/)).toBeTruthy();
  });

  it('removes all three native listeners on unmount', async () => {
    const { unmount } = renderAuth();
    await waitFor(() => expect(captured.appStateChange).toBeTypeOf('function'));
    await waitFor(() => expect(captured.appUrlOpen).toBeTypeOf('function'));
    await waitFor(() => expect(captured.browserFinished).toBeTypeOf('function'));

    unmount();

    // Two App handles (appUrlOpen, appStateChange) share appRemoveMock.
    expect(appRemoveMock).toHaveBeenCalledTimes(2);
    expect(browserRemoveMock).toHaveBeenCalledTimes(1);
  });

  it('a registration that lands after cleanup is removed: unmount before the plugins resolve', async () => {
    // Registration is asynchronous (the plugins are dynamic imports), so a
    // teardown can land BEFORE the listeners do. That is exactly the shape of
    // StrictMode's simulated unmount, and of a user who leaves /auth within a
    // tick of arriving. Those handles must be removed on arrival, not kept.
    // Driven directly here so the assertion does not depend on how many times
    // the React build in use chooses to run the effect.
    const { unmount } = renderAuth();
    expect(appAddListenerMock).not.toHaveBeenCalled();
    expect(browserAddListenerMock).not.toHaveBeenCalled();

    unmount();

    // The in-flight registration still completes (2 App + 1 Browser) and
    // every handle it produces is removed the moment it resolves.
    await waitFor(() => expect(appAddListenerMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(browserAddListenerMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(appRemoveMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(browserRemoveMock).toHaveBeenCalledTimes(1));
  });

  it('StrictMode double-mount leaks nothing and the surviving listener is live', async () => {
    // How many times React runs the effect under StrictMode is a property of
    // the React build and the test runner, not of Auth.tsx (observed here:
    // React 18.3.1 + vitest 4 registered 2 App handles and removed 2 before
    // any unmount; the arithmetic that assumed 4/2 was wrong twice). So this
    // asserts the invariant instead of the count: at no point is more than one
    // mount's worth of handles alive (2 App, 1 Browser), and after unmount
    // every handle that was ever registered has been removed.
    const { unmount } = renderAuth((node) => <StrictMode>{node}</StrictMode>);

    await waitFor(() => expect(captured.appStateChange).toBeTypeOf('function'));
    await waitFor(() => expect(captured.browserFinished).toBeTypeOf('function'));

    const live = () => ({
      app: appAddListenerMock.mock.calls.length - appRemoveMock.mock.calls.length,
      browser: browserAddListenerMock.mock.calls.length - browserRemoveMock.mock.calls.length,
    });
    expect(live().app).toBeLessThanOrEqual(2);
    expect(live().browser).toBeLessThanOrEqual(1);

    // The registered handler clears the stuck flag.
    await tapGoogleUntilFrozen();
    act(() => captured.appStateChange!({ isActive: true }));
    await waitFor(() => expect(google().disabled).toBe(false));
    expect(live().app).toBeLessThanOrEqual(2);
    expect(live().browser).toBeLessThanOrEqual(1);

    // Full teardown: nothing survives, however many times the effect ran.
    unmount();
    await waitFor(() => {
      expect(appAddListenerMock.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(browserAddListenerMock.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(live()).toEqual({ app: 0, browser: 0 });
    });
  });
});

// ===========================================================================
// RENDER: the web
// ===========================================================================

describe('web: the same stuck state cannot survive coming back to the tab', () => {
  it('never loads the native plugins in a browser', async () => {
    renderAuth();
    await tapGoogleUntilFrozen();
    expect(appAddListenerMock).not.toHaveBeenCalled();
    expect(browserAddListenerMock).not.toHaveBeenCalled();
  });

  it('visibilitychange back to visible re-enables every button; going hidden does not', async () => {
    // Back from the provider page restores this document from bfcache with
    // oauthLoading still set. visibilityState is pinned explicitly, the way
    // hooks/__tests__/useOnClockAlarm.test.tsx pins document.hidden, rather
    // than trusting the jsdom default.
    renderAuth();
    await tapGoogleUntilFrozen();

    setVisibility('hidden');
    expect(google().disabled).toBe(true);

    setVisibility('visible');

    await waitFor(() => expect(google().disabled).toBe(false));
    for (const b of everyButton()) expect(b.disabled).toBe(false);
  });

  it('pageshow re-enables every button', async () => {
    renderAuth();
    await tapGoogleUntilFrozen();

    act(() => {
      window.dispatchEvent(new Event('pageshow'));
    });

    await waitFor(() => expect(google().disabled).toBe(false));
    for (const b of everyButton()) expect(b.disabled).toBe(false);
  });

  it('removes the document and window listeners on unmount', () => {
    const docOff = vi.spyOn(document, 'removeEventListener');
    const winOff = vi.spyOn(window, 'removeEventListener');
    try {
      const { unmount } = renderAuth();
      unmount();
      expect(docOff).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
      expect(winOff).toHaveBeenCalledWith('pageshow', expect.any(Function));
    } finally {
      docOff.mockRestore();
      winOff.mockRestore();
    }
  });
});

// ===========================================================================
// SOURCE CONTRACTS on Auth.tsx, with a detector self-test
// ===========================================================================

/** The `useEffect(...)` block that contains `needle`, or null. */
function effectContaining(src: string, needle: RegExp): string | null {
  const at = src.search(needle);
  if (at === -1) return null;
  const start = src.lastIndexOf('useEffect(', at);
  if (start === -1) return null;
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  return null;
}

/** The full `addListener('appStateChange', ...)` call, parens balanced, or null. */
function appStateChangeCall(src: string): string | null {
  const at = src.search(/addListener\(\s*['"]appStateChange['"]/);
  if (at === -1) return null;
  let depth = 0;
  for (let i = src.indexOf('(', at); i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(at, i + 1);
  }
  return null;
}

/**
 * THE DETECTOR. True when `src` registers an appStateChange handler whose
 * callback, gated on isActive, clears oauthLoading: either `setOauthLoading(null)`
 * inline, or through a const defined in the same effect that does exactly that.
 * Exported to the self-test below so the sweep and the planted offender run the
 * same code.
 */
export function resumeClearsOauthLoading(src: string): boolean {
  const effect = effectContaining(src, /['"]appStateChange['"]/);
  const call = appStateChangeCall(src);
  if (!effect || !call) return false;
  if (!/isActive/.test(call)) return false;
  const clearers = ['setOauthLoading(null)'];
  const alias = /const\s+(\w+)\s*=\s*\(\)\s*=>\s*setOauthLoading\(null\)/g;
  let m: RegExpExecArray | null;
  while ((m = alias.exec(effect))) clearers.push(`${m[1]}()`);
  return clearers.some((c) => call.includes(c));
}

/**
 * The pre-fix handleOAuthSignIn, verbatim from Auth.tsx at 962ea416 (lines
 * 189-204): the flag is set on tap and cleared ONLY on error or throw. There is
 * no resume path anywhere in this shape, which is the whole bug.
 */
const OLD_SHAPE = `
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (signInSafetyTimeoutRef.current) clearTimeout(signInSafetyTimeoutRef.current);
    };
  }, []);

  const handleOAuthSignIn = async (provider: 'google' | 'apple') => {
    setError(null);
    setOauthLoading(provider);
    const providerLabel = provider === 'apple' ? 'Apple' : 'Google';
    try {
      const { error } = await signInWithOAuth(provider);
      // Route through getBetterErrorMessage so a provider that is not yet
      // enabled in Supabase degrades to warm copy ("That sign-in method
      // isn't hooked up yet…") instead of a raw API string.
      if (error) { setError(getBetterErrorMessage(error.message || \`Couldn't reach \${providerLabel}. Try again in a moment.\`)); setOauthLoading(null); }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? getBetterErrorMessage(err.message) : \`Couldn't reach \${providerLabel}. Try again in a moment.\`;
      setError(errorMessage);
      setOauthLoading(null);
    }
  };
`;

/** The minimal shape that satisfies the contract. */
const PLANTED_FIXED = `
  useEffect(() => {
    const clearStuckOAuth = () => setOauthLoading(null);
    let handle: { remove: () => void } | null = null;
    if (Capacitor.isNativePlatform()) {
      import('@capacitor/app').then(({ App }) =>
        App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) clearStuckOAuth();
        }).then((h) => { handle = h; }),
      );
    }
    return () => { handle?.remove(); };
  }, []);
`;

/** Registers the event, never clears the flag: a listener that only logs. */
const PLANTED_REGISTERS_ONLY = `
  useEffect(() => {
    const clearStuckOAuth = () => setOauthLoading(null);
    void import('@capacitor/app').then(({ App }) =>
      App.addListener('appStateChange', ({ isActive }) => {
        logger.debug('[auth] appStateChange', isActive);
      }),
    );
    return () => { clearStuckOAuth; };
  }, []);
`;

/** Clears on every state change, including the app going INTO the background. */
const PLANTED_NO_ISACTIVE_GATE = `
  useEffect(() => {
    void import('@capacitor/app').then(({ App }) =>
      App.addListener('appStateChange', () => setOauthLoading(null)),
    );
  }, []);
`;

describe('Auth.tsx source contract: the resume path exists and clears the flag', () => {
  const source = readFileSync(AUTH_PATH, 'utf8');

  it('the current tree registers an appStateChange handler that clears oauthLoading', () => {
    expect(resumeClearsOauthLoading(source)).toBe(true);
  });

  it('the registration is gated on the native platform, the way nativeAuth.ts gates', () => {
    const effect = effectContaining(source, /['"]appStateChange['"]/);
    expect(effect).toBeTruthy();
    expect(effect!).toMatch(/Capacitor\.isNativePlatform\(\)/);
    // Both plugins arrive by dynamic import, as in nativeAuth.ts, so the web
    // bundle never carries them and a missing plugin cannot take the page down.
    expect(effect!).toMatch(/import\(\s*['"]@capacitor\/app['"]\s*\)/);
    expect(effect!).toMatch(/import\(\s*['"]@capacitor\/browser['"]\s*\)/);
  });

  it('also listens for browserFinished (the user closed the sheet) and appUrlOpen (the callback arrived)', () => {
    const effect = effectContaining(source, /['"]appStateChange['"]/);
    expect(effect!).toMatch(/addListener\(\s*['"]browserFinished['"]\s*,\s*clearStuckOAuth\s*\)/);
    expect(effect!).toMatch(/addListener\(\s*['"]appUrlOpen['"]\s*,\s*clearStuckOAuth\s*\)/);
  });

  it('carries the web guard: visibilitychange and pageshow, both removed on cleanup', () => {
    const effect = effectContaining(source, /['"]appStateChange['"]/);
    expect(effect!).toMatch(/document\.addEventListener\(\s*['"]visibilitychange['"]/);
    expect(effect!).toMatch(/window\.addEventListener\(\s*['"]pageshow['"]/);
    expect(effect!).toMatch(/document\.removeEventListener\(\s*['"]visibilitychange['"]/);
    expect(effect!).toMatch(/window\.removeEventListener\(\s*['"]pageshow['"]/);
    expect(effect!).toMatch(/visibilityState === ['"]visible['"]/);
  });

  it('removes the native listener handles on cleanup, including ones that resolve late', () => {
    const effect = effectContaining(source, /['"]appStateChange['"]/);
    expect(effect!).toMatch(/handle\.remove\(\)/);
    expect(effect!).toMatch(/removed = true/);
  });

  it('handleOAuthSignIn still sets the flag on tap and clears it on error and throw', () => {
    // The fix ADDS a path; it does not take the spinner away.
    const handler = source.slice(source.indexOf('const handleOAuthSignIn'));
    const body = handler.slice(0, handler.indexOf('const handleForgotPassword'));
    expect(body).toMatch(/setOauthLoading\(provider\)/);
    expect(body).toMatch(/if \(error\) \{[\s\S]*?setOauthLoading\(null\);\s*\}/);
    expect(body).toMatch(/catch \(err: unknown\) \{[\s\S]*?setOauthLoading\(null\);/);
  });

  it('every OAuth and submit button on the screen is still gated on oauthLoading', () => {
    // The gate is what makes the flag dangerous, and the reason the resume
    // path must clear it. If a refactor drops the gate this contract is moot
    // and should be rewritten, not deleted.
    const gates = source.match(/disabled=\{[^}]*oauthLoading !== null[^}]*\}/g) ?? [];
    expect(gates.length).toBeGreaterThanOrEqual(6);
  });
});

describe('the detector bites (self-test)', () => {
  it('FAILS the pre-fix handleOAuthSignIn shape: no resume path at all', () => {
    expect(OLD_SHAPE).toMatch(/setOauthLoading\(provider\)/);
    expect(OLD_SHAPE).not.toMatch(/appStateChange|appUrlOpen|browserFinished|visibilitychange|pageshow/);
    expect(resumeClearsOauthLoading(OLD_SHAPE)).toBe(false);
  });

  it('PASSES the minimal fixed shape', () => {
    expect(resumeClearsOauthLoading(PLANTED_FIXED)).toBe(true);
  });

  it('FAILS a handler that registers the event but never clears the flag', () => {
    expect(resumeClearsOauthLoading(PLANTED_REGISTERS_ONLY)).toBe(false);
  });

  it('FAILS a handler that clears on every state change instead of on resume', () => {
    expect(resumeClearsOauthLoading(PLANTED_NO_ISACTIVE_GATE)).toBe(false);
  });

  it('FAILS the current tree with its resume clear removed', () => {
    // Bidirectional: take the real file, blank the one line that clears, and
    // the guard must go red. If it stays green the detector is reading the
    // wrong block.
    const source = readFileSync(AUTH_PATH, 'utf8');
    const broken = source.replace(/if \(isActive\) clearStuckOAuth\(\);/, 'if (isActive) noop();');
    expect(broken).not.toBe(source);
    expect(resumeClearsOauthLoading(broken)).toBe(false);
  });
});
