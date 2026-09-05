// THE APP HOME'S ARITHMETIC (2026-09-04) — artboard 1a's LEAGUES tab.
//
// The screen is three reads and a handful of pure mappings; these pin the
// mappings, which is where a wrong word would come from: the crest, the
// week, the ticker line, and which of tonight's players are yours.

import { describe, it, expect } from 'vitest';
import type { ScoreboardGame, ScoresDayResponse } from '@citrus/shared';
import { crestOf, tickerGame, tonightPlayers, weekOf } from '../homeFormat';
import type { League } from '@/services/LeagueService';

const game = (over: Partial<ScoreboardGame>): ScoreboardGame =>
  ({
    gameId: 1, gameDate: '2026-10-01', startsAt: '2026-10-02T02:00:00.000Z', state: 'scheduled', statusRaw: null,
    period: null, periodTime: null, venue: null, gameType: '02', season: 20262027,
    away: { abbrev: 'EDM', teamId: 1, city: null, name: null }, home: { abbrev: 'TOR', teamId: 2, city: null, name: null },
    awayScore: null, homeScore: null, citrus: null,
    ...over,
  }) as ScoreboardGame;

describe('crestOf', () => {
  it('takes two initials, or a one-word name\'s first and last letters', () => {
    expect(crestOf('Puck Heads Dynasty')).toBe('PH');
    expect(crestOf("Office Pick'em")).toBe('OP');
    expect(crestOf('Finalsz')).toBe('FZ');
    expect(crestOf('X')).toBe('X');
    expect(crestOf('')).toBe('?');
  });
});

describe('weekOf', () => {
  const league = (over: Partial<League>): League =>
    ({ id: 'L', name: 'L', draft_status: 'completed', created_at: '2026-09-01T18:00:00.000Z', settings: {}, ...over }) as League;
  it('is null before the draft and in the offseason, a week otherwise', () => {
    expect(weekOf(league({ draft_status: 'not_started' }), false)).toBeNull();
    expect(weekOf(league({}), true)).toBeNull();
    expect(weekOf(league({}), false)).toBeGreaterThanOrEqual(1);
    expect(weekOf(league({ created_at: 'nonsense' }), false)).toBeNull();
  });
});

describe('tickerGame', () => {
  it('prints the score and the period while live, the pairing and the time before', () => {
    expect(tickerGame(game({ state: 'live', awayScore: 3, homeScore: 2, period: '3rd', periodTime: '4:12' }))).toEqual({
      id: '1', line: 'EDM 3 · TOR 2', state: '3rd 4:12', live: true,
    });
    const before = tickerGame(game({}));
    expect(before.line).toBe('EDM · TOR');
    expect(before.live).toBe(false);
    expect(before.state).toMatch(/\d/);
  });
});

describe('tonightPlayers', () => {
  const line = (over: Record<string, unknown>) => ({
    playerId: 1, name: 'Connor McDavid', teamAbbrev: 'EDM', position: 'C', isGoalie: false, headshotUrl: null,
    projectedPoints: 6.2, confidenceLabel: null, actualPoints: null, actuals: null, roster: { teamId: 't1', teamName: 'T', isMine: true },
    ...over,
  });
  const day = (games: ScoreboardGame[]): ScoresDayResponse =>
    ({ date: '2026-10-01', games, nearestDateWithGames: { before: null, after: null }, league: { id: 'L', rostersResolved: true }, truncated: false, generatedAt: '' }) as ScoresDayResponse;

  it('keeps only yours, best line first, with what they have done or are projected to', () => {
    const out = tonightPlayers(
      day([
        game({
          gameId: 1, state: 'live', period: '3rd', periodTime: '4:12', awayScore: 3, homeScore: 2,
          citrus: { projectedPlayers: 2, players: [
            line({ actualPoints: 8.4, actuals: { goals: 1, assists: 2, points: 3, shotsOnGoal: 4, blocks: 0, hits: 0, ppp: 0, toiSeconds: 0, saves: null, goalsAgainst: null, wins: null, shutouts: null } }),
            line({ playerId: 2, name: 'Auston Matthews', teamAbbrev: 'TOR', roster: { teamId: 't2', teamName: 'O', isMine: false } }),
          ], rosteredCount: 2, myCount: 1, confidence: { high: 0, medium: 0, low: 0, unlabeled: 0 }, hasActuals: true },
        }),
        game({ gameId: 2, away: { abbrev: 'COL', teamId: 3, city: null, name: null }, home: { abbrev: 'LAK', teamId: 4, city: null, name: null },
          citrus: { projectedPlayers: 1, players: [line({ playerId: 3, name: 'Cale Makar', teamAbbrev: 'COL', projectedPoints: 6.2 })], rosteredCount: 1, myCount: 1, confidence: { high: 0, medium: 0, low: 0, unlabeled: 0 }, hasActuals: false } }),
        game({ gameId: 3, state: 'final' }),
      ]),
    );
    expect(out.games).toBe(2);
    expect(out.players.map((p) => p.name)).toEqual(['McDavid', 'Makar']);
    expect(out.players[0]).toMatchObject({ gameLine: 'EDM · 3RD', points: 8.4, unit: '1G 2A', played: true });
    expect(out.players[1]).toMatchObject({ points: 6.2, unit: 'PROJ', played: false });
    expect(out.players[1].gameLine).toMatch(/^COL · /);
  });

  it('is empty with no read', () => {
    expect(tonightPlayers(undefined)).toEqual({ players: [], games: 0 });
  });
});
