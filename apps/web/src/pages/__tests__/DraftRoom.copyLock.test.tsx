// T12P-5-followon (Entry 49 authorized copy commit, 2026-08-10) —
// DraftRoom.tsx invitee-visible setError copy hardening.
//
// The T12P-5 OBSERVE-ONLY audit surfaced 6 "Failed to load X. Please
// try again." setError sites at :229/:248 (real-path, invitee-visible
// on first mount if getUserLeagues fails) and :324/:340/:368/:408
// (demo-only, same banned-word pattern). Entry 49 authorized a single
// copy-only commit under U7's copy license — this test locks the
// purge so future refactors can't reintroduce the banned "Failed to
// load" pattern.
//
// Room ruling per Entry 49: BOTH rooms are in the twelve's path — v1
// DraftRoom.tsx holds the lobby (invitees WAIT here); v2 room takes
// over post-ignition. So v1's first-mount error paths are
// invitee-visible pre-twelve.
//
// Source-read pattern (like T12P-3): the load-bearing contract is
// the string set, and DraftRoom.tsx is 5021 lines — rendering it
// would need mocks for 30+ dependencies.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const DR_PATH = resolve(HERE, '..', 'DraftRoom.tsx');

describe('DraftRoom.tsx — T12P-5-followon banned "Failed to load" purge (Entry 49)', () => {
  const source = readFileSync(DR_PATH, 'utf8');

  it('no setError call passes "Failed to load" copy anywhere in the file', () => {
    // COPY_VOICE.md hard-ban list: naked "Failed to X" copy surfaced
    // to users. Pre-fix: 6 sites all pattern-matched
    // `'Failed to load X. Please try again.'`. Post-fix: warm copy
    // ("Couldn't load X — give it a moment / refresh to try again.")
    // owns blame per rule 3 and offers a door.
    const setErrorFailedMatches = source.match(/setError\([^)]*['"]Failed to load/g);
    expect(setErrorFailedMatches, 'expected zero setError sites containing "Failed to load"').toBeNull();
  });

  it('no setError call passes "Please try again" politeness padding for load failures', () => {
    // Companion ban: "Please try again" is rule 4 politeness padding
    // (users just want doors — "try again in a moment" or "refresh to
    // try again" is the shape). Only checking within setError call
    // sites so we don't false-fail any comment or non-copy string.
    const setErrorPleaseTry = source.match(/setError\([^)]*['"][^'"]*Please try again[^'"]*['"]/g);
    expect(setErrorPleaseTry, 'expected zero setError sites containing "Please try again"').toBeNull();
  });

  it('all six purged setError sites carry retry-door language', () => {
    // Post-fix strings all contain "try again" as the door verb.
    // Count the door-bearing setError calls to make sure we didn't
    // accidentally strip the door while removing the ban.
    const setErrorWithDoor = source.match(/setError\([^)]*try again/g);
    expect(setErrorWithDoor, 'expected at least 6 setError sites with retry door').not.toBeNull();
    expect((setErrorWithDoor ?? []).length).toBeGreaterThanOrEqual(6);
  });
});
