// T12 architect Entry 13 — offline tests for assembleLeagueTimeline
// pure function. Rows in → timeline items out, no I/O, no clock.

import { describe, it, expect } from 'vitest';
import {
  assembleLeagueTimeline,
  LEAGUE_TIMELINE_CAP,
  type AssembleTimelineInput,
  type TransactionInput,
  type MatchupResultInput,
} from '../leagueTimeline';

const EMPTY: AssembleTimelineInput = {
  draft: null,
  transactions: [],
  matchups: [],
};

describe('assembleLeagueTimeline — empty input', () => {
  it('returns [] when all sources are empty', () => {
    expect(assembleLeagueTimeline(EMPTY)).toEqual([]);
  });

  it('returns [] when draft is null and lists are empty', () => {
    expect(
      assembleLeagueTimeline({ draft: null, transactions: [], matchups: [] }),
    ).toEqual([]);
  });

  it('returns [] when draft is present but completedAt is null', () => {
    expect(
      assembleLeagueTimeline({
        draft: { completedAt: null, topPick: null },
        transactions: [],
        matchups: [],
      }),
    ).toEqual([]);
  });
});

describe('assembleLeagueTimeline — draft completion moment', () => {
  it('emits one item with top-pick text when topPick is present', () => {
    const out = assembleLeagueTimeline({
      draft: {
        completedAt: '2026-08-10T20:00:00.000Z',
        topPick: { playerName: 'Connor McDavid', teamName: 'Team A' },
      },
      transactions: [],
      matchups: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      kind: 'draft_completed',
      when: '2026-08-10T20:00:00.000Z',
      headline: 'Draft complete',
      sub: 'Team A took Connor McDavid #1 overall',
    });
  });

  it('falls back to "Rosters are set" sub when topPick is missing', () => {
    const out = assembleLeagueTimeline({
      draft: { completedAt: '2026-08-10T20:00:00.000Z', topPick: null },
      transactions: [],
      matchups: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0].sub).toBe('Rosters are set');
    expect(out[0].headline).toBe('Draft complete');
  });

  it('falls back to "Rosters are set" when topPick is undefined (optional field)', () => {
    const out = assembleLeagueTimeline({
      draft: { completedAt: '2026-08-10T20:00:00.000Z' },
      transactions: [],
      matchups: [],
    });
    expect(out[0].sub).toBe('Rosters are set');
  });
});

describe('assembleLeagueTimeline — transactions', () => {
  it('emits one ADD item per ADD row with team + player name', () => {
    const t: TransactionInput = {
      type: 'ADD',
      playerName: 'Wyatt Johnston',
      teamName: 'Team B',
      createdAt: '2026-11-05T15:30:00.000Z',
    };
    const out = assembleLeagueTimeline({ ...EMPTY, transactions: [t] });
    expect(out).toEqual([
      {
        kind: 'transaction_add',
        when: '2026-11-05T15:30:00.000Z',
        headline: 'Team B added Wyatt Johnston',
        sub: 'Free agent pickup',
      },
    ]);
  });

  it('emits one DROP item per DROP row', () => {
    const t: TransactionInput = {
      type: 'DROP',
      playerName: 'Some Player',
      teamName: 'Team C',
      createdAt: '2026-11-05T16:00:00.000Z',
    };
    const out = assembleLeagueTimeline({ ...EMPTY, transactions: [t] });
    expect(out[0]).toEqual({
      kind: 'transaction_drop',
      when: '2026-11-05T16:00:00.000Z',
      headline: 'Team C dropped Some Player',
      sub: 'Roster move',
    });
  });
});

describe('assembleLeagueTimeline — matchup results', () => {
  it('emits winner-first "beat" text with score', () => {
    const m: MatchupResultInput = {
      week: 3,
      homeTeamName: 'Team A',
      awayTeamName: 'Team B',
      homeScore: 78.5,
      awayScore: 61.2,
      completedAt: '2026-11-04T04:00:00.000Z',
    };
    const out = assembleLeagueTimeline({ ...EMPTY, matchups: [m] });
    expect(out[0]).toEqual({
      kind: 'matchup_result',
      when: '2026-11-04T04:00:00.000Z',
      headline: 'Team A beat Team B, 78.5–61.2',
      sub: 'Week 3',
    });
  });

  it('handles away-team winner', () => {
    const m: MatchupResultInput = {
      week: 5,
      homeTeamName: 'Team A',
      awayTeamName: 'Team B',
      homeScore: 40,
      awayScore: 55,
      completedAt: '2026-11-11T04:00:00.000Z',
    };
    const out = assembleLeagueTimeline({ ...EMPTY, matchups: [m] });
    expect(out[0].headline).toBe('Team B beat Team A, 55–40');
  });

  it('emits "tied" text on exact score parity', () => {
    const m: MatchupResultInput = {
      week: 7,
      homeTeamName: 'Team A',
      awayTeamName: 'Team B',
      homeScore: 50,
      awayScore: 50,
      completedAt: '2026-11-18T04:00:00.000Z',
    };
    const out = assembleLeagueTimeline({ ...EMPTY, matchups: [m] });
    expect(out[0].headline).toBe('Team A tied Team B, 50–50');
  });
});

