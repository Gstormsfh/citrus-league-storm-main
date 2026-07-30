// DR-3.1 (2026-07-29) — F9 regression: rendered pick-label round-size fix.
//
// Mounts the REAL v1 TeamRosters component with the exact fixture the
// Showcase run produced (12 harness teams + 3 picks for slot 3 at pick
// numbers 3, 22, 27) and asserts the DOM literally shows "1.3", "2.10",
// "3.3" — the correct labels for a 12-team snake.
//
// This test would have failed pre-fix (13 teams passed → labels 2.9,
// 3.1 for picks 22, 27 respectively per architect's arithmetic proof).
// With the DR-3.1 adapter filter feeding 12 participating teams, the
// v1 formula `pick.pick % teams.length || teams.length` now lands on
// the correct value for every pick from round 2 onward.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TeamRosters } from '../TeamRosters';
import {
  toV1Teams,
  participatingTeamIdsFromMatrix,
  type FetchedTeam,
} from '@/lib/draftClient/v1Adapters';
import type {
  DerivedDraftState,
  RosterEntry,
} from '@/lib/draftClient/deriveDraftState';

afterEach(() => {
  cleanup();
});

const HARNESS_IDS = Array.from({ length: 12 }, (_, i) =>
  `77777777-7777-7777-7777-${String(i + 1).padStart(12, '0')}`,
);
const SPECTATOR_ID = '4c742dae-6770-43f5-b310-cc24741e8148';
const SLOT_3 = HARNESS_IDS[2];

const THIRTEEN_TEAMS: FetchedTeam[] = [
  ...HARNESS_IDS.map((id, i) => ({
    id,
    team_name: `Harness Team ${String(i + 1).padStart(2, '0')}`,
    owner_name: `Owner ${i + 1}`,
  })),
  { id: SPECTATOR_ID, team_name: 'Gbaby', owner_name: 'Garrett' },
];

const MATRIX_12: Array<{ round: number; pickNumber: number; teamId: string }> = [];
// Round 1 snake forward.
for (let i = 0; i < 12; i++) {
  MATRIX_12.push({ round: 1, pickNumber: i + 1, teamId: HARNESS_IDS[i] });
}
// Round 2 snake reverse.
for (let i = 0; i < 12; i++) {
  MATRIX_12.push({ round: 2, pickNumber: 13 + i, teamId: HARNESS_IDS[11 - i] });
}
// Round 3 snake forward.
for (let i = 0; i < 12; i++) {
  MATRIX_12.push({ round: 3, pickNumber: 25 + i, teamId: HARNESS_IDS[i] });
}

function mkRoster(entries: Array<Partial<RosterEntry> & { seq: number; pickNumber: number; roundNumber: number }>): RosterEntry[] {
  return entries.map((e) => ({
    playerId: 8478050,
    ...e,
  })) as RosterEntry[];
}

function mkDerived(picksBySlot3: RosterEntry[]): DerivedDraftState {
  return {
    currentPickNumber: null,
    currentRoundNumber: null,
    onClockTeamId: null,
    picksMade: picksBySlot3.length,
    totalPicks: 36,
    draftStatus: 'in_progress',
    teamRosters: new Map([[SLOT_3, picksBySlot3]]),
    foldedThroughSeq: picksBySlot3.length,
  };
}

describe('TeamRosters — F9 regression (pick-in-round labels for 12-team snake)', () => {
  it('renders "1.3", "2.10", "3.3" for slot-3 picks at pick_number 3 / 22 / 27 with adapter filter', () => {
    const derived = mkDerived(
      mkRoster([
        { seq: 3, pickNumber: 3, roundNumber: 1, playerId: 8477492 },
        { seq: 22, pickNumber: 22, roundNumber: 2, playerId: 8478402 },
        { seq: 27, pickNumber: 27, roundNumber: 3, playerId: 8482116 },
      ]),
    );
    const participating = participatingTeamIdsFromMatrix(MATRIX_12);
    const v1Teams = toV1Teams(THIRTEEN_TEAMS, derived, new Map(), participating);
    const draftHistory = v1Teams.flatMap((t) => t.picks);

    // Sanity: adapter filtered to 12 (excluded Gbaby).
    expect(v1Teams.length).toBe(12);

    render(
      <TeamRosters
        teams={v1Teams}
        draftHistory={draftHistory}
        userTeamId={SLOT_3}
      />,
    );

    // The v1 formula `${pick.round}.${pick.pick % teams.length || teams.length}`
    // with teams.length=12 produces the correct labels.
    expect(screen.getByText('1.3')).toBeInTheDocument();
    expect(screen.getByText('2.10')).toBeInTheDocument();
    expect(screen.getByText('3.3')).toBeInTheDocument();
    // And the WRONG labels (from the pre-fix 13-team path) must NOT
    // appear on the same row set.
    expect(screen.queryByText('2.9')).not.toBeInTheDocument();
    expect(screen.queryByText('3.1')).not.toBeInTheDocument();
  });

  it('BUG REPRODUCTION (documentation): without the filter, teams.length=13 produces the wrong labels', () => {
    // This test proves the pre-DR-3.1 bug shape. Without the filter,
    // the spectator team leaks through → teams.length=13 → wrong
    // pick-in-round math from round 2 onward. Kept as a regression
    // guard: if this test's assertions ever flip, someone removed the
    // filter and F9 is back.
    const derived = mkDerived(
      mkRoster([
        { seq: 3, pickNumber: 3, roundNumber: 1, playerId: 8477492 },
        { seq: 22, pickNumber: 22, roundNumber: 2, playerId: 8478402 },
        { seq: 27, pickNumber: 27, roundNumber: 3, playerId: 8482116 },
      ]),
    );
    // Note: no participating filter — legacy call shape.
    const v1Teams = toV1Teams(THIRTEEN_TEAMS, derived, new Map());
    const draftHistory = v1Teams.flatMap((t) => t.picks);

    expect(v1Teams.length).toBe(13); // ← the bug source

    render(
      <TeamRosters
        teams={v1Teams}
        draftHistory={draftHistory}
        userTeamId={SLOT_3}
      />,
    );

    // Pre-fix labels (WRONG): 2.9 and 3.1 for picks 22 and 27.
    expect(screen.getByText('1.3')).toBeInTheDocument();  // R1 pick 3: 3 % 13 = 3 (accidentally correct)
    expect(screen.getByText('2.9')).toBeInTheDocument();  // 22 % 13 = 9 (WRONG; should be 2.10)
    expect(screen.getByText('3.1')).toBeInTheDocument();  // 27 % 13 = 1 (WRONG; should be 3.3)
  });
});
