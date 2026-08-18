// ARCHITECT 2026-08-12 (BOARD-ROUNDS / inbox E129) — the draft board's
// denominator.
//
// FIELD EVIDENCE. A 12-team x 21-round league was run to completion on
// staging (252 picks). The v2 room's Board tab header read:
//
//     "252 of 192 picks made"
//
// 192 = 12 x 16. `DraftBoard`'s signature defaults `totalRounds = 16`
// (DraftBoard.tsx:57) and computes `totalPicks = teams.length * totalRounds`.
// The v1 page has always passed the prop (DraftRoom.tsx:4574); the v2 page
// dropped it in the port, so every league rendered as a 16-round draft.
//
// In a LIVE 21-round draft the header would reach "192 of 192 picks made"
// around pick 192 and sit there for the remaining 60 — three quarters of the
// way through, the board would tell twelve people the draft was finished.
//
// These tests pin the component's arithmetic and the default, so the number
// on screen can never silently detach from the league's real shape again.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DraftBoard } from '../DraftBoard';

type BoardTeam = React.ComponentProps<typeof DraftBoard>['teams'][number];

const mkTeams = (n: number): BoardTeam[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${i + 1}`,
    name: `Team ${i + 1}`,
    owner: `Owner ${i + 1}`,
    color: '#123456',
    picks: [],
  })) as unknown as BoardTeam[];

const renderBoard = (props: Partial<React.ComponentProps<typeof DraftBoard>>) =>
  render(
    <MemoryRouter>
      <DraftBoard
        teams={mkTeams(12)}
        draftHistory={[]}
        currentPick={1}
        currentRound={1}
        draftType="snake"
        {...props}
      />
    </MemoryRouter>,
  );

afterEach(cleanup);

describe('DraftBoard — totalPicks denominator', () => {
  it('12 teams x 21 rounds reads "of 252", not "of 192"', () => {
    // The exact league shape THE TWELVE will draft.
    renderBoard({ totalRounds: 21 });
    expect(screen.getByText(/of 252 picks made/)).toBeInTheDocument();
    expect(screen.queryByText(/of 192 picks made/)).toBeNull();
  });

  it('honours the round count for other shapes too', () => {
    renderBoard({ teams: mkTeams(10), totalRounds: 15 });
    expect(screen.getByText(/of 150 picks made/)).toBeInTheDocument();
  });

  it('still defaults to 16 rounds when the prop is omitted (documents the trap)', () => {
    // Not endorsing the default — pinning it, so anyone who changes it sees
    // this test and goes looking for the callers that rely on it.
    renderBoard({});
    expect(screen.getByText(/of 192 picks made/)).toBeInTheDocument();
  });

  it('an explicit undefined behaves as omitted, which is what the v2 page passes pre-snapshot', () => {
    renderBoard({ totalRounds: undefined });
    expect(screen.getByText(/of 192 picks made/)).toBeInTheDocument();
  });
});

describe('DraftBoard — the numerator is the real pick count', () => {
  it('counts the history rows, so numerator and denominator can be compared', () => {
    const history = Array.from({ length: 5 }, (_, i) => ({
      pick: i + 1,
      round: 1,
      teamId: 't1',
      teamName: 'Team 1',
      playerId: 100 + i,
      playerName: `Player ${i + 1}`,
      position: 'C',
      nhlTeam: 'EDM',
    })) as unknown as React.ComponentProps<typeof DraftBoard>['draftHistory'];
    renderBoard({ draftHistory: history, totalRounds: 21 });
    expect(screen.getByText(/5 of 252 picks made/)).toBeInTheDocument();
  });
});
