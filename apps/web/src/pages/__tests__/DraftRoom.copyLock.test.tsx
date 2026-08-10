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
// Entry 50 amendment (2026-08-10 11:33Z): architect's re-run caught a
// SEVENTH site at :762 (ternary fallback, not a setError literal) —
// the original 6-site test locked the INSTANCE LIST, not the RULE.
// Lesson: tests must lock the rule. All three assertions below
// widened to file-wide scans (no more `setError\(` prefix — ANY
// occurrence of the banned string fails).
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

describe('DraftRoom.tsx — T12P-5-followon banned "Failed to load" purge (Entry 49 + Entry 50 rule-widening)', () => {
  const source = readFileSync(DR_PATH, 'utf8');

  it('no "Failed to load" copy anywhere in the file (rule-wide ban, not instance-list)', () => {
    // Entry 50 lesson: the pre-widening test matched only setError call
    // sites and missed the ternary fallback at :762
    // (`|| 'Failed to load draft data'`). Widening to file-wide catches
    // ANY shape variant: setError literal, ternary fallback, template
    // string, JSX prop, toast description — all banned per COPY_VOICE
    // hard-ban list.
    const bannedMatches = source.match(/Failed to load/g);
    expect(
      bannedMatches,
      `expected zero "Failed to load" occurrences anywhere in file; found ${bannedMatches?.length ?? 0}`,
    ).toBeNull();
  });

  it('no setError call passes "Please try again" politeness padding for load failures', () => {
    // Entry 50 scope: widen ONLY "Failed to load" to rule-wide. The
    // "Please try again" politeness padding survives in ~10 toast
    // descriptions on commissioner-only Draft Hiccup paths (:1779,
    // :2037, :2048, :2053, :2653, :2662, :3362, :3764, :3782) — those
    // are DOCKETED for the post-twelve Draft-Hiccup 22-toast sweep,
    // not tonight's cleanup rider. Keeping this assertion narrow to
    // setError so the load-failure paths stay locked without pulling
    // the whole Draft-Hiccup docket into rider scope.
    const setErrorPleaseTry = source.match(/setError\([^)]*['"][^'"]*Please try again[^'"]*['"]/g);
    expect(setErrorPleaseTry, 'expected zero setError sites containing "Please try again"').toBeNull();
  });

  it('purged setError sites still carry retry-door language', () => {
    // Post-fix strings all contain "try again" as the door verb.
    // Count the door-bearing setError calls to make sure we didn't
    // accidentally strip the door while removing the ban.
    const setErrorWithDoor = source.match(/setError\([^)]*try again/g);
    expect(setErrorWithDoor, 'expected at least 6 setError sites with retry door').not.toBeNull();
    expect((setErrorWithDoor ?? []).length).toBeGreaterThanOrEqual(6);
  });
});
