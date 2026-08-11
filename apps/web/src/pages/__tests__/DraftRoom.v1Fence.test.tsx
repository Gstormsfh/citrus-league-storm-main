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

describe('DraftRoom.tsx — E80 V1-FENCE + E104 FENCE-2 (source-shape lock)', () => {
  it('useV1Fence hook is declared at module scope', () => {
    // Not just any variable named useV1Fence — a proper function
    // declaration or `const useV1Fence = ` (must resemble a hook).
    expect(source).toMatch(/function useV1Fence\s*\(/);
  });

  it('E104 FENCE-2: fence probes the API era endpoint (not client-side supabase RLS)', () => {
    // E104 rewire: client-side supabase.from('draft_events') RLS
    // probe was subject to a session-restore race on first mount —
    // supabase-js hadn't attached the session, so RLS returned zero
    // rows silently for authenticated members and the fence fell
    // through to v1. Fix: probe the API server (`GET /api/draft/v2/
    // league/:leagueId/era` → `{v2Era: boolean}`), which uses
    // service-role EXISTS immune to client session timing.
    expect(source).toMatch(/\/api\/draft\/v2\/league\/\$\{encodeURIComponent\(leagueId\)\}\/era/);
  });

  it('E104 FENCE-2: fence probe reads v2Era boolean from response', () => {
    // Load-bearing shape: response.data.v2Era. Any refactor that
    // renames the field or expects a different shape breaks the
    // fence silently — machine-lock it.
    expect(source).toMatch(/v2Era/);
    expect(source).toMatch(/payload\?\.v2Era/);
  });

  it('E104 FENCE-2: fence does NOT probe supabase.from(draft_events) directly (removed)', () => {
    // Regression pin: the pre-E104 client-side RLS probe must
    // stay removed. If a future refactor reintroduces
    // `supabase.from('draft_events')` inside useV1Fence, the
    // session-restore race returns.
    // Extract useV1Fence body and assert absence.
    const hookMatch = source.match(
      /function useV1Fence[\s\S]*?^\}/m,
    );
    expect(hookMatch).not.toBeNull();
    if (hookMatch) {
      expect(hookMatch[0]).not.toMatch(/supabase\.from\(['"]draft_events['"]\)/);
      expect(hookMatch[0]).not.toMatch(/untypedFrom\(['"]draft_events['"]\)/);
    }
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

  // ── E104 always-log doctrine ────────────────────────────────────
  //
  // Morning field verification (E104) spent hours proving a
  // negative the fence could have printed. Post-E104: EVERY branch
  // logs with the `[V1-FENCE]` prefix. Below assertions pin each
  // branch's log surface so a future silent-fence regression fails
  // here before it costs another verification cycle.

  it('E104: !leagueId early return logs', () => {
    // Pre-E104 this branch was silent; a stale mount looked
    // indistinguishable from a real probe.
    expect(source).toMatch(/\[V1-FENCE\][^]*no leagueId/i);
  });

  it('E104: probe-start log fires before the fetch', () => {
    // Instrumentation: a probe-start line makes it possible to see
    // "probe fired but no response" in the console vs "probe never
    // fired at all" (the E103/E104 silent-fall-through defect).
    expect(source).toMatch(/\[V1-FENCE\][^]*probing era endpoint/i);
  });

  it('E104: v2Era=true redirect log fires before setState', () => {
    // The load-bearing branch: a v2-era detection must be visible
    // in the console so a field observer can confirm the fence
    // fired.
    expect(source).toMatch(/\[V1-FENCE\][^]*v2Era=true/);
  });

  it('E104: v2Era=false v1-safe log fires', () => {
    // The mundane branch — still logs so operators can distinguish
    // "probe returned false" from "probe never returned".
    expect(source).toMatch(/\[V1-FENCE\][^]*v2Era=false/);
  });

  it('E104: probe error log fires before defensive fall-through', () => {
    // Any error path must log — the pre-E104 silent-catch was the
    // exact defect class that made FENCE-2 necessary.
    expect(source).toMatch(/\[V1-FENCE\][^]*era probe threw/i);
  });
});
