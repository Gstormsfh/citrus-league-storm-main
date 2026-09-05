/**
 * TERMS SIGN-OFF (2026-09-05).
 *
 * Measured on prod the night this was written: 72 profiles, 0 with any
 * consent on record. The machinery existed (policy_versions,
 * user_privacy_consent, record_user_consent) and nothing reached it -- the
 * email signup recorded consent only when it already had a session, which
 * a confirm-your-email signup never has, and an Apple or Google signup
 * never asked. So the Account screen told every manager their terms were
 * "Not recorded", and it was right.
 *
 * Two pieces, the way every app that ships terms does it:
 *
 *  1. The signup that CHECKED THE BOX remembers which version it accepted
 *     (localStorage), so the first authenticated session can record it
 *     without asking twice.
 *  2. TermsGate: on the first session where a policy is `never_given` or
 *     `outdated`, one sheet -- "Before you play" -- with the two links and
 *     one button. Agreeing records both. `withdrawn` is deliberate and is
 *     not nagged; the Account screen re-grants it.
 *
 * The version a user must hold comes from the server's status read
 * (`required_version`, from policy_versions), never from a constant here.
 */
import type { ConsentStatus } from '@/services/UserAccountService';

/** Fired on `window` when consent is recorded outside the Account screen. */
export const CONSENT_CHANGED_EVENT = 'citrus:consent-changed';

export function announceConsentChanged(): void {
  try {
    window.dispatchEvent(new Event(CONSENT_CHANGED_EVENT));
  } catch {
    /* no window */
  }
}

/** localStorage key: the policy version the signup form accepted. */
export const SIGNUP_CONSENT_KEY = 'citrus.consent.signup';

/** The version the signup form's checkbox refers to (the linked documents). */
export const SIGNUP_POLICY_VERSION = '2026-01-13';

/** The policies the gate asks for: never recorded, or recorded for an older version. */
export function consentDue(rows: ConsentStatus[]): ConsentStatus[] {
  return rows.filter((r) => r.status === 'never_given' || r.status === 'outdated');
}

export function rememberSignupConsent(version: string): void {
  try {
    window.localStorage.setItem(SIGNUP_CONSENT_KEY, version);
  } catch {
    /* private mode: the gate asks instead */
  }
}

export function readSignupConsent(): string | null {
  try {
    return window.localStorage.getItem(SIGNUP_CONSENT_KEY);
  } catch {
    return null;
  }
}

export function clearSignupConsent(): void {
  try {
    window.localStorage.removeItem(SIGNUP_CONSENT_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** True when the signup form already accepted exactly the versions now due. */
export function signupCoversDue(due: ConsentStatus[], accepted: string | null): boolean {
  return due.length > 0 && accepted !== null && due.every((r) => r.required_version === accepted);
}

/**
 * Where the gate stands down: the sign-in flow's own screens (a recovery
 * session on /reset-password is a user, and the sheet would cover the
 * form), and a live draft, where a sheet over the board on the clock is
 * the wrong moment. It shows on the next screen instead.
 */
export function termsGateSuppressed(pathname: string): boolean {
  const p = pathname.toLowerCase();
  return ['/auth', '/reset-password', '/verify-email', '/draft'].some((x) => p === x || p.startsWith(`${x}/`));
}
