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

  // 2026-08-24 polish: the sub line reads the ledger's `source` so a won
  // waiver claim is not labeled as a free-agent pickup. Nothing pinned this
  // until 2026-09-01 (the shared suite was not wired into any runner).
  it('labels ADD/DROP rows with source "Waiver Processing" as waiver moves', () => {
    const rows: TransactionInput[] = [
      { type: 'ADD', playerName: 'A', teamName: 'X', createdAt: '2026-11-05T00:00:00.000Z', source: 'Waiver Processing' },
      { type: 'DROP', playerName: 'B', teamName: 'X', createdAt: '2026-11-04T00:00:00.000Z', source: 'Waiver Processing' },
    ];
    const out = assembleLeagueTimeline({ ...EMPTY, transactions: rows });
    expect(out.map((i) => i.sub)).toEqual(['Waiver claim', 'Dropped in waiver claim']);
  });

  it('keeps the generic ADD/DROP labels for non-waiver sources and absent source', () => {
    const rows: TransactionInput[] = [
      { type: 'ADD', playerName: 'A', teamName: 'X', createdAt: '2026-11-05T00:00:00.000Z', source: 'Roster Tab' },
      { type: 'DROP', playerName: 'B', teamName: 'X', createdAt: '2026-11-04T00:00:00.000Z', source: null },
    ];
    const out = assembleLeagueTimeline({ ...EMPTY, transactions: rows });
    expect(out.map((i) => i.sub)).toEqual(['Free agent pickup', 'Roster move']);
  });
});

describe('assembleLeagueTimeline — trades (2026-08-24 launch build)', () => {
  // TRADE became a first-class ledger type in the 2026-08-24 launch build
  // (before that it fell through to the "silently ignored" branch). The
  // trade RPC writes TWO ledger rows per player: 'Trade out' on the sending
  // team and 'Trade in' on the receiving team. The feed renders the
  // receiving side only — one item per player movement, not two.
  it('emits one transaction_trade item for a "Trade in" row', () => {
    const t: TransactionInput = {
      type: 'TRADE',
      playerName: 'Jack Hughes',
      teamName: 'Team D',
      createdAt: '2026-11-06T18:00:00.000Z',
      source: 'Trade in',
    };
    const out = assembleLeagueTimeline({ ...EMPTY, transactions: [t] });
    expect(out).toEqual([
      {
        kind: 'transaction_trade',
        when: '2026-11-06T18:00:00.000Z',
        headline: 'Team D acquired Jack Hughes',
        sub: 'Trade',
      },
    ]);
  });

  it('suppresses the "Trade out" side so each player movement is one item', () => {
    const rows: TransactionInput[] = [
      { type: 'TRADE', playerName: 'Jack Hughes', teamName: 'Team C', createdAt: '2026-11-06T18:00:00.000Z', source: 'Trade out' },
      { type: 'TRADE', playerName: 'Jack Hughes', teamName: 'Team D', createdAt: '2026-11-06T18:00:00.000Z', source: 'Trade in' },
    ];
    const out = assembleLeagueTimeline({ ...EMPTY, transactions: rows });
    expect(out).toHaveLength(1);
    expect(out[0].headline).toBe('Team D acquired Jack Hughes');
  });

  it('renders a TRADE row with no source (only "Trade out" is dropped)', () => {
    const t: TransactionInput = {
      type: 'TRADE',
      playerName: 'Jack Hughes',
      teamName: 'Team D',
      createdAt: '2026-11-06T18:00:00.000Z',
    };
    const out = assembleLeagueTimeline({ ...EMPTY, transactions: [t] });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('transaction_trade');
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

describe('assembleLeagueTimeline — ordering (newest-first, epoch compare per Entry 15 C1)', () => {
  it('handles MIXED offset representations correctly (Entry 15 C1 fix)', () => {
    // Same moment in wall-clock — but represented with different
    // offsets. String-compare would misorder these; epoch-compare
    // correctly identifies them as identical (fall through to
    // stable source order).
    //   "2026-08-10T20:00:00.000Z"      = 1786161600000
    //   "2026-08-10T14:00:00.000-06:00" = 1786161600000 (same!)
    //   "2026-08-10T22:00:00.000+02:00" = 1786161600000 (same!)
    // But under string sort: -06:00 > +02:00 > Z, which would
    // scramble any downstream "newest first" claim across mixed
    // sources.
    //
    // Also test the ACTUAL ordering property: a Z-suffixed string
    // that represents an EARLIER moment than a -06:00 string must
    // sort AFTER (older). Under string compare, "Z" > "-" so the
    // Z entry would sort BEFORE the -06:00 entry regardless of
    // which represents a later moment.
    const input: AssembleTimelineInput = {
      draft: null,
      transactions: [
        {
          type: 'ADD',
          playerName: 'Later',
          teamName: 'X',
          // 2026-08-10T20:00:00Z = 20:00 UTC (LATER moment)
          createdAt: '2026-08-10T20:00:00.000Z',
        },
        {
          type: 'ADD',
          playerName: 'Earlier',
          teamName: 'X',
          // 2026-08-10T13:00:00-06:00 = 19:00 UTC (EARLIER moment)
          createdAt: '2026-08-10T13:00:00.000-06:00',
        },
      ],
      matchups: [],
    };
    const out = assembleLeagueTimeline(input);
    // Correct ordering: Later (20:00 UTC) first, Earlier (19:00 UTC) second.
    expect(out.map((i) => i.headline)).toEqual([
      'X added Later',
      'X added Earlier',
    ]);
  });

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

  it('silently ignores unrecognised transaction types (future-safe)', () => {
    // STALE-TEST FIX (2026-09-01). This case used to feed a 'TRADE' row as
    // its example of an unrecognised type, which was accurate when it was
    // written (Entry 13: type was 'ADD' | 'DROP' and the implementation's
    // own comment listed TRADE among the "explicit cases later"). The
    // 2026-08-24 launch build made TRADE a first-class type that renders a
    // `transaction_trade` item, so the row it expected to be dropped is now
    // rendered on purpose — and because nothing ran this suite, the failure
    // sat unseen for a week. The implementation is right; the example was
    // stale. 'IR' is what the implementation comment still names as a
    // future type, so it is the honest example of the ignore branch now.
    // TRADE has its own describe block above.
    const rows = [
      { type: 'ADD' as const, playerName: 'A', teamName: 'X', createdAt: '2026-11-05T00:00:00.000Z' },
      // Cast: intentionally exercise the runtime ignore-branch.
      { type: 'IR', playerName: 'B', teamName: 'X', createdAt: '2026-11-05T01:00:00.000Z' } as unknown as TransactionInput,
    ];
    const out = assembleLeagueTimeline({ ...EMPTY, transactions: rows });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('transaction_add');
  });
});
