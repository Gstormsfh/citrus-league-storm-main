/**
 * THE ACCOUNT FLOW (2026-09-05), pinned at the source.
 *
 * What was found the night before submission, and must not come back:
 *  - the phone had NO sign out (the desktop's lives in a Navbar the phone
 *    does not draw);
 *  - the password form set a new password with no proof of the current one;
 *  - a Google or Apple account was offered a change-password form that
 *    could only fail for it, and no reset link;
 *  - 0 of 72 prod accounts had a consent record: the signup recorded only
 *    with a session it never had, and OAuth never asked. The gate mounts
 *    app-wide and the signup keeps its accepted version for it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(here, p), 'utf-8');
// `accept="image/*"` is not the start of a comment; blank it before stripping
// or everything up to the next `*/` disappears (the Account screen's rows did).
const strip = (s: string) =>
  s.replace(/"image\/\*"/g, '""').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const APP = strip(read('../App.tsx'));
const AUTH = strip(read('../pages/Auth.tsx'));
const PROFILE = strip(read('../pages/Profile.tsx'));
const PHONE = strip(read('../components/account/ProfilePhone.tsx'));
const SERVICE = strip(read('../services/UserAccountService.ts'));

describe('terms sign-off', () => {
  it('mounts the gate once, app-wide, inside the providers', () => {
    expect(APP).toContain('import { TermsGate } from "./components/TermsGate";');
    expect(APP.match(/<TermsGate \/>/g)).toHaveLength(1);
    expect(APP.indexOf('<TermsGate />')).toBeGreaterThan(APP.indexOf('<LeagueProvider>'));
  });
  it('remembers the accepted version at email signup and at the OAuth hand-off', () => {
    expect(AUTH).toContain("import { rememberSignupConsent, SIGNUP_POLICY_VERSION } from '@/lib/consent';");
    expect(AUTH.match(/rememberSignupConsent\(SIGNUP_POLICY_VERSION\)/g)).toHaveLength(2);
    // No hard-coded policy date left to drift from the constant.
    expect(AUTH).not.toMatch(/recordConsent\([^)]*'\d{4}-\d{2}-\d{2}'/);
  });
  it('says so under the third-party buttons in both panes', () => {
    expect(AUTH.match(/data-testid="oauth-consent-line"/g)).toHaveLength(2);
    for (const block of AUTH.match(/\{OAUTH_SIGN_IN_ENABLED && \([\s\S]*?\n\s*\)\}/g) ?? []) {
      expect(block).toContain('By continuing you agree to the');
      expect(block).toContain('/terms-of-service.html');
      expect(block).toContain('/privacy-policy.html');
    }
  });
});

describe('the password flow', () => {
  it('verifies the current password before setting a new one when asked to', () => {
    expect(SERVICE).toMatch(/static async changePassword\(\s*newPassword: string,\s*verify\?: \{ email: string; currentPassword: string \}/);
    const body = SERVICE.slice(SERVICE.indexOf('static async changePassword'), SERVICE.indexOf('static async exportUserData'));
    expect(body.indexOf('signInWithPassword')).toBeGreaterThan(-1);
    expect(body.indexOf('signInWithPassword')).toBeLessThan(body.indexOf('updateUser({ password: newPassword })'));
  });
  it('asks for the current password on an account that has one, on both layers', () => {
    expect(PROFILE).toContain("const hasPassword = signInProviders.includes('email');");
    expect(PROFILE).toContain('hasPassword && user?.email ? { email: user.email, currentPassword } : undefined');
    expect(PROFILE).toContain('id="settings-currentPassword"');
    expect(PHONE).toContain('autoComplete="current-password"');
    expect(PHONE).toContain('settings.hasPassword ? (');
  });
  it('offers the reset link on both layers', () => {
    expect(PROFILE).toContain('const handleSendResetLink = async () => {');
    expect(PROFILE).toContain('await resetPassword(user.email)');
    expect(PROFILE).toContain('onSendResetLink: () => void handleSendResetLink()');
    expect(PHONE).toContain('onPress: settings.onSendResetLink');
  });
});

describe('sign out on the phone', () => {
  it('is a row on the Account screen that signs out and leaves for /auth', () => {
    expect(PHONE).toContain('label="Sign out"');
    expect(PHONE).toContain('onPress: settings.onSignOut');
    expect(PROFILE).toContain('onSignOut: () => void handleSignOut()');
    const body = PROFILE.slice(PROFILE.indexOf('const handleSignOut = async'), PROFILE.indexOf('const handleSignOut = async') + 200);
    expect(body).toContain('await signOut();');
    expect(body).toContain("navigate('/auth', { replace: true });");
  });
  it('names how the account signs in', () => {
    expect(PHONE).toContain('label="Sign-in method"');
  });
});

describe('the policy links leave the shell properly', () => {
  it('routes the Account screen\'s Terms and Privacy rows through interceptExternal', () => {
    expect(PHONE).toContain("import { interceptExternal } from '@/lib/openExternal';");
    expect(PHONE).not.toMatch(/onPress=\{\(\) => window\.open\(/);
  });
});
