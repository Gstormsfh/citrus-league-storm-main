// T12P-3 (Entry 39 hostile pass, 2026-08-10) — Join-by-code corridor lock.
//
// PRIMARY QUESTION (Entry 45 amendment): after Tier-1 redirect
// preservation (7226efa8), does auto-join actually fire on protected
// mount? Does the ?code query param survive the ProtectedRoute →
// /auth?redirect=... → back-to-/create-league?code=X round-trip into
// useSearchParams on CreateLeague's mount?
//
// TRACE (source-verified):
//   1. Signed-out user hits /create-league?code=ABC
//   2. ProtectedRoute encodes pathname+search → /auth?redirect=%2Fcreate-league%3Fcode%3DABC
//   3. Auth.tsx handleSignIn success: setTimeout reads window.location.search,
//      pulls decoded redirect, navigates to /create-league?code=ABC
//   4. CreateLeague mounts. useSearchParams parses the fresh URL.
//   5. Effect at :243-255 sees code + user + !autoJoinFiredRef →
//      setTimeout(handleJoinLeague(code), 50)
//   6. handleJoinLeague uses codeOverride (bypasses state-commit race)
//
// This test locks the load-bearing shape of steps 4-6 (the receiving
// end of the redirect) via source-read so a future refactor can't
// silently break the corridor the twelve walk on Aug 20.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CREATE_LEAGUE_PATH = resolve(HERE, '..', 'CreateLeague.tsx');
const AUTH_PATH = resolve(HERE, '..', 'Auth.tsx');

