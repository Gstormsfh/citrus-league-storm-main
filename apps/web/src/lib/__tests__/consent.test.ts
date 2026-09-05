/**
 * lib/consent: the pure half of the terms gate. What is due, what the
 * signup form's remembered version covers, where the gate stands down.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  consentDue,
  rememberSignupConsent,
  readSignupConsent,
  clearSignupConsent,
  signupCoversDue,
  termsGateSuppressed,
  SIGNUP_CONSENT_KEY,
} from '../consent';
import type { ConsentStatus } from '@/services/UserAccountService';

const row = (policy_type: string, status: ConsentStatus['status'], required_version = '2026-01-13'): ConsentStatus => ({
  policy_type,
  status,
  required_version,
  consented_version: status === 'current' ? required_version : null,
  consented_at: null,
  withdrawn_at: null,
});

describe('consentDue', () => {
  it('asks for never_given and outdated, leaves current and withdrawn alone', () => {
    const due = consentDue([
      row('terms_of_service', 'never_given'),
      row('privacy_policy', 'outdated'),
      row('cookies', 'current'),
      row('marketing', 'withdrawn'),
    ]);
    expect(due.map((r) => r.policy_type)).toEqual(['terms_of_service', 'privacy_policy']);
  });
  it('is empty when everything is current', () => {
    expect(consentDue([row('terms_of_service', 'current'), row('privacy_policy', 'current')])).toEqual([]);
  });
});

describe('the signup marker', () => {
  beforeEach(() => window.localStorage.clear());
  it('round-trips through localStorage under one key', () => {
    expect(readSignupConsent()).toBeNull();
    rememberSignupConsent('2026-01-13');
    expect(window.localStorage.getItem(SIGNUP_CONSENT_KEY)).toBe('2026-01-13');
    expect(readSignupConsent()).toBe('2026-01-13');
    clearSignupConsent();
    expect(readSignupConsent()).toBeNull();
  });
  it('covers the due policies only when every required version is the one accepted', () => {
    const due = [row('terms_of_service', 'never_given'), row('privacy_policy', 'never_given')];
    expect(signupCoversDue(due, '2026-01-13')).toBe(true);
    expect(signupCoversDue(due, '2025-12-01')).toBe(false);
    expect(signupCoversDue(due, null)).toBe(false);
    expect(signupCoversDue([], '2026-01-13')).toBe(false);
    // The terms moved on after the box was checked: the gate asks.
    expect(signupCoversDue([row('terms_of_service', 'outdated', '2026-09-01'), row('privacy_policy', 'never_given')], '2026-01-13')).toBe(false);
  });
});

describe('termsGateSuppressed', () => {
  it('stands down on the sign-in flow and in the draft room', () => {
    for (const p of ['/auth', '/auth/callback', '/reset-password', '/verify-email', '/draft/abc', '/DRAFT/abc']) {
      expect(termsGateSuppressed(p), p).toBe(true);
    }
  });
  it('shows everywhere else', () => {
    for (const p of ['/', '/profile', '/scores', '/league/abc', '/roster', '/authors']) {
      expect(termsGateSuppressed(p), p).toBe(false);
    }
  });
});
