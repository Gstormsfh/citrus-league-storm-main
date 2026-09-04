/**
 * GUIDELINE 4.8 IS A PACKAGE DEAL (2026-09-04, hours before submission).
 *
 * Tapping "Continue with Apple" on the live site returned:
 *
 *   {"code":400,"error_code":"validation_failed",
 *    "msg":"Unsupported provider: provider is not enabled"}
 *
 * That is Supabase saying the Apple provider is not turned on for the
 * project. The button was on screen and could not work for anyone --
 * including a reviewer, who taps it first. `auth.identities` on production
 * the same day: 41 google, 35 email, ZERO apple, ever.
 *
 * App Store Review Guideline 4.8: an app offering a third-party login must
 * also offer an equivalent privacy-preserving option, in practice Sign in
 * with Apple. So the two buttons are not independent switches:
 *
 *   Google shown, Apple shown    -> compliant (once Apple actually works)
 *   Google shown, Apple hidden   -> the arrangement 4.8 forbids
 *   Google hidden, Apple shown   -> a button that cannot work
 *   both hidden                  -> 4.8 does not apply. Safe fallback.
 *
 * Shipped ON: the provider was enabled and a real Apple sign-in completed the
 * same night (first apple row in auth.identities, 2026-09-04 08:14:08Z).
 *
 * One flag, both buttons, which is what this file pins. The cost was
 * measured before choosing it: 37 accounts are Google-only, but only 2 of
 * them had signed in during the previous 30 days, and those two can set a
 * password through Forgot password -- which is why the "you signed up with
 * Google" hint no longer points at a button that is not on screen.
 *
 * TO TURN BACK ON: enable the Apple provider in Supabase, sign in with
 * Apple successfully on a device build, then flip the flag. Do not flip it
 * because the setup "looks done".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const AUTH = readFileSync(resolve(here, '../pages/Auth.tsx'), 'utf-8');

/** Auth.tsx with comments stripped — the prose below names both providers. */
const code = AUTH.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the third-party sign-in buttons ship together or not at all', () => {
  it('is a single flag, not one switch per provider', () => {
    expect(code).toMatch(/const OAUTH_SIGN_IN_ENABLED = (true|false);/);
    // No second flag that could drift out of step with the first.
    const flags = code.match(/const OAUTH_[A-Z_]*ENABLED/g) ?? [];
    expect(flags).toHaveLength(1);
  });

  it('renders neither provider outside that flag', () => {
    // Every provider button must sit inside a gated block. Strike the gated
    // regions out and no handler call may remain.
    const ungated = code.replace(/\{OAUTH_SIGN_IN_ENABLED && \([\s\S]*?\n\s*\)\}/g, '');
    expect(ungated).not.toContain("handleOAuthSignIn('apple')");
    expect(ungated).not.toContain("handleOAuthSignIn('google')");
  });

  it('gates them in both tabs, sign in and sign up', () => {
    const gates = code.match(/\{OAUTH_SIGN_IN_ENABLED && \(/g) ?? [];
    expect(gates).toHaveLength(2);
  });

  it('keeps Apple and Google in the same block wherever they appear', () => {
    // The 4.8 failure mode is one provider surviving a future edit alone.
    for (const block of code.match(/\{OAUTH_SIGN_IN_ENABLED && \([\s\S]*?\n\s*\)\}/g) ?? []) {
      expect(block).toContain("handleOAuthSignIn('apple')");
      expect(block).toContain("handleOAuthSignIn('google')");
    }
  });

  it('does not send a Google-only account to a button that is not rendered', () => {
    // The hint said "Click 'Continue with Google' above". With the buttons
    // gone that is a dead end for the 37 accounts that have no password.
    expect(code).toContain('if (!OAUTH_SIGN_IN_ENABLED) {');
    expect(code).toMatch(/Forgot password/);
  });

  it('ships with the buttons ON, because Apple was proven to work', () => {
    // Deliberately pins the VALUE. Flipping it either way should be a
    // decision someone makes on purpose, with this test in the diff saying
    // why. It went true at 2026-09-04 08:14:08Z, when auth.identities gained
    // its first apple row -- a completed token exchange, not a screen that
    // looked right.
    expect(code).toContain('const OAUTH_SIGN_IN_ENABLED = true;');
  });
});
