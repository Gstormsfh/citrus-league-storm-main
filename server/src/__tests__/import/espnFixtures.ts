/**
 * Small synthetic ESPN payload builders for job-level tests. The real 2020
 * payload under fixtures/espn covers parser fidelity; these cover the shapes
 * the orchestration cares about (seasonId, previousSeasons, ranks, a bracket,
 * picks, keepers) without the 1.4 MB.
 */
import { EspnClient, type FetchLike } from '../../import/espn/client';

export interface FakeTeam { id: number; swid: string; name: string; rank: number; seed?: number; wins?: number; losses?: number; keepers?: number[] }

export function espnCore(seasonId: number, teams: FakeTeam[], opts: { previous?: number[]; scoringType?: string; isActive?: boolean; isPublic?: boolean; leagueName?: string; keeperCount?: number } = {}) {
  return {
    id: 777,
    seasonId,
    members: teams.map((t) => ({ id: t.swid, displayName: `mgr_${t.name.toLowerCase().replace(/\W+/g, '_')}` })),
    teams: teams.map((t) => ({
      id: t.id, name: t.name, owners: [t.swid], primaryOwner: t.swid,
      rankCalculatedFinal: t.rank, rankFinal: 0, playoffSeed: t.seed ?? t.rank,
      record: { overall: { wins: t.wins ?? 10, losses: t.losses ?? 10, ties: 0, pointsFor: 1000 + (t.wins ?? 10) * 10, pointsAgainst: 900 } },
      draftStrategy: t.keepers ? { keeperPlayerIds: t.keepers } : undefined,
    })),
    settings: {
      name: opts.leagueName ?? 'Test League',
      isPublic: opts.isPublic ?? true,
      scoringSettings: { scoringType: opts.scoringType ?? 'H2H_POINTS', scoringItems: [{ statId: 13, points: 7 }, { statId: 14, points: 3 }] },
      rosterSettings: { lineupSlotCounts: { 0: 2, 1: 2, 2: 2, 4: 4, 5: 2, 7: 4 } },
      scheduleSettings: { matchupPeriodCount: 2, playoffTeamCount: 2, playoffMatchupPeriodLength: 1 },
      draftSettings: { type: 'SNAKE', keeperCount: opts.keeperCount ?? 0 },
    },
    status: { isActive: opts.isActive ?? false, previousSeasons: opts.previous ?? [] },
  };
}

/** Two regular-season weeks between teams 1-2 and 3-4, then a final between the two top seeds. */
export function espnSchedule(teams: FakeTeam[], finalWinnerId: number) {
  const [a, b, c, d] = teams;
  const game = (id: number, week: number, home: FakeTeam, away: FakeTeam, hs: number, as: number, tier = 'NONE') => ({
    id, matchupPeriodId: week, playoffTierType: tier,
    home: { teamId: home.id, totalPoints: hs }, away: { teamId: away.id, totalPoints: as },
    winner: hs > as ? 'HOME' : as > hs ? 'AWAY' : 'TIE',
  });
  const seeds = [...teams].sort((x, y) => (x.seed ?? x.rank) - (y.seed ?? y.rank));
  const top = seeds[0], second = seeds[1];
  const finalHome = top, finalAway = second;
  const winnerIsHome = finalWinnerId === finalHome.id;
  return {
    schedule: [
      game(1, 1, a, b, 100, 80), game(2, 1, c, d, 70, 90),
      game(3, 2, b, a, 60, 65), game(4, 2, d, c, 88, 87),
      game(5, 3, finalHome, finalAway, winnerIsHome ? 120 : 90, winnerIsHome ? 90 : 120, 'WINNERS_BRACKET'),
      game(6, 3, seeds[2], seeds[3], 50, 40, 'WINNERS_CONSOLATION_LADDER'),
    ],
  };
}

export function espnDraft(picks: Array<{ overall: number; teamId: number; playerId: number; keeper?: boolean }>) {
  return {
    draftDetail: {
      drafted: true, inProgress: false,
      picks: picks.map((p) => ({ id: p.overall, overallPickNumber: p.overall, roundId: Math.ceil(p.overall / 4), roundPickNumber: ((p.overall - 1) % 4) + 1, teamId: p.teamId, playerId: p.playerId, keeper: Boolean(p.keeper), bidAmount: 0 })),
    },
  };
}

export type Route = { status: number; body?: unknown };

/**
 * A routed fetch for the EspnClient: keyed on "<seasonId>:<view>" for the
 * first view in the request, or "<seasonId>:*" for any view. Missing keys
 * answer 404 unless a default is given. Records every URL requested.
 */
export function espnRouter(routes: Record<string, Route>, fallback: Route = { status: 404 }) {
  const requested: string[] = [];
  const impl: FetchLike = async (url) => {
    requested.push(url);
    const u = new URL(url);
    const seasonId = u.pathname.match(/\/seasons\/(\d+)\//)?.[1] ?? u.searchParams.get('seasonId') ?? '?';
    const view = u.searchParams.get('view') ?? '*';
    const onHistory = u.pathname.includes('/leagueHistory/');
    const key = `${seasonId}:${view}`;
    // The history path prefers a "history:" override, then falls through to the generic route.
    const candidates = onHistory ? [`history:${key}`, `history:${seasonId}:*`, key, `${seasonId}:*`] : [key, `${seasonId}:*`];
    const route = candidates.map((k) => routes[k]).find(Boolean) ?? fallback;
    return { status: route.status, json: async () => route.body } as unknown as Response;
  };
  return { client: new EspnClient(impl), requested, impl };
}
