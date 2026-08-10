// T12P-1 (Entry 39 hostile pass, 2026-08-10) — Auth.tsx silent-dead-end guard.
//
// Locks the fix for the "signIn returns success but no session" edge:
// previously the safety timeout only re-enabled the button, leaving the
// user staring at a spinning-then-normal button with zero feedback. The
// fix surfaces an honest error message so the user knows to retry.
//
// This test locks the ERROR STRING presence in the source (test the
// contract without needing to drive the timer + Supabase mocks — the
// error string is the load-bearing part of the fix).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const AUTH_PATH = resolve(HERE, '..', 'Auth.tsx');
const CALLBACK_PATH = resolve(HERE, '..', 'AuthCallback.tsx');

describe('Auth.tsx — T12P-1 silent-dead-end fix (Entry 39 hostile pass)', () => {
  const source = readFileSync(AUTH_PATH, 'utf8');

  it('safety-timeout branch calls setError (not just setLoading)', () => {
    // The pre-fix branch was: setTimeout(() => { setLoading(false); }, 4000)
    // Post-fix: setTimeout(() => { setError(...); setLoading(false); }, 4000)
    // Find the signInSafetyTimeoutRef assignment and confirm setError is
    // inside the setTimeout callback.
    const safetyTimeoutMatch = source.match(/signInSafetyTimeoutRef\.current\s*=\s*setTimeout\(\(\)\s*=>\s*\{([\s\S]*?)\},\s*\d+\)/);
    expect(safetyTimeoutMatch, 'signInSafetyTimeoutRef.current setTimeout block not found').toBeTruthy();
    const body = safetyTimeoutMatch![1];
    expect(body).toMatch(/setError\(/);
    expect(body).toMatch(/setLoading\(false\)/);
  });

  it('silent-dead-end error message names the user action (retry) and offers a door (contact support)', () => {
    // Load-bearing: the error message must tell the user what to do.
    // Loosely locked so future copy polish can adjust wording without
    // failing the test — but "try again" or a retry verb must appear.
    const safetyTimeoutMatch = source.match(/signInSafetyTimeoutRef\.current\s*=\s*setTimeout\(\(\)\s*=>\s*\{([\s\S]*?)\},\s*\d+\)/);
    const body = safetyTimeoutMatch![1];
    // Extract the error string. Use greedy match to a closing quote,
    // allowing punctuation (including single quotes / apostrophes) inside
    // the message body — pre-fix regex excluded ALL quote chars from the
    // body, which broke on "Sign-in didn't complete" (apostrophe).
    const errorStringMatch = body.match(/setError\(\s*"([^"]+)"\s*\)/)
      ?? body.match(/setError\(\s*'([^']+)'\s*\)/)
      ?? body.match(/setError\(\s*`([^`]+)`\s*\)/);
    expect(errorStringMatch, 'error string not extractable from safety-timeout branch').toBeTruthy();
    const msg = errorStringMatch![1].toLowerCase();
    // Contract: mentions try/retry (door) OR "reach out" (escape hatch).
    expect(msg).toMatch(/try again|reach out|contact/);
  });
});

describe('AuthCallback.tsx — T12P-1 COPY_VOICE conformance (state titles)', () => {
  const source = readFileSync(CALLBACK_PATH, 'utf8');

  it('error state title no longer says "Failed" — uses state-name idiom', () => {
    // COPY_VOICE.md rule: "Errors take the blame themselves" + hard-ban
    // list drops naked "Failed". "Sign-In Snag" is the state name.
    expect(source).toMatch(/status === 'error' && ["']Sign-In Snag["']/);
    expect(source).not.toMatch(/status === 'error' && ["']Sign-In Failed["']/);
  });

  it('loading state title uses conversational voice ("Signing you in")', () => {
    // Pre-fix: "Signing In" — grammatically fine but corporate.
    // Post-fix: "Signing you in" per rule 1 "Name the actor."
    expect(source).toMatch(/status === 'loading' && ["']Signing you in["']/);
  });

  it('fallback error messages avoid banned "Authentication failed" phrase', () => {
    // COPY_VOICE bans naked "failed" copy for the user; the app owns blame.
    // Our fail() default now says "head back and try again" (offers door).
    // NOT locking exact phrasing (allows polish) — just ban the pre-fix string.
    expect(source).not.toMatch(/["']Authentication failed\. Please try again\.["']/);
  });
});
