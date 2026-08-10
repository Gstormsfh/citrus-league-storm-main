// T12P-2 (Entry 39 hostile pass, 2026-08-10) — VerifyEmail.tsx already-
// verified redirect + COPY_VOICE conformance.
//
// P0-CANDIDATE FIX: pre-fix, a signed-in verified user landing on
// /verify-email saw the "Check Your Email" card with their own email
// and no acknowledgment they didn't need to verify (stale email link,
// browser back-nav, bookmark visit). The fix redirects home when
// `user.email_confirmed_at` is truthy. The `email_confirmed_at` gate
// preserves the rare session-without-confirmation edge (still show
// the verify card there).
//
// COPY_VOICE polish locks: banned "Failed to send" purged; error copy
// carries the door (retry / try again) per COPY_VOICE.md rule 3.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const VERIFY_PATH = resolve(HERE, '..', 'VerifyEmail.tsx');

const mockUseAuth = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));
vi.mock('@/components/Navbar', () => ({
  default: () => null,
}));
vi.mock('@/components/citrus2', () => ({
  DarkLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MascotAvatar: () => null,
}));

import VerifyEmail from '../VerifyEmail';

function HomeProbe() {
  return <div data-testid="home-probe">HOME</div>;
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/verify-email']}>
      <Routes>
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/" element={<HomeProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('VerifyEmail — T12P-2 already-verified redirect (Entry 39 P0-candidate)', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
  });

  it('unauthenticated: renders the verify card (no redirect)', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      resendVerificationEmail: vi.fn(),
    });
    renderApp();
    expect(screen.getByText(/Check Your Email/i)).toBeTruthy();
    expect(screen.queryByTestId('home-probe')).toBeNull();
  });

  it('authenticated but UN-verified: renders the verify card (still needs verify)', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'test@example.com', email_confirmed_at: null },
      resendVerificationEmail: vi.fn(),
    });
    renderApp();
    expect(screen.getByText(/Check Your Email/i)).toBeTruthy();
    expect(screen.queryByTestId('home-probe')).toBeNull();
  });

  it('authenticated + verified: redirects to home (kills the dead-end)', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'test@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' },
      resendVerificationEmail: vi.fn(),
    });
    renderApp();
    expect(screen.getByTestId('home-probe')).toBeTruthy();
    expect(screen.queryByText(/Check Your Email/i)).toBeNull();
  });
});

describe('VerifyEmail — T12P-2 COPY_VOICE conformance', () => {
  const source = readFileSync(VERIFY_PATH, 'utf8');

  it('banned "Failed to send" copy is purged from all error paths', () => {
    // COPY_VOICE.md hard-ban: "Failed to fetch" / raw error codes surfaced
    // to users. "Failed to send verification email" was the pre-fix
    // fallback in the resend error branch.
    expect(source).not.toMatch(/Failed to send/);
    expect(source).not.toMatch(/'Failed to /);
    expect(source).not.toMatch(/"Failed to /);
  });

  it('resend fallback error carries a door (retry language)', () => {
    // Pre-fix: "Failed to send verification email. Please try again."
    // Post-fix must retain the "try again" door somewhere in the file
    // (either in the specific fallback OR generic catch).
    expect(source).toMatch(/try again/i);
  });

  it('no "unexpected error occurred" generic fallback (owns blame per COPY_VOICE rule 3)', () => {
    // Pre-fix: 'An unexpected error occurred.' — vague, doesn't own blame.
    // Post-fix: contextual "That resend hit a snag — try again in a moment."
    expect(source).not.toMatch(/[Uu]nexpected error occurred/);
  });

  it('no-email early-return message drops "Please" politeness padding', () => {
    // Pre-fix: 'No email address found. Please sign up again.'
    // Post-fix: "We don't have your email — sign up again to get a fresh link."
    // Match: no "Please sign up" phrase remains.
    expect(source).not.toMatch(/Please sign up/);
  });
});
