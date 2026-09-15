/**
 * NATIVE APPLE FINISH (2026-09-15), found on device, submission-blocking.
 *
 * Build 22 replaced the Apple browser hand-off with the system sheet
 * (lib/nativeAuth.ts signInWithAppleNative). The sheet mints the Supabase
 * session BEFORE signInWithOAuth resolves, but handleOAuthSignIn still
 * treated a clean return as "the hand-off happened, the session arrives by
 * deep link", so it set nothing, navigated nowhere and waited. The auth
 * logs showed two successful id_token logins from the phone while the
 * screen stayed on the sign-in page.
 *
 * The contract now: signInWithOAuth reports `completed: true` on that path
 * and Auth.tsx finishes the way handleSignIn does (getSession, setSession
 * to fire the listener, navigate). `cancelled: true` (sheet dismissed)
 * clears the loading flag with no error, since no browserFinished will.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { signInWithOAuthMock, getSessionMock, setSessionMock } = vi.hoisted(() => ({
  signInWithOAuthMock: vi.fn(async (_p: 'google' | 'apple') => ({ error: null as { message: string } | null })),
  getSessionMock: vi.fn(async () => ({ data: { session: null as null | { access_token: string; refresh_token: string } } })),
  setSessionMock: vi.fn(async () => ({ data: {}, error: null })),
}));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(async () => ({ remove: async () => {} })) } }));
vi.mock('@capacitor/browser', () => ({ Browser: { addListener: vi.fn(async () => ({ remove: async () => {} })), open: vi.fn(), close: vi.fn() } }));
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
  supabase: { auth: { getSession: getSessionMock, setSession: setSessionMock } },
}));
vi.mock('@/services/UserAccountService', () => ({ UserAccountService: { recordConsent: vi.fn() } }));
vi.mock('@/lib/openExternal', () => ({ interceptExternal: () => false }));
vi.mock('@/components/Navbar', () => ({ default: () => null }));
vi.mock('@/components/auth/PasswordStrength', () => ({ PasswordStrength: () => null }));
vi.mock('@/components/citrus2', async () => {
  const { CitrusButton } = await import('@/components/citrus2/CitrusButton');
  return {
    CitrusButton,
    DarkLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    CitrusCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    CitrusLogo: () => null,
  };
});

import Auth from '../Auth';

const renderAuth = (entry = '/auth') =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="/" element={<div>HOME-MARKER</div>} />
        <Route path="/league/abc" element={<div>LEAGUE-MARKER</div>} />
      </Routes>
    </MemoryRouter>,
  );
const apple = () => screen.getByRole('button', { name: /Continue with Apple/ }) as HTMLButtonElement;
const google = () => screen.getByRole('button', { name: /Continue with Google/ }) as HTMLButtonElement;

beforeEach(() => {
  signInWithOAuthMock.mockClear();
  getSessionMock.mockReset().mockResolvedValue({ data: { session: null } });
  setSessionMock.mockClear();
});

describe('native Apple sign-in finishes on the page', () => {
  it('completed: confirms the session, re-sets it for the listener, and navigates home', async () => {
    signInWithOAuthMock.mockResolvedValue({ error: null, completed: true } as never);
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'a.b.c', refresh_token: 'r' } } });
    renderAuth();

    fireEvent.click(apple());

    await waitFor(() => expect(screen.getByText('HOME-MARKER')).toBeTruthy());
    expect(setSessionMock).toHaveBeenCalledWith({ access_token: 'a.b.c', refresh_token: 'r' });
  });

  it('completed with no session is an honest error, not a frozen screen', async () => {
    signInWithOAuthMock.mockResolvedValue({ error: null, completed: true } as never);
    renderAuth();

    fireEvent.click(apple());

    await waitFor(() => expect(screen.getByText(/Sign-in didn't complete/)).toBeTruthy());
    expect(apple().disabled).toBe(false);
    expect(setSessionMock).not.toHaveBeenCalled();
  });

  it('cancelled: the sheet was dismissed, every button comes back, nothing is shown', async () => {
    signInWithOAuthMock.mockResolvedValue({ error: null, cancelled: true } as never);
    renderAuth();

    fireEvent.click(apple());
    await waitFor(() => expect(signInWithOAuthMock).toHaveBeenCalledWith('apple'));

    await waitFor(() => expect(apple().disabled).toBe(false));
    expect(google().disabled).toBe(false);
    expect(screen.queryByText(/didn't complete|Couldn't reach/)).toBeNull();
  });

  it('a plain hand-off (Google, browser) is unchanged: no navigation, flag stays set for the resume effect', async () => {
    signInWithOAuthMock.mockResolvedValue({ error: null } as never);
    renderAuth();

    fireEvent.click(google());
    await waitFor(() => expect(google().disabled).toBe(true));

    expect(screen.queryByText('HOME-MARKER')).toBeNull();
    expect(getSessionMock).not.toHaveBeenCalled();
  });
});