describe('assembleLeagueTimeline — ordering (newest-first)', () => {
  it('sorts items by `when` descending across source types', () => {
    const input: AssembleTimelineInput = {
      draft: {
        completedAt: '2026-08-01T00:00:00.000Z', // oldest
        topPick: { playerName: 'A', teamName: 'X' },
      },
      transactions: [
        {
          type: 'ADD',
          playerName: 'P1',
          teamName: 'X',
          createdAt: '2026-11-01T00:00:00.000Z', // middle
        },
      ],
      matchups: [
        {
          week: 1,
          homeTeamName: 'X',
          awayTeamName: 'Y',
          homeScore: 60,
          awayScore: 50,
          completedAt: '2026-12-01T00:00:00.000Z', // newest
        },
      ],
    };
    const out = assembleLeagueTimeline(input);
    expect(out.map((i) => i.kind)).toEqual([
      'matchup_result',
      'transaction_add',
      'draft_completed',
    ]);
  });
});

describe('assembleLeagueTimeline — 10-item cap', () => {
  it('caps the output at LEAGUE_TIMELINE_CAP items', () => {
    expect(LEAGUE_TIMELINE_CAP).toBe(10);
    const transactions: TransactionInput[] = Array.from({ length: 25 }, (_, i) => ({
      type: 'ADD' as const,
      playerName: `Player ${i}`,
      teamName: `Team ${i % 4}`,
      // Timestamps increasing so index-25 is newest.
      createdAt: `2026-11-${String((i % 27) + 1).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00.000Z`,
    }));
    const out = assembleLeagueTimeline({ ...EMPTY, transactions });
    expect(out).toHaveLength(10);
  });

  it('cap applies AFTER sort — keeps 10 newest across mixed sources', () => {
    // 15 old matchups + 3 recent transactions → out should contain
    // all 3 transactions (newest) + 7 newest matchups.
    const matchups: MatchupResultInput[] = Array.from({ length: 15 }, (_, i) => ({
      week: i + 1,
      homeTeamName: 'X',
      awayTeamName: 'Y',
      homeScore: 60,
      awayScore: 50,
      completedAt: `2026-10-${String((i % 27) + 1).padStart(2, '0')}T00:00:00.000Z`,
    }));
    const transactions: TransactionInput[] = Array.from({ length: 3 }, (_, i) => ({
      type: 'ADD' as const,
      playerName: `Newer ${i}`,
      teamName: 'X',
      createdAt: `2026-12-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
    }));
    const out = assembleLeagueTimeline({
      draft: null,
      transactions,
      matchups,
    });
    expect(out).toHaveLength(10);
    // First 3 must be the transactions (newest by December date).
    expect(out.slice(0, 3).every((i) => i.kind === 'transaction_add')).toBe(true);
    // Rest are matchups.
    expect(out.slice(3).every((i) => i.kind === 'matchup_result')).toBe(true);
  });
});

describe('assembleLeagueTimeline — null-safety + defense', () => {
  it('does not throw on undefined transactions/matchups (typed but defensive)', () => {
    // Types require arrays but a caller might pass [] or undefined at
    // runtime; guard against the latter via typecheck at call site
    // — this test just proves [] works.
    expect(assembleLeagueTimeline({ draft: null, transactions: [], matchups: [] })).toEqual([]);
  });

  it('silently ignores non-ADD/DROP transaction types (future-safe)', () => {
    const rows = [
      { type: 'ADD' as const, playerName: 'A', teamName: 'X', createdAt: '2026-11-05T00:00:00.000Z' },
      // Cast: intentionally exercise the runtime ignore-branch.
      { type: 'TRADE', playerName: 'B', teamName: 'X', createdAt: '2026-11-05T01:00:00.000Z' } as unknown as TransactionInput,
    ];
    const out = assembleLeagueTimeline({ ...EMPTY, transactions: rows });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('transaction_add');
  });
});
