// COMMISH-START (2026-08-18) — source-shape lock for the pre-draft lobby
// that lives INSIDE the v2 room.
//
// Context: retiring the v1 room (which used to host the start lobby)
// orphaned the "Start Draft" button — a not-started league opened to
// "waiting for the commissioner" with no way to start, ever (field
// report: prod league DACOSTA!, 2026-08-18). This restores the start
// flow where it belongs and makes it a real lobby: managers join, the
// commissioner sees who is in, and officially kicks the draft off.
//
// A full render test would need the DraftRoomV2 runner + WS + store all
// mocked into a `reconnecting.waitingForStart` state; the component's
// contract is small and load-bearing, so a source-shape lock (same
// pattern as DraftRoom.v1Fence.test.tsx / DraftRoom.copyLock) is the
// right surface. The invariants pinned:
//   1. Gated on the SAME signal ConnectionBanner uses — connection
//      state `reconnecting` + `waitingForStart` — NOT on
//      derived.draftStatus (which reads 'not_started' during the live
//      "awaiting pick 1" window and would wrongly show the lobby).
//   2. Additive-only: returns null in every non-waiting state, and its
//      league fetch is gated so it does no network work during a live
//      draft (the exact bug that broke f11 in development).
//   3. Commissioner-only Start: derived from our team's owner_id vs the
//      league commissioner (no AuthProvider dependency).
//   4. Ignition reuses the proven path: initializeDraftOrder +
//      draftV2Api.startDraftV2 (F27 start_draft_v2).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const SRC = readFileSync(resolve(HERE, '..', 'DraftRoomV2.tsx'), 'utf8');
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((l) => {
    const i = l.indexOf('//');
    return i === -1 ? l : l.slice(0, i);
  })
  .join('\n');

describe('DraftRoomV2 — commissioner Start lobby (source-shape lock)', () => {
  it('defines DraftLobbyV2 and renders it in the room shell', () => {
    expect(code).toMatch(/function DraftLobbyV2\(/);
    expect(code).toMatch(/<DraftLobbyV2\s+leagueId=\{leagueId\}\s+teams=\{teams\}\s*\/>/);
  });

  it('gates on connection waitingForStart, NOT on derived draftStatus', () => {
    // The load-bearing correctness fix: keying on derived.draftStatus
    // 'not_started' wrongly fires during the live "awaiting pick 1"
    // window. Must key on the engine's discovery signal instead.
    expect(code).toMatch(
      /connectionState\.kind === 'reconnecting'\s*&&\s*connectionState\.waitingForStart === true/,
    );
    expect(code).toMatch(/if \(!waitingForStart\) return null/);
    // The lobby's own logic must not resurrect the draftStatus gate.
    const lobby = code.slice(code.indexOf('function DraftLobbyV2('));
    expect(lobby).not.toMatch(/draftStatus !== 'not_started'/);
  });

  it('gates its league fetch on waitingForStart (no network work mid-draft)', () => {
    const lobby = code.slice(code.indexOf('function DraftLobbyV2('));
    // The fetch effect early-returns unless we are the lobby, and the
    // dep array includes waitingForStart so it re-runs when it flips.
    // leagueFetchNonce is the Retry re-arm (2026-08-18 hardening).
    expect(lobby).toMatch(/if \(!waitingForStart\) return;/);
    expect(lobby).toMatch(/\}, \[leagueId, waitingForStart, leagueFetchNonce\]\)/);
  });

  it('HARDENING 2026-08-18: league-fetch failure is loud and retryable, never a silent no-button state', () => {
    const lobby = code.slice(code.indexOf('function DraftLobbyV2('));
    // The original silent-catch reproduced the incident this lobby
    // exists to prevent (commissioner stuck with no button, no error).
    expect(lobby).toMatch(/setLeagueError\(/);
    expect(lobby).toMatch(/data-testid="draft-lobby-v2-error"/);
    expect(lobby).toMatch(/data-testid="draft-lobby-v2-retry"/);
    expect(lobby).toMatch(/setLeagueFetchNonce\(\(n\) => n \+ 1\)/);
  });

  it('HARDENING 2026-08-18: Start is gated on a full room (start_draft_v2 requires teams === league_size)', () => {
    const lobby = code.slice(code.indexOf('function DraftLobbyV2('));
    // An enabled button that can only fail with a raw
    // draft_not_configured RPC string is the trap prod league
    // aaaa1111 (MLSE Walkthrough Rehearsal, league_size=4, 1 team)
    // sat in. The gate must read league_size and explain itself.
    expect(lobby).toMatch(/league_size/);
    expect(lobby).toMatch(/roomFull/);
    expect(lobby).toMatch(/disabled=\{isStarting \|\| !roomFull\}/);
    expect(lobby).toMatch(/data-testid="draft-lobby-v2-blocked"/);
  });

  it('shows the Start button only to the commissioner (team-owner derived)', () => {
    const lobby = code.slice(code.indexOf('function DraftLobbyV2('));
    expect(lobby).toMatch(/teams\.find\(\(t\) => t\.id === myTeamId\)\?\.owner_id/);
    expect(lobby).toMatch(/isCommissioner =[\s\S]*?myUserId === league\.commissioner_id/);
    expect(lobby).toMatch(/isCommissioner &&[\s\S]*?data-testid="draft-lobby-v2-start"/);
  });

  it('ignites through the proven path — initializeDraftOrder + startDraftV2', () => {
    const lobby = code.slice(code.indexOf('function DraftLobbyV2('));
    expect(lobby).toMatch(/DraftService\.initializeDraftOrder\(/);
    expect(lobby).toMatch(/draftV2Api\.startDraftV2\(/);
  });

  it('needs no AuthProvider — does not import useAuth or the supabase client', () => {
    expect(code).not.toMatch(/useAuth/);
    const lobby = code.slice(code.indexOf('function DraftLobbyV2('));
    expect(lobby).not.toMatch(/integrations\/supabase\/client/);
  });
});
