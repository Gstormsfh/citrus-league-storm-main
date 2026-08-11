// E80 V1-FENCE (2026-08-11) — source-shape lock for the P0 pre-TWELVE
// fix. F28 IGNITION Run 1 (Entry 80) surfaced that v1's legacy
// client-side draft machinery ran an ENTIRE draft in Garrett's
// browser after his refresh landed on an old /draft-room?league= URL
// for a v2-era league — engine deaf, v1 rendered lobby, v1's
// autopick fired locally, v1 wrote 12 picks to v1 tables, v1 flipped
// league status. T7 fenced the legacy START button; the fence tested
// here catches the RUNNING machinery ever landing on a v2-era league
// at all.
//
// Source-read pattern matches DraftRoom.copyLock.test.tsx: the file
// is 5100+ lines with 30+ dependencies to mock; a full render test
// would take longer to author than the fence itself. The fence's
// shape is small + load-bearing + easy to regress silently, so a
// structural lock is the right test surface.
//
// The load-bearing contracts asserted below:
//   1. useV1Fence hook exists and probes `draft_events` filtered by
//      league_id (not some other table, not unfiltered).
//   2. Non-zero probe result → state.kind = 'v2-era' (the redirect
//      branch); empty result → 'v1-safe' (v1 body mounts).
//   3. Top-level DraftRoom wrapper renders a <Navigate to="/draft-v2/…"
//      replace> when fence.kind === 'v2-era' — BEFORE DraftRoomInner
//      can mount. `replace: true` is required so the back button
//      doesn't reland on /draft-room.
//   4. The legacy body was renamed to DraftRoomInner and only mounts
//      from the 'v1-safe' branch (proves the wrapper pattern is in
//      place — not a hook-early-return which would violate React's
//      hook-order rule with hundreds of downstream hooks).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const DR_PATH = resolve(HERE, '..', 'DraftRoom.tsx');
const source = readFileSync(DR_PATH, 'utf8');

describe('DraftRoom.tsx — E80 V1-FENCE (source-shape lock)', () => {
  it('useV1Fence hook is declared at module scope', () => {
    // Not just any variable named useV1Fence — a proper function
    // declaration or `const useV1Fence = ` (must resemble a hook).
    expect(source).toMatch(/function useV1Fence\s*\(/);
  });

  it('fence probes the draft_events table (not a different table)', () => {
    // The load-bearing table name. Renaming the probe target would
    // silently break the fence — a source-shape regression must fail
    // here rather than at 2am on Draft Night. Pattern matches both
    // `supabase.from('draft_events')` and the untyped-alias form
    // `untypedFrom('draft_events')` used to work around TS
    // deep-instantiation on the draft_events wide-JSONB column set.
    expect(source).toMatch(/(?:supabase\.)?(?:untypedF|f)rom\(['"]draft_events['"]\)/);
  });

  it('fence probe filters by league_id (not unfiltered scan)', () => {
    // A .from('draft_events') without an .eq('league_id', …) would
    // return ANY league's events, mis-classifying every v1 league
    // that shares a DB with any completed v2 league (i.e., every
    // real environment) as v2-era.
    expect(source).toMatch(/\.eq\(['"]league_id['"],\s*leagueId\)/);
  });

  it('fence probe uses .limit(1) for existence check (not full scan)', () => {
    // Fence only needs to know "does any row exist" — .limit(1) is
    // the cheap probe. A missing limit would drag the entire event
    // history on every mount for finished drafts.
    expect(source).toMatch(/\.limit\(1\)/);
  });

  it('fence state includes checking / v2-era / v1-safe discriminants', () => {
    // The three-state union is the load-bearing shape: checking →
    // suppresses v1 mount; v2-era → hard redirect; v1-safe → mount
    // legacy body. A collapse to boolean would lose the ability to
    // gate mounting during the probe window.
    expect(source).toContain("kind: 'checking'");
    expect(source).toContain("kind: 'v2-era'");
    expect(source).toContain("kind: 'v1-safe'");
  });

  it('v2-era detection renders <Navigate to="/draft-v2/…" replace>', () => {
    // The redirect target MUST be /draft-v2/:leagueId (not
    // /draft-room, not /gm-office, not root) with replace: true so
    // browser back doesn't reland on the fenced surface.
    // Match tolerates ordering of the props + template-literal or
    // string composition of the URL.
    expect(source).toMatch(
      /<Navigate[\s\S]*to=\{`\/draft-v2\/\$\{encodeURIComponent\(fence\.leagueId\)\}`\}[\s\S]*replace/,
    );
  });

  it('checking state renders a placeholder (not v1 UI) to suppress arm', () => {
    // A stable data-testid so future test authors can lock behavior
    // + so operator debugging has a targetable selector during the
    // probe window. Any suppression element is acceptable; the
    // testid is the mnemonic anchor.
    expect(source).toContain('data-testid="v1-fence-checking"');
  });

  it('DraftRoom wrapper mounts DraftRoomInner only from v1-safe branch', () => {
    // The wrapper pattern is REQUIRED — a hook-early-return inside
    // the same component would violate React's hook-order rule
    // against hundreds of downstream v1 hooks. Match ensures the
    // rename to DraftRoomInner is present and used from the wrapper.
    expect(source).toMatch(/const DraftRoomInner = \(\) => \{/);
    expect(source).toMatch(/return <DraftRoomInner \/>/);
  });

  it('fence effect handles missing leagueId (falls through to v1-safe)', () => {
    // No leagueId in the URL → the legacy load-user-league path
    // handles the redirect itself. The fence must not block that
    // path or infinite-loop on null.
    expect(source).toMatch(/if \(!leagueId\)[\s\S]*setState\(\{ kind: 'v1-safe' \}\)/);
  });

  it('fence effect defensively falls through to v1 on DB errors', () => {
    // Probe failure is a v1 fall-through by architect ratification
    // (Entry 80 fence-not-block doctrine): the fence's job is to
    // CATCH v2-era leagues, not to block v1 leagues on a transient
    // DB error. The T7 START-button fence catches the other rail.
    // Match on the fall-through logger tag or the setState pattern.
    expect(source).toMatch(/\[V1-FENCE\][\s\S]*setState\(\{ kind: 'v1-safe' \}\)/);
  });
});