describe('CreateLeague — T12P-3 auto-join corridor (Entry 39 + Entry 45 amendment)', () => {
  const source = readFileSync(CREATE_LEAGUE_PATH, 'utf8');

  it('auto-join useEffect fires on code + user (the C3-decides gate)', () => {
    // The load-bearing invariant: an effect that reads ?code from
    // searchParams AND checks user is present AND guards with the
    // autoJoinFiredRef, then calls handleJoinLeague.
    // Source-read is intentional — the useEffect deps + ref shape are
    // what future refactors must preserve.
    expect(source).toMatch(/searchParams\.get\(['"]code['"]\)/);
    expect(source).toMatch(/autoJoinFiredRef/);
    // Guard: the effect body must gate on code + user + !firedRef
    expect(source).toMatch(/if\s*\(\s*code\s*&&\s*user\s*&&\s*!autoJoinFiredRef\.current/);
    // And must actually call handleJoinLeague with an explicit code
    expect(source).toMatch(/handleJoinLeague\s*\(\s*code\s*\)/);
  });

  it('autoJoinFiredRef prevents re-firing (idempotency lock)', () => {
    // The ref must be flipped to true BEFORE handleJoinLeague is
    // scheduled — otherwise a searchParams re-emit could re-fire
    // the join.
    const effectMatch = source.match(/if\s*\(\s*code\s*&&\s*user\s*&&\s*!autoJoinFiredRef\.current[\s\S]*?\}\s*\}/);
    expect(effectMatch, 'auto-join effect body not found').toBeTruthy();
    const body = effectMatch![0];
    // Ref flip must appear BEFORE the setTimeout that schedules the join.
    const refFlipIdx = body.indexOf('autoJoinFiredRef.current = true');
    const setTimeoutIdx = body.indexOf('setTimeout');
    expect(refFlipIdx).toBeGreaterThan(-1);
    expect(setTimeoutIdx).toBeGreaterThan(-1);
    expect(refFlipIdx).toBeLessThan(setTimeoutIdx);
  });

  it('handleJoinLeague accepts codeOverride (bypasses state-commit race)', () => {
    // The auto-join effect passes ?code EXPLICITLY. handleJoinLeague
    // must accept an override parameter — otherwise it reads stale
    // closure state and errors with "Join code is required."
    expect(source).toMatch(/handleJoinLeague\s*=\s*async\s*\(\s*codeOverride\??\s*:?\s*string\??\s*\)/);
  });

  it('code resolution uses the triple fallback (override → state → searchParams → window.location)', () => {
    // Defensive resolution proven necessary by the state-commit race
    // documented at the fix site. All three fallbacks must survive.
    expect(source).toMatch(/codeOverride\s*\?\?\s*['"]{2}/);
    expect(source).toMatch(/joinCode\s*\?\?\s*['"]{2}/);
    expect(source).toMatch(/searchParams\.get\(['"]code['"]\)/);
    // Window.location.search fallback (last-resort for edge cases)
    expect(source).toMatch(/window\.location\.search/);
  });
});

describe('CreateLeague — T12P-3 COPY_VOICE conformance (join corridor)', () => {
  const source = readFileSync(CREATE_LEAGUE_PATH, 'utf8');

  it('banned "Failed to join" purged from all join-path branches', () => {
    // COPY_VOICE.md hard-ban: naked "Failed" surfaced to users.
    // Pre-fix: throw new Error("Failed to join league") + fallback
    // errorMessage = "Failed to join league".
    expect(source).not.toMatch(/Failed to join/);
  });

  it('join error toast title uses a state name (not "Error Joining")', () => {
    // COPY_VOICE toast taxonomy: title = the STATE, specific.
    // Pre-fix title: "Error Joining League" — starts with banned "Error"
    // (per the 55× "Error" hard-ban). Post-fix: "Can't Join Right Now".
    expect(source).not.toMatch(/title:\s*["']Error Joining/);
    expect(source).toMatch(/title:\s*["']Can't Join/);
  });

  it('no-code early-return message carries a door (mentions invite link)', () => {
    // Pre-fix: setError("Join code is required") — bare fact, no help.
    // Post-fix: setError("Add a join code first — check your invite link.")
    // Only match setError call sites so the comment describing the pre-fix
    // bug at :558 doesn't false-positive.
    expect(source).not.toMatch(/setError\(\s*["']Join code is required["']/);
    expect(source).toMatch(/setError\(\s*["']Add a join code first/);
  });

  it('defensive not-signed-in setError drops "You must be logged in" wall', () => {
    // COPY_VOICE rule 3: errors own the blame. "You must" is a wall.
    // Pre-fix: "You must be logged in to join a league"
    // Post-fix: "Sign in first, then jump into the league."
    expect(source).not.toMatch(/["']You must be logged in to join/);
  });
});

describe('Auth.tsx — T12P-3 redirect delivery contract (Entry 46 amendment)', () => {
  const authSource = readFileSync(AUTH_PATH, 'utf8');

  it('handleSignIn post-success navigate reads window.location.search for ?redirect', () => {
    // Entry 46's amendment: confirm ?redirect actually reaches the
    // handleSignIn's post-success navigate on the password sign-in path.
    // Source-read verifies the setTimeout callback shape.
    // Must contain window.location.search read + startsWith('/') guard.
    const signInMatch = authSource.match(/handleSignIn[\s\S]{0,4000}?setTimeout\(\(\)\s*=>\s*\{([\s\S]*?)\},\s*\d+\)/);
    expect(signInMatch, 'handleSignIn post-success setTimeout not found').toBeTruthy();
    const body = signInMatch![1];
    expect(body).toMatch(/window\.location\.search/);
    expect(body).toMatch(/redirect\.startsWith\(['"]\/['"]/);
    expect(body).toMatch(/navigate\(/);
  });

  it('stash-before-OAuth effect writes citrus:postAuthRedirect for OAuth round-trip', () => {
    // Entry 46's amendment: OAuth path can't read ?redirect from
    // /auth/callback (Google strips query params). The fix is the
    // sessionStorage stash on /auth mount; AuthCallback reads it back.
    // Lock both halves via source-read.
    expect(authSource).toMatch(/sessionStorage\.setItem\(['"]citrus:postAuthRedirect['"]/);
  });
});
