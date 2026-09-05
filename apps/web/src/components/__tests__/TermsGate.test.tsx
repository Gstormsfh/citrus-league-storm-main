/**
 * THE TERMS GATE (2026-09-05).
 *
 * Prod the night this was written: 72 profiles, 0 consent records. The
 * gate is what turns that around, so the contract is pinned end to end:
 * nothing for a signed-out user or a current account; the sheet when a
 * policy is never_given or outdated; one AGREE records every due policy;
 * the signup form's remembered version records silently, no second ask;
 * and the gate stands down on the sign-in flow's own screens.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const mockUseAuth = vi.fn();
const mockGetConsentStatus = vi.fn();
const mockGrantConsent = vi.fn();
const mockSignOut = vi.fn(async () => {});

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => mockUseAuth() }));
vi.mock('@/services/UserAccountService', () => ({
  UserAccountService: {
    getConsentStatus: (...a: unknown[]) => mockGetConsentStatus(...a),
    grantConsent: (...a: unknown[]) => mockGrantConsent(...a),
  },
}));
vi.mock('@/lib/openExternal', () => ({ interceptExternal: () => false }));
vi.mock('@/utils/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@/components/pressbox/Sheet', () => ({
  PressBoxSheet: ({ open, children, title }: { open: boolean; children: ReactNode; title: string }) =>
    open ? <div role="dialog" aria-label={title}>{children}</div> : null,
}));

import { TermsGate } from '../TermsGate';
import { SIGNUP_CONSENT_KEY } from '@/lib/consent';

const USER = { id: 'u1', email: 'g@example.com' };
const row = (policy_type: string, status: string, required_version = '2026-01-13') => ({
  policy_type, status, required_version, consented_version: null, consented_at: null, withdrawn_at: null,
});

function renderAt(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TermsGate />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mockUseAuth.mockReturnValue({ user: USER, signOut: mockSignOut });
  mockGrantConsent.mockResolvedValue({ success: true });
});

describe('TermsGate', () => {
  it('renders nothing and reads nothing for a signed-out user', () => {
    mockUseAuth.mockReturnValue({ user: null, signOut: mockSignOut });
    renderAt();
    expect(mockGetConsentStatus).not.toHaveBeenCalled();
    expect(screen.queryByTestId('terms-gate')).toBeNull();
  });

  it('renders nothing when every policy is current', async () => {
    mockGetConsentStatus.mockResolvedValue({ success: true, data: [row('terms_of_service', 'current'), row('privacy_policy', 'current')] });
    renderAt();
    await waitFor(() => expect(mockGetConsentStatus).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(screen.queryByTestId('terms-gate')).toBeNull();
  });

  it('shows the sheet with both documents when nothing is on record, and AGREE records both', async () => {
    mockGetConsentStatus.mockResolvedValue({ success: true, data: [row('terms_of_service', 'never_given'), row('privacy_policy', 'never_given')] });
    renderAt('/profile');
    const gate = await screen.findByTestId('terms-gate');
    expect(gate).toHaveTextContent('Before you play');
    expect(screen.getByRole('link', { name: /Terms of Service/ })).toHaveAttribute('href', '/terms-of-service.html');
    expect(screen.getByRole('link', { name: /Privacy Policy/ })).toHaveAttribute('href', '/privacy-policy.html');

    const changed = vi.fn();
    window.addEventListener('citrus:consent-changed', changed);
    fireEvent.click(screen.getByTestId('terms-gate-agree'));
    await waitFor(() => expect(screen.queryByTestId('terms-gate')).toBeNull());
    expect(mockGrantConsent).toHaveBeenCalledWith('terms_of_service', '2026-01-13');
    expect(mockGrantConsent).toHaveBeenCalledWith('privacy_policy', '2026-01-13');
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('says the terms changed when a policy is outdated', async () => {
    mockGetConsentStatus.mockResolvedValue({ success: true, data: [row('terms_of_service', 'outdated', '2026-09-01'), row('privacy_policy', 'current')] });
    renderAt();
    const gate = await screen.findByTestId('terms-gate');
    expect(gate).toHaveTextContent('Updated terms');
    expect(gate).toHaveTextContent('2026-09-01');
    // Only the outdated one is listed and recorded.
    expect(screen.queryByRole('link', { name: /Privacy Policy/ })).toBeNull();
    fireEvent.click(screen.getByTestId('terms-gate-agree'));
    await waitFor(() => expect(mockGrantConsent).toHaveBeenCalledTimes(1));
    expect(mockGrantConsent).toHaveBeenCalledWith('terms_of_service', '2026-09-01');
  });

  it('records the signup form\'s remembered version silently, with no sheet', async () => {
    window.localStorage.setItem(SIGNUP_CONSENT_KEY, '2026-01-13');
    mockGetConsentStatus.mockResolvedValue({ success: true, data: [row('terms_of_service', 'never_given'), row('privacy_policy', 'never_given')] });
    renderAt();
    await waitFor(() => expect(mockGrantConsent).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(screen.queryByTestId('terms-gate')).toBeNull();
    expect(window.localStorage.getItem(SIGNUP_CONSENT_KEY)).toBeNull();
  });

  it('asks when the remembered version is not the one now required', async () => {
    window.localStorage.setItem(SIGNUP_CONSENT_KEY, '2025-06-01');
    mockGetConsentStatus.mockResolvedValue({ success: true, data: [row('terms_of_service', 'never_given'), row('privacy_policy', 'never_given')] });
    renderAt();
    await screen.findByTestId('terms-gate');
    expect(mockGrantConsent).not.toHaveBeenCalled();
  });

  it('keeps the sheet up with an error when recording fails', async () => {
    mockGetConsentStatus.mockResolvedValue({ success: true, data: [row('terms_of_service', 'never_given')] });
    mockGrantConsent.mockResolvedValue({ success: false, error: 'boom' });
    renderAt();
    await screen.findByTestId('terms-gate');
    fireEvent.click(screen.getByTestId('terms-gate-agree'));
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    expect(screen.getByTestId('terms-gate')).toBeInTheDocument();
  });

  it('does not lock the app when the status read fails', async () => {
    mockGetConsentStatus.mockResolvedValue({ success: false, error: 'offline' });
    renderAt();
    await waitFor(() => expect(mockGetConsentStatus).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByTestId('terms-gate')).toBeNull();
  });

  it('stands down on the sign-in flow\'s own screens', async () => {
    mockGetConsentStatus.mockResolvedValue({ success: true, data: [row('terms_of_service', 'never_given')] });
    renderAt('/reset-password');
    await waitFor(() => expect(mockGetConsentStatus).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByTestId('terms-gate')).toBeNull();
  });

  it('signs out and leaves for /auth on SIGN OUT INSTEAD', async () => {
    mockGetConsentStatus.mockResolvedValue({ success: true, data: [row('terms_of_service', 'never_given')] });
    renderAt();
    await screen.findByTestId('terms-gate');
    fireEvent.click(screen.getByRole('button', { name: /Sign out instead/ }));
    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
    expect(mockGrantConsent).not.toHaveBeenCalled();
  });
});
