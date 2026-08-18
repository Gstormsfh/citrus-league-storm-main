// E80 V1-FENCE (2026-08-11) → RETIREMENT (2026-08-18) — source-shape lock.
//
// History, because the shape of this fence is a record of two field
// incidents:
//
// E80 (2026-08-11): v1's legacy client-side draft machinery ran an
// ENTIRE draft in Garrett's browser after a refresh landed on an old
// /draft-room?league= URL for a v2-era league — engine deaf, v1
// rendered lobby, v1's autopick fired locally, v1 wrote 12 picks to
// v1 tables, v1 flipped league status. The fence was born: probe the
// league's v2-era status, redirect v2-era leagues to /draft-v2,
// mount v1 only when "v1-safe".
//
// RETIREMENT (2026-08-18): production field evidence (league
// 0c84a9e5, "Chris Dacosta TESTTTTERRRR") proved the probe's
// remaining branch was itself the defect. A FRESH league probes
// v2Era=false — correctly, it has no events yet — so the fence
// mounted v1 "safely" and the whole draft ran on the legacy
// reserve/confirm path: 7 picks in v1 draft_picks, zero engine
// events, and the sluggish per-pick latency v2 was built to
// eliminate. "v1-safe" was really "v1-DEFAULT", and every new league
// starts fresh. The v2 lobby fully handles not_started leagues (T7
// Start linkage, proven by THE TWELVE), so the probe is gone: any
// leagueId routes straight to /draft-v2. The v1 body remains only as
// the !leagueId fall-through (the load-user-league URL-rewrite
// dance), pending full deletion (trim backlog).
//
// Source-read pattern matches DraftRoom.copyLock.test.tsx: the file
// is 5000+ lines with 30+ dependencies to mock; a full render test
// would take longer to author than the fence itself. The fence's
// shape is small + load-bearing + easy to regress silently, so a
// structural lock is the right test surface.
//
// The load-bearing contracts asserted below:
//   1. useV1Fence exists and routes EVERY league with a leagueId to
//      'v2-era' — unconditionally. No probe, no v2Era branch, no
//      "fall through to v1" path for a league that has an id.
//   2. Top-level DraftRoom wrapper renders <Navigate to="/draft-v2/…"
//      replace> for 'v2-era' — BEFORE DraftRoomInner can mount.
//      `replace: true` so back-button doesn't reland on /draft-room.
//   3. 'v1-safe' is reachable ONLY from the !leagueId early return
//      (stale bare-URL fall-through), and the legacy body mounts
//      only from that branch via the wrapper pattern (not a
//      hook-early-return, which would violate hook-order with
//      hundreds of downstream hooks).
//   4. Both branches log — E104 always-log doctrine survives the
//      retirement. `[V1-FENCE]` stays the stable operator grep.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const DR_PATH = resolve(HERE, '..', 'DraftRoom.tsx');
const source = readFileSync(DR_PATH, 'utf8');

// The E80/E104 history lives in comments and legitimately NAMES the old
// probe (`/era`, v2Era, supabase.from('draft_events')) in prose. The
// negative assertions below are about CODE, so they run against a
// comment-stripped view; the history stays readable without tripping them.
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((l) => {
    const i = l.indexOf('//');
    return i === -1 ? l : l.slice(0, i);
  })
  .join('\n');

describe('DraftRoom.tsx — V1-FENCE retirement (source-shape lock)', () => {
  it('useV1Fence hook is declared at module scope', () => {
    expect(source).toMatch(/function useV1Fence\s*\(/);
  });

  it('RETIREMENT: no era probe remains — the API era endpoint is not called', () => {
    // The probe's remaining "v1-safe for fresh leagues" branch was the
    // 2026-08-18 defect. If this path reappears, the v1 room becomes the
    // default for every new league again.
    expect(code).not.toMatch(/\/api\/draft\/v2\/league\/.*\/era/);
    expect(code).not.toMatch(/v2Era/);
  });

  it('E104 heritage: fence does NOT probe supabase.from(draft_events) client-side', () => {
    // The pre-E104 RLS probe had a session-restore race. It must not
    // come back in any form.
    const fenceRegion = code.slice(0, code.indexOf('const DraftRoomInner'));
    expect(fenceRegion).not.toMatch(/from\(['"]draft_events['"]\)/);
  });

  it('RETIREMENT: any leagueId routes to v2-era unconditionally', () => {
    // The retirement log and the unconditional setState must both be
    // present, in the effect, with no conditional between them and the
    // leagueId guard.
    expect(source).toMatch(/\[V1-FENCE\] v1 draft room retired \(2026-08-18\); routing to \/draft-v2/);
    expect(source).toMatch(/setState\(\{ kind: 'v2-era', leagueId \}\)/);
  });

  it('fence state includes checking / v2-era / v1-safe discriminants', () => {
    expect(source).toMatch(/kind: 'checking'/);
    expect(source).toMatch(/kind: 'v2-era'/);
    expect(source).toMatch(/kind: 'v1-safe'/);
  });

  it("v2-era renders <Navigate to='/draft-v2/…' replace>", () => {
    expect(source).toMatch(
      /Navigate\s*\n?\s*to=\{`\/draft-v2\/\$\{encodeURIComponent\(fence\.leagueId\)\}`\}\s*\n?\s*replace/,
    );
  });

  it('DraftRoom wrapper mounts DraftRoomInner only from the v1-safe branch', () => {
    // Wrapper pattern: the v2-era and checking branches return before
    // the inner body, and the final return is the inner mount.
    const wrapper = source.slice(
      source.indexOf('const DraftRoom = () =>'),
      source.indexOf('const DraftRoomInner'),
    );
    expect(wrapper).toContain("fence.kind === 'v2-era'");
    expect(wrapper).toContain("fence.kind === 'checking'");
    expect(wrapper).toContain('return <DraftRoomInner />');
  });

  it("'v1-safe' is set only from the !leagueId early return", () => {
    // Count setState calls that produce v1-safe: exactly one, and it
    // must sit inside the !leagueId guard. A second v1-safe site means
    // someone reopened a with-league path into the legacy room.
    const matches = source.match(/setState\(\{ kind: 'v1-safe' \}\)/g) ?? [];
    expect(matches).toHaveLength(1);
    const guardIdx = source.indexOf('if (!leagueId) {');
    const setIdx = source.indexOf("setState({ kind: 'v1-safe' })");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(setIdx).toBeGreaterThan(guardIdx);
    // …and before the guard's closing early return ends the branch.
    const returnIdx = source.indexOf('return;', guardIdx);
    expect(setIdx).toBeLessThan(returnIdx);
  });

  it('E104 always-log doctrine: both fence branches log with the stable prefix', () => {
    expect(source).toMatch(/\[V1-FENCE\] no leagueId on mount/);
    expect(source).toMatch(/\[V1-FENCE\] v1 draft room retired/);
  });

  it('checking state renders a placeholder (not v1 UI) to suppress arm', () => {
    expect(source).toMatch(/data-testid="v1-fence-checking"/);
  });
});
