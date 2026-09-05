/**
 * ResetPassword — PKCE recovery detection (2026-08-26).
 *
 * THE BUG THIS LOCKS. The Supabase client runs `flowType: 'pkce'` with
 * `detectSessionInUrl: true`, so a recovery link lands here as `?code=` and
 * supabase-js exchanges it on load and strips it from the URL. The page was
 * looking for two things PKCE never produces — `#access_token&type=recovery`
 * (the implicit flow) and `?token=` (the older verify style) — and gating the
 * whole form behind finding one of them. Every user who clicked a reset link
 * was told it was invalid, including the ones whose session had just been
 * established successfully. Requesting a new link hit the identical dead end.
 *
 * These are RENDER tests rather than the source-reading style used by
 * Auth.silentDeadEnd.test.tsx, because the defect was behavioural: the source
 * looked perfectly reasonable, it just watched for a parameter that no longer
 * arrives. Only driving the auth events catches that.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

type AuthCb = (event: string, session: unknown) => void;

const { onAuthStateChangeMock, getSessionMock, unsubscribeMock } = vi.hoisted(() => ({
  onAuthStateChangeMock: vi.fn(),
  getSessionMock: vi.fn(),
  unsubscribeMock: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      onAuthStateChange: onAuthStateChangeMock,
      getSession: getSessionMock,
    },
  },
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ updatePassword: vi.fn(async () => ({ error: null })) }),
}));
vi.mock('@/components/Navbar', () => ({ default: () => null }));
vi.mock('@/components/citrus2', () => ({
  DarkLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/auth/PasswordStrength', () => ({ PasswordStrength: () => null }));

import ResetPassword from '../ResetPassword';

/** Captures the auth listener so a test can emit events into the page. */
let emit: AuthCb = () => {};

const renderAt = (search = '') =>
  render(
    <MemoryRouter initialEntries={[`/reset-password${search}`]}>
      <ResetPassword />
    </MemoryRouter>,
  );

beforeEach(() => {
  window.location.hash = '';
  onAuthStateChangeMock.mockReset().mockImplementation((cb: AuthCb) => {
    emit = cb;
    return { data: { subscription: { unsubscribe: unsubscribeMock } } };
  });
  // Default: no session yet — the exchange has not finished.
  getSessionMock.mockReset().mockResolvedValue({ data: { session: null } });
  unsubscribeMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

const form = () => screen.queryByText('Choose a new password');
const invalid = () => screen.queryByText('That link is done');

describe('a PKCE recovery link', () => {
  it('shows the form when the session arrives by event, with NOTHING in the URL', async () => {
    // The exact production case. detectSessionInUrl consumed `?code=` and
    // cleaned the URL before this component ever mounted, so there is no
    // parameter left to find — only the session proves the link was good.
    renderAt();
    emit('SIGNED_IN', { user: { id: 'u1' } });

    await waitFor(() => expect(form()).toBeTruthy());
    expect(invalid()).toBeNull();
  });

  it('accepts the PASSWORD_RECOVERY event too', async () => {
    renderAt();
    emit('PASSWORD_RECOVERY', { user: { id: 'u1' } });

    await waitFor(() => expect(form()).toBeTruthy());
  });

  it('shows the form when the exchange finished before mount (getSession already has one)', async () => {
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    renderAt();

    await waitFor(() => expect(form()).toBeTruthy());
  });

  it('registers the listener BEFORE asking for the session', () => {
    // Ordering is the whole trick: detectSessionInUrl can complete while
    // getSession() is in flight, and a listener attached afterwards misses it.
    const order: string[] = [];
    onAuthStateChangeMock.mockImplementation((cb: AuthCb) => {
      order.push('listen');
      emit = cb;
      return { data: { subscription: { unsubscribe: unsubscribeMock } } };
    });
    getSessionMock.mockImplementation(async () => {
      order.push('getSession');
      return { data: { session: null } };
    });

    renderAt();

    expect(order[0]).toBe('listen');
  });

  it('does not flash "Invalid Reset Link" while the exchange is still running', () => {
    renderAt();

    expect(invalid()).toBeNull();
    expect(screen.getByText('Checking your reset link…')).toBeTruthy();
  });

  it('ignores a SIGNED_IN carrying no session', async () => {
    vi.useFakeTimers();
    renderAt();
    emit('SIGNED_IN', null);

    await vi.advanceTimersByTimeAsync(6100);
    expect(form()).toBeNull();
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderAt();
    unmount();
    expect(unsubscribeMock).toHaveBeenCalled();
  });
});

describe('links that legitimately have nothing behind them', () => {
  it('reports an invalid link once the grace period passes with no session', async () => {
    vi.useFakeTimers();
    renderAt();

    await vi.advanceTimersByTimeAsync(6100);

    expect(invalid()).toBeTruthy();
    expect(form()).toBeNull();
  });

  it('a late session still rescues the page after the grace period', async () => {
    // accept() stays live past the timeout on purpose: a slow exchange should
    // correct the message, not be locked out by it.
    vi.useFakeTimers();
    renderAt();
    await vi.advanceTimersByTimeAsync(6100);
    expect(invalid()).toBeTruthy();

    emit('SIGNED_IN', { user: { id: 'u1' } });

    await vi.waitFor(() => expect(form()).toBeTruthy());
    expect(invalid()).toBeNull();
  });
});

describe('legacy link shapes still work', () => {
  it('accepts the pre-PKCE ?token= form', async () => {
    renderAt('?token=legacy123');
    await waitFor(() => expect(form()).toBeTruthy());
  });

  it('accepts the implicit-flow #access_token&type=recovery form', async () => {
    window.location.hash = '#access_token=abc&type=recovery';
    renderAt();
    await waitFor(() => expect(form()).toBeTruthy());
  });
});
