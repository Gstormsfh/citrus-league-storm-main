/** Renders one real page at a phone viewport. ?p=waivers|settings|contact */
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, lazy } from 'react';
import '../src/index.css';
import { CitrusToaster } from '../src/components/notifications/CitrusToaster';
/**
 * THE APP'S BOTTOM NAV (2026-09-04). `App.tsx` renders this on every route;
 * this harness renders the PAGE only, so every screen reviewed here was
 * missing the chrome a manager actually sees -- and the roster looked like it
 * had lost its bottom buttons when nothing had changed. A page harness that
 * omits the app frame answers a question nobody asked.
 */
import MobileBottomNav from '../src/components/MobileBottomNav';
/**
 * THE STORMY BAR (2026-09-04). App.tsx mounts StormyChatBubble on every
 * route; on a phone its closed state is now the Press Box bar above the nav,
 * and a page reviewed without it is a page reviewed with 40px more room than
 * it will have.
 */
import { StormyChatBubble } from '../src/components/StormyChatBubble';

// Every network call the pages make, stubbed at the module object.
import { WaiverService } from '../src/services/WaiverService';
import { PlayerService } from '../src/services/PlayerService';
import { LeagueService } from '../src/services/LeagueService';
import { ScheduleService } from '../src/services/ScheduleService';
import { MatchupService } from '../src/services/MatchupService';
import { DraftService } from '../src/services/DraftService';
import { PlayoffService } from '../src/services/PlayoffService';
import { matchupApi } from '../src/api/matchups';
import { leagueApi } from '../src/api/leagues';
import { accountApi } from '../src/api/account';
import { rosterApi } from '../src/api/rosters';
import { tradeApi } from '../src/api/trades';
import { scheduleApi } from '../src/api/schedule';
import { waiverApi } from '../src/api/waivers';
import { scoresApi } from '../src/api/scores';
import { ScoringCalculator, extractScoringSettings } from '../src/utils/scoringUtils';
import { LeagueSettingsService } from '../src/services/LeagueSettingsService';
import { HARNESS_PLAYERS, harnessDirectoryPlayer, harnessPlayer } from './players';
import { OPP as MATCHUP_OPP, USER as MATCHUP_USER } from './matchupFixtures';

/**
 * The SERVER computes fantasy points and the row reads `total_points` off the
 * stat line -- so a fixture that returns counting stats without it prints 0.0
 * on every live and final row, which is exactly what this harness did. The
 * calculator is the app's own, configured with the app's own defaults, so the
 * number under a stat line can never disagree with the stat line above it.
 */
const HARNESS_SCORER = new ScoringCalculator(extractScoringSettings(null));

/**
 * THE LEAGUE SCORES LIKE A REAL ONE (2026-09-04). This was `{}` -- an empty
 * object, which is TRUTHY, so `extractScoringSettings` handed it to the
 * calculator instead of falling back, every stat was worth nothing, and the
 * roster's TODAY column read 0.0 on every live and final row. A page-level
 * zero that looks exactly like a broken points pipeline.
 *
 * `null` is the fix, not a hand-written weights table: the app then falls
 * back to its OWN `DEFAULT_SCORING`, so the harness scores the way an
 * unconfigured league really does and cannot drift from it.
 */
const HARNESS_SCORING = null;

/**
 * THE ROSTER IS REAL (2026-09-02). This file used to wrap an 18-name list to
 * 60 by appending a counter -- "Connor McDavid 2", "Nathan MacKinnon 2" --
 * and set `headshot_url: null` on every one of them, so `Mug` fell through
 * headshot -> crest -> initials on every row and every review screenshot the
 * repo has produced shows initials discs. Production is not like that:
 * measured the same day, 801 of 801 rows in `players` carry a headshot_url,
 * every one on the NHL CDN. See harness/players.ts.
 *
 * ID SCHEME IS LOAD-BEARING: `harnessDirectoryPlayer` numbers ids from 7000,
 * and CLAIMS below references 7001, 7002, 7003, 7009 and 7012 by player id.
 * Those five must keep pointing at five real, distinct players.
 */
const PLAYERS = HARNESS_PLAYERS.map((p, i) => harnessDirectoryPlayer(p, i));
// The first 18 are a legal 18-man roster (5xC, 3xLW, 3xRW, 5xD, 2xG), so the
// team this page renders is one a manager could actually start.
const MY_ROSTER = PLAYERS.slice(0, 18);

const CLAIMS = [
  { id: 'c1', league_id: 'harness-league', team_id: 't1', player_id: 7003, drop_player_id: 7001,
    priority: 3, status: 'pending', created_at: new Date(0).toISOString(), processed_at: null, failure_reason: null },
  { id: 'c2', league_id: 'harness-league', team_id: 't1', player_id: 7009, drop_player_id: null,
    priority: 3, status: 'successful', created_at: new Date(0).toISOString(), processed_at: new Date(0).toISOString(), failure_reason: null },
  { id: 'c3', league_id: 'harness-league', team_id: 't1', player_id: 7012, drop_player_id: 7002,
    priority: 3, status: 'failed', created_at: new Date(0).toISOString(), processed_at: new Date(0).toISOString(),
    failure_reason: 'Another team had higher priority' },
];

const PRIORITY = Array.from({ length: 10 }, (_, i) => ({
  team_id: `t${i + 1}`, team_name: `Team ${i + 1}`, owner_name: `Owner ${i + 1}`, priority: i + 1,
}));

/* eslint-disable @typescript-eslint/no-explicit-any */
(PlayerService as any).getAllPlayers = async () => PLAYERS;
(PlayerService as any).getPlayersByIds = async (ids: string[]) =>
  PLAYERS.filter((p: any) => ids.map(String).includes(String(p.id)));
(LeagueService as any).getFreeAgents = async () => ({ players: PLAYERS.slice(18) });
(LeagueService as any).getLeague = async () => ({
  league: { id: 'harness-league', name: 'Harness League', team_count: 10, settings: {}, scoring_settings: HARNESS_SCORING, waiver_type: 'rolling', draft_status: 'completed', commissioner_id: 'harness-user', created_at: '2026-09-01T18:00:00.000Z', join_code: 'HARNESS' },
  error: null,
});
(LeagueService as any).getUserLeagues = async () => ({
  leagues: [{ id: 'harness-league', name: 'Harness League', commissioner_id: 'harness-user', draft_status: 'completed', created_at: '2026-09-01T18:00:00.000Z', settings: {} }],
  error: null,
});
/**
 * STANDINGS RENDER (2026-09-04). This returned `{ id, name }`, and the
 * Standings page reads `team_name` off each row — so it threw on
 * `undefined.substring`, swallowed it, and rendered "the league is still
 * filling up" for a ten-team league. Every page that reads this fixture now
 * gets the real shape, and the standings path is stubbed the rest of the way
 * down: picks (so the stats path runs), the stats themselves, the score
 * refresh no-ops, and a playoff picture with a clinch and an elimination in
 * it so the sub-line has something to say.
 */
(LeagueService as any).getLeagueTeamsWithOwners = async () => ({
  teams: PRIORITY.map((p, i) => ({
    id: p.team_id, name: p.team_name, team_name: p.team_name, owner_name: p.owner_name,
    owner_id: i === 0 ? 'harness-user' : `owner-${i + 1}`,
  })),
  error: null,
});
(DraftService as any).getDraftPicks = async () => ({
  picks: MY_ROSTER.slice(0, 1).map((p: any) => ({ player_id: Number(p.id), team_id: 't1', round: 1, pick: 1 })),
  error: null,
});
const HARNESS_RECORDS = [
  [5, 0, 612.4, 498.1, 'W5', 5, 0], [4, 1, 588.9, 521.3, 'W2', 4, 1], [4, 1, 561.2, 530.0, 'L1', 4, 1],
  [3, 2, 549.8, 540.2, 'W1', 3, 2], [3, 2, 533.0, 529.7, 'W1', 3, 2], [3, 2, 512.6, 515.9, 'L2', 3, 2],
  [2, 3, 498.2, 538.1, 'L1', 2, 3], [2, 3, 487.7, 522.9, 'W1', 2, 3], [1, 4, 466.0, 551.4, 'L3', 1, 4],
  [1, 4, 451.3, 560.8, 'L4', 1, 4],
] as const;
(LeagueService as any).calculateTeamStandings = async () =>
  Object.fromEntries(
    PRIORITY.map((p, i) => {
      const [wins, losses, pointsFor, pointsAgainst, streak, w5, l5] = HARNESS_RECORDS[i];
      return [p.team_id, { wins, losses, ties: 0, pointsFor, pointsAgainst, streak, last5: { wins: w5, losses: l5, ties: 0 }, gamesPlayed: 5 }];
    }),
  );
(MatchupService as any).autoCompleteMatchups = async () => ({ error: null });
(MatchupService as any).updateMatchupScores = async () => ({ error: null, updatedCount: 0 });
(PlayoffService as any).getPlayoffPicture = async () => ({
  picture: {
    playoff_teams: 6,
    teams: PRIORITY.map((p, i) => ({
      team_id: p.team_id, team_name: p.team_name, rank: i + 1,
      wins: HARNESS_RECORDS[i][0], losses: HARNESS_RECORDS[i][1], ties: 0,
      pf: HARNESS_RECORDS[i][2], pa: HARNESS_RECORDS[i][3],
      clinch_status: i === 0 ? 'clinched' : i === 9 ? 'eliminated' : 'in_contention',
      magic_number: i > 0 && i < 6 ? 6 - i : 0,
    })),
  },
  error: null,
});
/**
 * The bracket (2026-09-04, PR10l). Standings asks for it too and wants NONE
 * during the season -- so the fixture is served only to the playoffs page.
 * A six-team, round-two bracket: two byes, one final, one series live, the
 * championship still to be set, and the third-place game pending.
 */
const HARNESS_BRACKET = {
  id: 'pb1', league_id: 'harness-league', season: 2026, bracket_size: 6, status: 'active' as const,
  current_round: 2, total_rounds: 3, seeding_method: 'standings' as const, reseed_each_round: false,
  consolation_enabled: false, two_week_matchups: false, champion_team_id: null, runner_up_team_id: null,
  third_place_team_id: null, generated_by: 'harness-user', started_at: '2026-03-16T00:00:00.000Z',
  completed_at: null, created_at: '2026-03-15T00:00:00.000Z', updated_at: '2026-03-23T00:00:00.000Z',
};
const HARNESS_SEEDS = PRIORITY.slice(0, 6).map((p, i) => ({
  id: `seed-${i + 1}`, bracket_id: 'pb1', team_id: p.team_id, seed_number: i + 1,
  regular_season_wins: HARNESS_RECORDS[i][0], regular_season_losses: HARNESS_RECORDS[i][1], regular_season_ties: 0,
  regular_season_points_for: HARNESS_RECORDS[i][2], source: 'standings' as const, created_at: '2026-03-15T00:00:00.000Z',
}));
const series = (
  id: string, round: number, match: number, home: [number | null, number], away: [number | null, number],
  status: 'pending' | 'bye' | 'active' | 'completed', weeks: [number | null, number | null], winner: number | null = null,
) => ({
  id, bracket_id: 'pb1', round_number: round, match_number: match, bracket_position: 'winners' as const,
  home_seed: home[0], away_seed: away[0],
  home_team_id: home[0] ? `t${home[0]}` : null, away_team_id: away[0] ? `t${away[0]}` : null,
  home_score: home[1], away_score: away[1],
  winner_team_id: winner ? `t${winner}` : null,
  loser_team_id: winner ? (winner === home[0] ? (away[0] ? `t${away[0]}` : null) : `t${home[0]}`) : null,
  status, matchup_week_1: weeks[0], matchup_week_2: weeks[1],
  winner_advances_to: null, winner_slot: null, loser_drops_to: null, loser_slot: null, created_at: '2026-03-15T00:00:00.000Z',
});
const HARNESS_SERIES = [
  series('s1', 1, 1, [1, 0], [null, 0], 'bye', [null, null], 1),
  series('s2', 1, 2, [2, 0], [null, 0], 'bye', [null, null], 2),
  series('s3', 1, 3, [3, 112.4], [6, 98.1], 'completed', [23, null], 3),
  series('s4', 1, 4, [4, 101.7], [5, 104.2], 'completed', [23, null], 5),
  series('s5', 2, 1, [1, 88.3], [5, 79.6], 'active', [24, null]),
  series('s6', 2, 2, [2, 61.0], [3, 74.9], 'active', [24, null]),
  series('s7', 3, 1, [null, 0], [null, 0], 'pending', [25, null]),
  { ...series('s8', 3, 2, [null, 0], [null, 0], 'pending', [25, null]), bracket_position: 'third_place' as const },
];
/** `?p=playoffs&bracket=none|done` shows the pre-season and the champion states. */
(PlayoffService as any).getBracket = async () => {
  const q = new URLSearchParams(location.search);
  if (q.get('p') !== 'playoffs' || q.get('bracket') === 'none') return { bracket: null, seeds: [], series: [], error: null };
  if (q.get('bracket') === 'done') {
    return {
      bracket: { ...HARNESS_BRACKET, status: 'completed' as const, current_round: 3, champion_team_id: 't1', runner_up_team_id: 't3', third_place_team_id: 't5', completed_at: '2026-04-06T00:00:00.000Z' },
      seeds: HARNESS_SEEDS,
      series: [
        ...HARNESS_SERIES.slice(0, 4),
        series('s5', 2, 1, [1, 131.2], [5, 117.8], 'completed', [24, null], 1),
        series('s6', 2, 2, [2, 109.4], [3, 122.6], 'completed', [24, null], 3),
        series('s7', 3, 1, [1, 126.0], [3, 119.3], 'completed', [25, null], 1),
        { ...series('s8', 3, 2, [5, 108.7], [2, 97.5], 'completed', [25, null], 5), bracket_position: 'third_place' as const },
      ],
      error: null,
    };
  }
  return { bracket: HARNESS_BRACKET, seeds: HARNESS_SEEDS, series: HARNESS_SERIES, error: null };
};

/**
 * THE MATCHUP PAGE RENDERS (2026-09-04). Until now `page.html?p=matchup`
 * showed "No matchup data available" — the page needs a user team, a
 * matchup for the week and the two rosters, and none of those were
 * stubbed; the rows could only be looked at through `matchup.html`, which
 * mounts them bare. These hand the page the same two rosters that harness
 * uses, through the service calls the page actually makes, in the order it
 * makes them. Scores and records are the fixture's.
 */
const MATCHUP_ROW = {
  id: 'm1', league_id: 'harness-league', week_number: 1,
  team1_id: 't1', team2_id: 't2', team1_score: 118.4, team2_score: 96.1,
  status: 'in_progress', week_start_date: '2026-09-27', week_end_date: '2026-10-03',
  created_at: '2026-09-01T18:00:00.000Z', updated_at: '2026-09-01T18:00:00.000Z',
};
(LeagueService as any).getUserTeam = async () => ({
  team: { id: 't1', league_id: 'harness-league', owner_id: 'harness-user', team_name: 'Team 1', created_at: '2026-09-01', updated_at: '2026-09-01' },
  error: null,
});
(LeagueService as any).getLeagueTeams = async () => ({
  teams: PRIORITY.map((p, i) => ({ id: p.team_id, league_id: 'harness-league', team_name: p.team_name, owner_id: i === 0 ? 'harness-user' : `owner-${i + 1}` })),
  error: null,
});
(MatchupService as any).getUserMatchup = async () => ({ matchup: MATCHUP_ROW, error: null });
(MatchupService as any).getMatchupData = async () => ({
  data: {
    matchupId: 'm1',
    matchup: MATCHUP_ROW,
    currentWeek: 1,
    scheduleLength: 24,
    isPlayoffWeek: false,
    userTeam: { id: 't1', name: 'Team 1', roster: MATCHUP_USER.filter(Boolean), slotAssignments: {}, record: { wins: 4, losses: 1 }, dailyPoints: [] },
    opponentTeam: { id: 't2', name: 'Team 2', roster: MATCHUP_OPP.filter(Boolean), slotAssignments: {}, record: { wins: 3, losses: 2 }, dailyPoints: [] },
    navigation: { previousWeek: null, nextWeek: 2, previousMatchupId: null, nextMatchupId: null },
  },
  error: null,
});
(MatchupService as any).getMatchupRosters = async () => ({
  team1Roster: MATCHUP_USER.filter(Boolean), team2Roster: MATCHUP_OPP.filter(Boolean),
  team1SlotAssignments: {}, team2SlotAssignments: {}, error: null,
});
(matchupApi as any).ensureRosters = async () => ({ data: { ok: true } });
(matchupApi as any).getFrozenRosterBatch = async () => ({ data: [] });
(matchupApi as any).getMatchupScores = async () => ({ data: MATCHUP_ROW });

/**
 * THE APP HOME (2026-09-04): tonight's slate from the scores read, with the
 * caller's players marked the way the real endpoint marks them
 * (`roster.isMine`), so the ticker and TONIGHT ON YOUR ROSTERS render from
 * the same shape production hands the page. Two live games, one final, one
 * still to start.
 */
const HARNESS_TODAY = new Date().toISOString().slice(0, 10);
const scoresGame = (id: number, away: string, home: string, over: Record<string, unknown>) => ({
  gameId: id, gameDate: HARNESS_TODAY, startsAt: `${HARNESS_TODAY}T02:00:00.000Z`, state: 'scheduled', statusRaw: null,
  period: null, periodTime: null, venue: null, gameType: '02', season: 20262027,
  away: { abbrev: away, teamId: 1, city: null, name: null }, home: { abbrev: home, teamId: 2, city: null, name: null },
  awayScore: null, homeScore: null, citrus: null, ...over,
});
const mineLine = (who: string, projected: number, actual: number | null, actuals: Record<string, number> | null) => {
  const p = harnessDirectoryPlayer(harnessPlayer(who), 0);
  return {
    playerId: Number(p.id), name: p.full_name, teamAbbrev: p.team, position: p.position, isGoalie: p.position === 'G',
    headshotUrl: p.headshot_url, projectedPoints: projected, confidenceLabel: 'high', actualPoints: actual,
    actuals: actuals ? { goals: 0, assists: 0, points: 0, shotsOnGoal: 0, blocks: 0, hits: 0, ppp: 0, toiSeconds: 0, saves: null, goalsAgainst: null, wins: null, shutouts: null, ...actuals } : null,
    roster: { teamId: 't1', teamName: 'Team 1', isMine: true },
  };
};
(scoresApi as any).getDay = async () => ({
  date: HARNESS_TODAY,
  games: [
    scoresGame(1, 'EDM', 'TOR', { state: 'live', period: '3rd', periodTime: '4:12', awayScore: 3, homeScore: 2,
      citrus: { projectedPlayers: 4, players: [mineLine('Connor McDavid', 6.2, 8.4, { goals: 1, assists: 2, points: 3, shotsOnGoal: 4 })], rosteredCount: 6, myCount: 1, confidence: { high: 1, medium: 0, low: 0, unlabeled: 0 }, hasActuals: true } }),
    scoresGame(2, 'BOS', 'NYR', { state: 'live', period: '2nd', periodTime: '11:40', awayScore: 1, homeScore: 1,
      citrus: { projectedPlayers: 4, players: [mineLine('David Pastrnak', 5.1, 2.1, { shotsOnGoal: 3 })], rosteredCount: 5, myCount: 1, confidence: { high: 1, medium: 0, low: 0, unlabeled: 0 }, hasActuals: true } }),
    scoresGame(3, 'COL', 'LAK', { citrus: { projectedPlayers: 3, players: [mineLine('Cale Makar', 6.2, null, null)], rosteredCount: 4, myCount: 1, confidence: { high: 1, medium: 0, low: 0, unlabeled: 0 }, hasActuals: false } }),
    scoresGame(4, 'MIN', 'STL', { state: 'final', awayScore: 4, homeScore: 2 }),
  ],
  nearestDateWithGames: { before: null, after: null },
  league: { id: 'harness-league', rostersResolved: true },
  truncated: false,
  generatedAt: new Date().toISOString(),
});
/**
 * A game's expanded detail on the Scores tab (2026-09-04): the row's own
 * players plus a few from the other club, one rostered by someone else and
 * one free, so the row states (yours / theirs / nobody's) are all on screen.
 */
(scoresApi as any).getGame = async (gameId: number) => {
  const day = await (scoresApi as any).getDay();
  const game = day.games.find((g: any) => g.gameId === gameId) ?? day.games[0];
  const live = game.state !== 'scheduled';
  const other = (who: string, projected: number, actual: number | null, roster: any) => ({
    ...mineLine(who, projected, actual, actual == null ? null : { goals: 1, assists: 0, points: 1, shotsOnGoal: 2 }),
    roster,
  });
  return {
    game,
    players: [
      ...(game.citrus?.players ?? []),
      other('Mitch Marner', 5.8, live ? 3.2 : null, { teamId: 't3', teamName: 'Puck Norris', isMine: false }),
      other('William Nylander', 4.1, live ? 0 : null, null),
      other('Leon Draisaitl', 5.4, live ? 6.1 : null, { teamId: 't4', teamName: 'Crease Lightning', isMine: false }),
    ],
    league: { id: 'harness-league', rostersResolved: true },
    truncated: false,
    generatedAt: new Date().toISOString(),
  };
};
(WaiverService as any).getTeamWaiverClaims = async () => CLAIMS;
(WaiverService as any).getWaiverPriority = async () => PRIORITY;
(WaiverService as any).getAvailablePlayers = async () =>
  PLAYERS.slice(18).map((p: any) => ({
    player_id: Number(p.id),
    full_name: p.full_name,
    position_code: p.position,
    team_abbrev: p.team,
    jersey_number: p.jersey_number,
    games_played: p.games_played,
    points: p.points,
  }));
(WaiverService as any).getLeagueWaiverSettings = async () => ({
  waiver_type: 'rolling', waiver_period_hours: 48, process_time: '02:00',
  game_lock_enabled: false, faab_budget: 100,
});
(WaiverService as any).getFAABBudget = async () => 63;
(WaiverService as any).cancelWaiverClaim = async () => ({ error: null });
(WaiverService as any).addPlayer = async () => ({ error: null });
(WaiverService as any).submitFAABBid = async () => ({ error: null });
(waiverApi as any).initializePriority = async () => ({ data: PRIORITY });
(waiverApi as any).getClaims = async () => ({ data: CLAIMS });
(waiverApi as any).getPriority = async () => ({ data: PRIORITY });
(waiverApi as any).getSettings = async () => ({ data: { waiver_type: 'rolling', process_day: 3, process_hour: 3 } });
(waiverApi as any).getPlayersOnWaivers = async () => ({ data: [] });
(leagueApi as any).getMyTeam = async () => ({ data: { id: 't1', name: 'Harness Team', waiver_priority: 3, faab_budget: 100 } });
(leagueApi as any).getTeams = async () => ({ data: PRIORITY.map((p, i) => ({ id: p.team_id, name: p.team_name, team_name: p.team_name, owner_id: i === 0 ? 'harness-user' : i < 6 ? `owner-${i + 1}` : null })) });
(leagueApi as any).getLeague = async () => ({ data: { id: 'harness-league', name: 'Harness League', settings: {}, scoring_settings: HARNESS_SCORING, team_count: 10, waiver_type: 'rolling', draft_status: 'completed', commissioner_id: 'harness-user', created_at: '2026-09-01T18:00:00.000Z', join_code: 'HARNESS' } });
/**
 * LEAGUE HQ (2026-09-04): the week's scoreboard and the transaction ledger,
 * which the Press Box HQ reads and the old one never did. Five matchups for
 * ten teams, the second team's the caller's; three ledger rows inside the
 * last seven days and one older, so `n this week` has something to count.
 */
const HARNESS_NOW = Date.now();
(matchupApi as any).getLeagueMatchups = async (_leagueId: string, week?: number) => ({
  data: Array.from({ length: 5 }, (_, i) => {
    const a = PRIORITY[i * 2], b = PRIORITY[i * 2 + 1];
    return {
      id: `m${i + 1}`, league_id: 'harness-league', week_number: week ?? 1,
      team1_id: a.team_id, team2_id: b.team_id,
      team1: { id: a.team_id, team_name: a.team_name }, team2: { id: b.team_id, team_name: b.team_name },
      team1_score: [118.4, 104.7, 71.3, 96.2, 88.0][i], team2_score: [96.1, 103.9, 127.5, 90.4, 91.7][i],
      team1_projected_total: 140, team2_projected_total: 120,
      status: 'in_progress', week_start_date: '2026-09-27', week_end_date: '2026-10-03',
    };
  }),
});
(leagueApi as any).getTransactions = async () => ({
  data: [1, 2, 3, 12].map((daysAgo, i) => ({
    id: `tx${i}`, type: i % 2 ? 'drop' : 'add', player_name: PLAYERS[20 + i].full_name,
    team_name: PRIORITY[i].team_name, created_at: new Date(HARNESS_NOW - daysAgo * 86_400_000).toISOString(), status: 'processed',
  })),
});
(rosterApi as any).getTeamRoster = async () => ({ data: MY_ROSTER.map((p: any) => ({ player_id: p.id })) });
/**
 * The trade center (2026-09-04): every team's roster, so a partner has a
 * roster to pick from — t1 is MY_ROSTER, the other nine take the rest of
 * the directory in turn — and a wire of trade offers in every state the
 * OFFERS tab draws: one waiting on you, one you sent, two settled.
 */
(rosterApi as any).getLeagueRosters = async () => ({
  data: PRIORITY.flatMap((t, ti) =>
    (ti === 0 ? MY_ROSTER : PLAYERS.slice(18 + (ti - 1) * 4, 18 + ti * 4)).map((p: any) => ({ team_id: t.team_id, player_id: Number(p.id) })),
  ),
});
(tradeApi as any).getLeagueTrades = async (_leagueId: string, status?: string) => {
  const summary = (p: any) => ({ player_id: Number(p.id), full_name: p.full_name, position_code: p.position, team_abbrev: p.team });
  const offer = (id: string, from: number, to: number, status: string, give: any[], get: any[], over: Record<string, unknown> = {}) => ({
    id, league_id: 'harness-league', from_team_id: PRIORITY[from].team_id, to_team_id: PRIORITY[to].team_id,
    from_team_name: PRIORITY[from].team_name, to_team_name: PRIORITY[to].team_name,
    offered_player_ids: give.map((p) => Number(p.id)), requested_player_ids: get.map((p) => Number(p.id)),
    offered_players: give.map(summary), requested_players: get.map(summary),
    status, message: null, created_at: new Date(HARNESS_NOW - 3_600_000).toISOString(), expires_at: null, processed_at: null,
    counter_offer_id: null, review_type: 'none', review_started_at: null, review_ends_at: null, vetoed_at: null, ...over,
  });
  const all = [
    offer('tr-1', 2, 0, 'pending', [PLAYERS[22]], [MY_ROSTER[3]], { message: 'Need a winger, you need D. Fair?' }),
    offer('tr-2', 0, 4, 'pending', [MY_ROSTER[7]], [PLAYERS[30]]),
    offer('tr-3', 0, 3, 'accepted', [MY_ROSTER[10]], [PLAYERS[27]]),
    offer('tr-4', 5, 0, 'rejected', [PLAYERS[34]], [MY_ROSTER[1]]),
  ];
  return { data: status ? all.filter((o) => o.status === status) : all, error: null };
};
(rosterApi as any).getPlayerIds = async () => ({ data: MY_ROSTER.map((p: any) => Number(p.id)) });
/**
 * A REAL SCHEDULE, not an empty Map (2026-09-04).
 *
 * These two used to return `new Map()`, and the cost only became visible when
 * the roster page was added to this harness: with no games, every player has
 * no `nextGame`, which kills the game line, the stat line, the actual and the
 * projection in one stroke. FOUR of the roster row's five information layers,
 * gone -- so the screen under review was a row starved of everything it
 * exists to show, and it read as a design regression when it was a fixture.
 *
 * A page harness whose stubs return nothing cannot answer "does this screen
 * work", only "does it mount". So: one fixture per team on yesterday, today
 * and tomorrow, cycling scheduled / live / final so all three row states are
 * on screen at once. Identities are real (harness/players.ts); the fixtures
 * are generated, and say so here.
 */
const DAY = 86_400_000;
const isoDay = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const HARNESS_DATES = [isoDay(-1), isoDay(0), isoDay(1)];
const TEAMS = [...new Set(HARNESS_PLAYERS.map((p) => p.team))];
/** Every team gets an opponent that is not itself, stable across renders. */
const OPPONENT = (team: string, i: number) => TEAMS[(TEAMS.indexOf(team) + 1 + i) % TEAMS.length];

const HARNESS_GAMES = new Map<string, any[]>(
  TEAMS.map((team, ti) => [
    team,
    HARNESS_DATES.map((date, di) => {
      const phase = (ti + di) % 3; // 0 scheduled, 1 live, 2 final
      const home = phase !== 1;
      const opponent = OPPONENT(team, di);
      return {
        id: `${team}-${date}`,
        game_id: 2026020000 + ti * 10 + di,
        game_date: date,
        // getGameInfo parses this with `new Date()`, so it must be a timestamp.
        game_time: `${date}T${['23:00', '01:00', '02:30'][di]}:00.000Z`,
        home_team: home ? team : opponent,
        away_team: home ? opponent : team,
        home_score: phase === 0 ? 0 : phase === 1 ? 2 : 4,
        away_score: phase === 0 ? 0 : phase === 1 ? 1 : 2,
        status: (['scheduled', 'live', 'final'] as const)[phase],
        period: phase === 1 ? '2nd' : null,
        period_time: phase === 1 ? '08:14' : null,
        venue: null,
        season: 20262027,
        game_type: 'regular' as const,
      };
    }),
  ]),
);

(ScheduleService as any).getGamesForTeams = async (teams: string[] = []) => ({
  gamesByTeam: new Map(teams.map((t) => [t.toUpperCase(), HARNESS_GAMES.get(t.toUpperCase()) ?? []])),
  error: null,
});
(ScheduleService as any).getNextGamesForTeams = async (teams: string[] = []) =>
  new Map(teams.map((t) => [t.toUpperCase(), (HARNESS_GAMES.get(t.toUpperCase()) ?? [])[1] ?? null]));

/**
 * The player card's GAME LOG pane (2026-09-04). It reads the schedule one
 * team at a time (`getGamesForTeam`, singular; the roster uses the plural
 * stubbed above) and then makes one request for the player's stats and
 * projections across that window. Neither had a stub, so the pane sat on
 * "Loading game log..." forever and its Press Box restyle could not be seen
 * here. Eight generated games inside whatever window the card asks for --
 * every one of them PLAYED when the window is behind us (last season's
 * picker: actual lines) and every one still AHEAD when it is in front of us
 * (this season's picker: projections), so each picker shows the row state
 * a manager would really see on that day. Identities are real; the figures
 * are generated from the player id and say so here.
 */
(ScheduleService as any).getGamesForTeam = async (team: string, start: string, end: string) => {
  const t = team.toUpperCase();
  const todayIso = isoDay(0);
  const anchor = new Date(`${start > todayIso ? start : end < todayIso ? end : todayIso}T12:00:00Z`).getTime();
  const offsets = start > todayIso ? [0, 2, 3, 5, 7, 9, 11, 13] : end < todayIso ? [-15, -13, -11, -9, -7, -5, -2, 0] : [-6, -4, -2, 0, 1, 3, 5, 7];
  const games = offsets
    .map((off, i) => {
      const date = new Date(anchor + off * DAY).toISOString().slice(0, 10);
      const home = i % 2 === 0;
      const opponent = OPPONENT(t, i);
      const played = date < todayIso;
      return {
        id: `${t}-log-${date}`,
        game_id: 2026030000 + i,
        game_date: date,
        game_time: `${date}T01:00:00.000Z`,
        home_team: home ? t : opponent,
        away_team: home ? opponent : t,
        home_score: played ? 3 : 0,
        away_score: played ? 2 : 0,
        status: played ? 'final' : 'scheduled',
        period: null,
        period_time: null,
        venue: null,
        season: 20262027,
        game_type: 'regular' as const,
      };
    })
    .filter((g) => g.game_date >= start && g.game_date <= end);
  return { games, error: null };
};
/**
 * The commissioner's SCORING section (2026-09-04). The catalog is the real
 * one's shape — stat_catalog joined to the league's rules — with the core
 * twelve at their default multipliers and two of the newer stats, so the
 * screen shows a `New this season` row and an `Off` row. Generated; says so.
 */
(LeagueSettingsService as any).getScoringRules = async () => ({
  error: null,
  stats: [
    ['goals', 'Goals', 'skater', 3, true],
    ['assists', 'Assists', 'skater', 2, true],
    ['shots_on_goal', 'Shots on goal', 'skater', 0.5, true],
    ['plus_minus', 'Plus / minus', 'skater', 0.5, true],
    ['ppp', 'Power-play points', 'skater', 0.5, true],
    ['shp', 'Short-handed points', 'skater', 1, true],
    ['hits', 'Hits', 'skater', 0.25, true],
    ['blocks', 'Blocked shots', 'skater', 0.5, true],
    ['pim', 'Penalty minutes', 'skater', 0, true],
    ['gwg', 'Game-winning goals', 'skater', 1, false],
    ['faceoff_wins', 'Faceoff wins', 'skater', 0, false],
    ['wins', 'Wins', 'goalie', 4, true],
    ['saves', 'Saves', 'goalie', 0.2, true],
    ['goals_against', 'Goals against', 'goalie', -1, true],
    ['shutouts', 'Shutouts', 'goalie', 3, true],
    ['ot_losses', 'Overtime losses', 'goalie', 1, false],
  ].map(([stat_key, display_name, applies_to, multiplier, is_core], i) => ({
    stat_key,
    display_name,
    applies_to,
    default_multiplier: multiplier,
    is_core,
    sort_order: i,
    multiplier,
  })),
});
(LeagueSettingsService as any).updateScoringRules = async () => ({ success: true, error: null });

/**
 * The Schedule screen (2026-09-04): a seven-day slate, three games a day
 * with a heavier Saturday and one club on a back-to-back, from the same
 * team list the roster uses.
 */
(scheduleApi as any).getGames = async () => {
  const games: any[] = [];
  let n = 0;
  for (let off = 0; off < 7; off++) {
    const date = isoDay(off);
    const perDay = off === 6 ? 6 : off === 2 ? 1 : 3;
    for (let g = 0; g < perDay; g++) {
      const home = TEAMS[(n * 2) % TEAMS.length];
      const away = TEAMS[(n * 2 + 1) % TEAMS.length];
      games.push({ id: `sched-${n}`, game_date: date, game_time: `${date}T${g === 0 ? '23:00' : '01:30'}:00.000Z`, home_team: home, away_team: away, status: 'scheduled' });
      n += 1;
    }
  }
  // One back-to-back on purpose: the first club plays day 3 and day 4.
  games.push({ id: 'sched-b2b', game_date: isoDay(3), game_time: `${isoDay(3)}T02:00:00.000Z`, home_team: TEAMS[0], away_team: TEAMS[5], status: 'scheduled' });
  games.push({ id: 'sched-b2b2', game_date: isoDay(4), game_time: `${isoDay(4)}T02:00:00.000Z`, home_team: TEAMS[7], away_team: TEAMS[0], status: 'scheduled' });
  games.sort((a, b) => a.game_date.localeCompare(b.game_date));
  return { data: games, error: null };
};
(rosterApi as any).getLineup = async () => ({ data: null });
/**
 * Another manager's team (2026-09-04): the page reads the roster through
 * MatchupService.getTeamRoster and the day's games through the batch
 * reads. Team 2 holds the next eighteen names in the directory.
 */
(MatchupService as any).getTeamRoster = async () =>
  PLAYERS.slice(18, 36).map((p: any) => ({
    id: p.id, name: p.full_name, position: p.position, number: Number(p.jersey_number || 0), starter: false,
    stats: { gamesPlayed: p.games_played || 0, goals: p.goals || 0, assists: p.assists || 0, points: p.points || 0, plusMinus: p.plus_minus || 0, shots: p.shots || 0 },
    team: p.team, teamAbbreviation: p.team, image: p.headshot_url || undefined, status: null,
  }));
(ScheduleService as any).hasGamesTodayBatch = async (teams: string[] = []) =>
  new Map(teams.map((t) => [t.toUpperCase(), (HARNESS_GAMES.get(t.toUpperCase()) ?? []).some((g: any) => g.game_date === isoDay(0))]));
(matchupApi as any).getPlayerGameLog = async (playerId: number, start: string, end: string) => {
  const p = PLAYERS.find((x: any) => String(x.id) === String(playerId)) as any;
  const goalie = p?.position === 'G';
  const { games } = await (ScheduleService as any).getGamesForTeam(String(p?.team_abbreviation ?? p?.team ?? ''), start, end);
  const todayIso = isoDay(0);
  const seed = Number(playerId) % 7;
  return {
    data: {
      games: games
        .filter((g: any) => g.game_date < todayIso)
        .map((g: any, i: number) =>
          goalie
            ? { game_date: g.game_date, wins: (i + seed) % 3 ? 1 : 0, saves: 24 + ((i + seed) % 5) * 3, goals_against: (i + seed) % 4, shutouts: (i + seed) % 5 === 0 ? 1 : 0, toi_seconds: 3540 }
            : { game_date: g.game_date, goals: (i + seed) % 3 ? 1 : 0, assists: (i + seed) % 2, shots_on_goal: 2 + ((i + seed) % 4), blocks: (i + seed) % 2, ppp: (i + seed) % 3 === 0 ? 1 : 0, shp: 0, hits: (i + seed) % 3, pim: (i + seed) % 4 === 0 ? 2 : 0, plus_minus: ((i + seed) % 3) - 1, toi_seconds: 1080 + ((i + seed) % 5) * 90 },
        ),
      projections: games
        .filter((g: any) => g.game_date >= todayIso)
        .map((g: any, i: number) => {
          const total = Number((goalie ? 8.5 : 3.2) + (((i + seed) % 5) / 5) * 4).toFixed(1);
          return goalie
            ? { projection_date: g.game_date, total_projected_points: total, projected_wins: 0.55, projected_saves: 27, projected_shutouts: 0.08, projected_goals_against: 2.4, projected_gaa: 2.4, projected_save_pct: 0.912, dynamic_confidence: 0.6, likely_low: Number(total) - 3, likely_high: Number(total) + 4 }
            : { projection_date: g.game_date, total_projected_points: total, projected_goals: 0.42, projected_assists: 0.61, projected_sog: 3.4, projected_blocks: 0.6, projected_ppp: 0.31, projected_shp: 0.02, projected_hits: 1.1, projected_pim: 0.4, dynamic_confidence: 0.62, likely_low: Number(total) - 2, likely_high: Number(total) + 3 };
        }),
    },
  };
};

/**
 * A projection for every player, derived from his own fixture line so the
 * numbers differ row to row rather than repeating one value down the column
 * -- a column of identical figures hides exactly the bug a projection column
 * exists to surface.
 */
(MatchupService as any).getDailyProjectionsForMatchup = async (ids: (string | number)[] = []) =>
  new Map(
    ids.map((id) => {
      const p = PLAYERS.find((x: any) => String(x.id) === String(id)) as any;
      const base = p?.position === 'G' ? 9 : 3;
      const spread = ((Number(id) % 17) / 17) * 6;
      return [Number(id), { total_projected_points: Number((base + spread).toFixed(1)), is_goalie: p?.position === 'G' }];
    }),
  );

/** Actual stats for the games the fixture above marks live or final. */
(matchupApi as any).getDailyGameStats = async (ids: (string | number)[] = [], date: string) => ({
  data: ids
    .map((id) => {
      const p = PLAYERS.find((x: any) => String(x.id) === String(id)) as any;
      const games = HARNESS_GAMES.get(String(p?.team_abbreviation ?? p?.team ?? '').toUpperCase()) ?? [];
      const game = games.find((g: any) => g.game_date === date);
      if (!game || game.status === 'scheduled') return null;
      const n = Number(id) % 5;
      const isGoalie = p?.position === 'G';
      const stats = isGoalie
        ? { saves: 24 + n * 3, goals_against: n % 3, wins: n % 2, shutouts: 0 }
        : {
            goals: n === 0 ? 1 : 0,
            assists: n === 1 ? 2 : n === 3 ? 1 : 0,
            shots_on_goal: 1 + (n % 4),
            hits: n === 2 ? 3 : 0,
            blocked_shots: n === 4 ? 2 : 0,
            powerPlayPoints: 0,
          };
      return {
        player_id: Number(id),
        game_date: date,
        ...stats,
        points: (stats as any).goals ?? 0 + ((stats as any).assists ?? 0),
        total_points: Number(HARNESS_SCORER.calculatePoints(stats as any, isGoalie).toFixed(1)),
      };
    })
    .filter(Boolean),
});
(PlayerService as any).getTrendingPlayers = async () => new Map();
(PlayerService as any).getRosterAssignmentCount = async () => new Map();
(PlayerService as any).recordPlayerTransaction = async () => ({ error: null });
// TeamAnalytics gates its projected-vs-actual fetch on resolving the user's
// team first, so without this the page's headline section silently never
// renders — which is exactly how it looked in the 2026-08-27 sweep.
(LeagueService as any).getUserTeam = async () => ({ team: { id: 't1' }, error: null });

/**
 * The projected-vs-actual rank list. Six real players, positions preserved
 * from the case that chose them (a C and a D who beat the model, two LWs who
 * split, a G and a D who missed). `harnessPlayer` throws rather than render a
 * blank name if one is ever renamed out of the roster.
 */
const ANALYTICS_ROWS = (
  [
    ['Connor McDavid', 128.4, 141.2, 22],
    ['Cale Makar', 96.1, 112.8, 21],
    ['Kirill Kaprizov', 74.5, 82.0, 20],
    ['Jason Robertson', 81.0, 62.3, 22],
    // Was Igor Shesterkin, who is not on the harness roster; Vasilevskiy is
    // the goalie the roster has. The row's job -- a G the model over-projected
    // -- is unchanged.
    ['Andrei Vasilevskiy', 88.0, 61.5, 18],
    ['Quinn Hughes', 70.2, 48.9, 19],
  ] as const
).map(([who, projectedPoints, actualPoints, games], i) => {
  const p = harnessPlayer(who);
  return { id: i + 1, name: p.name, position: p.position, projectedPoints, actualPoints, games };
});

// Stubbed on leagueApi rather than on the apiClient stub: src/api/leagues.ts
// imports './client' RELATIVELY, so the @/api/client alias in the harness vite
// config never applies to it and a stub there sends a real HTTP request.
//
// Numbers exercise the honest cases — a category the model under-projects
// (hits), one it over-projects (goals), and a roster where ratio and delta
// disagree about who is carrying the team.
(leagueApi as any).getTeamAnalytics = async () => ({
  data: {
    totals: {
      goals:   { projected: 42.0, actual: 40.1 },
      assists: { projected: 61.0, actual: 55.2 },
      ppp:     { projected: 18.0, actual: 21.4 },
      shots:   { projected: 305.0, actual: 291.0 },
      blocks:  { projected: 96.0, actual: 74.5 },
      hits:    { projected: 88.0, actual: 151.2 },
    },
    // Names off the shared roster (harness/players.ts), so the rank list and
    // the rows above it are the same people. The numbers are unchanged -- they
    // are the case, the names are not.
    players: ANALYTICS_ROWS,
    measuredPlayers: 6,
    rosterSize: 8,
  },
});
(LeagueService as any).getWatchlist = () => [];  // sync in the real service
(LeagueService as any).addToWatchlist = async () => ({ error: null });
(LeagueService as any).removeFromWatchlist = async () => ({ error: null });
(leagueApi as any).getUserLeagues = async () => ({ data: [{ id: 'harness-league', name: 'Harness League' }] });

/**
 * The account screen (2026-09-04, PR10p): a profile, a season of results and
 * a consent record, so the phone's rows have something true to show.
 * `api/account.ts` imports its client by relative path, so the apiClient
 * alias does not reach it; the module object is patched like the others.
 */
(accountApi as any).getProfile = async () => ({
  data: {
    // `?fresh=1`: the auto-generated username a new email signup carries,
    // which is what keeps ProfileSetup on screen.
    id: 'harness-user', username: new URLSearchParams(location.search).get('fresh') === '1' ? 'user_9f3a' : 'gstorms', display_name: 'Garrett', first_name: 'Garrett', last_name: 'Storms',
    phone: '', location: 'Kelowna, BC', bio: 'Commissioner. Oilers fan. Never trades a goalie.', default_team_name: 'Finalsz',
    timezone: 'America/Vancouver', avatar_url: null, push_notifications: true, created_at: '2025-08-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z',
  },
});
(accountApi as any).getStats = async () => ({ data: { totalSeasons: 2, wins: 21, losses: 13, ties: 2, totalPoints: 3412.6 } });
(accountApi as any).getConsentStatus = async () => ({
  data: [
    { policy_type: 'privacy_policy', status: 'current', required_version: '2026-08', consented_version: '2026-08', consented_at: '2026-08-14T00:00:00.000Z', withdrawn_at: null },
    { policy_type: 'terms_of_service', status: 'outdated', required_version: '2026-09', consented_version: '2026-06', consented_at: '2026-06-02T00:00:00.000Z', withdrawn_at: null },
  ],
});
(accountApi as any).updateProfile = async (fields: Record<string, unknown>) => ({ data: fields });
/* eslint-enable @typescript-eslint/no-explicit-any */

const PAGES: Record<string, () => Promise<{ default: React.ComponentType }>> = {
  waivers: () => import('../src/pages/WaiverWire'),
  settings: () => import('../src/pages/Settings'),
  contact: () => import('../src/pages/Contact'),
  teamanalytics: () => import('../src/pages/TeamAnalytics'),
  profile: () => import('../src/pages/Profile'),
  freeagents: () => import('../src/pages/FreeAgents'),
  home: () => import('../src/pages/Index'),
  trade: () => import('../src/pages/TradeAnalyzer'),
  matchup: () => import('../src/pages/Matchup'),
  standings: () => import('../src/pages/Standings'),
  league: () => import('../src/pages/LeagueDashboard'),
  // Added 2026-09-04 with the Press Box conversion. The roster is the screen
  // that page owns, and until now the only way to look at it was
  // `cards.html` / `slot.html`, which mount the LIST rather than the page --
  // so nothing here could show the page's own chrome, its empty states, or
  // whether the list is wired to the page's handlers at all.
  roster: () => import('../src/pages/Roster'),
  // The app nav's other four tabs (2026-09-04), so the whole nav can be
  // walked here.
  scores: () => import('../src/pages/Scores'),
  players: () => import('../src/pages/Players'),
  news: () => import('../src/pages/News'),
  schedule: () => import('../src/pages/ScheduleManager'),
  team: () => import('../src/pages/OtherTeam'),
  gmoffice: () => import('../src/pages/GMOffice'),
  playoffs: () => import('../src/pages/PlayoffBracket'),
  stormy: () => import('../src/pages/StormyAssistant'),
  createleague: () => import('../src/pages/CreateLeague'),
  auth: () => import('../src/pages/Auth'),
  profilesetup: () => import('../src/pages/ProfileSetup'),
  verifyemail: () => import('../src/pages/VerifyEmail'),
  resetpassword: () => import('../src/pages/ResetPassword'),
  authcallback: () => import('../src/pages/AuthCallback'),
};

const which = new URLSearchParams(location.search).get('p') || 'waivers';
const Page = lazy(PAGES[which] ?? PAGES.waivers);

/**
 * Pages that read a route param. LeagueDashboard reads :leagueId and bails with
 * "Invalid league ID" without one, so under a bare router it rendered its error
 * state and could not be reviewed at all. MemoryRouter lets the harness enter at
 * a real path rather than at /harness/page.html.
 */
const ROUTE_PATHS: Record<string, { path: string; at: string }> = {
  league: { path: '/league/:leagueId', at: '/league/harness-league' },
  // Roster reads the league off the QUERY STRING, not a path param.
  roster: { path: '/roster', at: '/roster?league=harness-league' },
  // So does Free Agents — and the LeagueHeader's PLAYERS underline matches on
  // the pathname, so under the harness's own path it lit LEAGUE instead.
  freeagents: { path: '/free-agents', at: '/free-agents?league=harness-league' },
  home: { path: '/', at: '/' },
  scores: { path: '/scores', at: '/scores' },
  players: { path: '/players', at: '/players' },
  news: { path: '/news', at: '/news' },
  schedule: { path: '/schedule-manager', at: '/schedule-manager?league=harness-league' },
  team: { path: '/team/:teamId', at: '/team/t2?league=harness-league' },
  gmoffice: { path: '/gm-office', at: '/gm-office?league=harness-league' },
  trade: { path: '/trade-analyzer', at: '/trade-analyzer?league=harness-league' },
  waivers: { path: '/waiver-wire', at: '/waiver-wire?league=harness-league' },
  playoffs: { path: '/league/:leagueId/playoffs', at: '/league/harness-league/playoffs' },
  teamanalytics: { path: '/team-analytics', at: '/team-analytics?league=harness-league' },
  // The Stormy bar stands down on this route; the page's own composer takes its slot.
  stormy: { path: '/gm-office/stormy', at: '/gm-office/stormy?league=harness-league' },
  // `&type=playoff` for the playoff-pool funnel, `&tab=join` for the join pane.
  createleague: { path: '/create-league', at: `/create-league${location.search.replace(/^\?p=[^&]*/, '?_')}` },
  // `&tab=stats|achievements|settings` for the other panes.
  profile: { path: '/profile', at: `/profile${location.search.replace(/^\?p=[^&]*/, '?_')}` },
  // `&tab=signup` for the other pane. The stub's user is signed in, and the
  // page redirects a signed-in user away, so `&signedout=1` on the stub.
  auth: { path: '/auth', at: `/auth${location.search.replace(/^\?p=[^&]*/, '?_')}` },
  profilesetup: { path: '/profile-setup', at: '/profile-setup' },
  verifyemail: { path: '/verify-email', at: '/verify-email' },
  resetpassword: { path: '/reset-password', at: '/reset-password' },
  authcallback: { path: '/auth/callback', at: '/auth/callback' },
  // App.tsx routes this as `/matchup/:leagueId/:weekId?`, and the page pushes
  // the week into the URL as soon as it resolves one. Under the old
  // `/matchup/:leagueId?` the very first push ("/matchup/harness-league/1")
  // matched nothing and the harness rendered a blank page — the surface could
  // not be reviewed at all. Mirror the real route.
  matchup: { path: '/matchup/:leagueId/:weekId?', at: '/matchup/harness-league' },
};
const routed = ROUTE_PATHS[which];

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
  <MemoryRouter initialEntries={[routed?.at ?? '/']}>
    <Suspense fallback={<div style={{ padding: 24, color: '#fff' }}>loading…</div>}>
      {routed ? (
        <Routes>
          <Route path={routed.path} element={<Page />} />
        </Routes>
      ) : (
        <Page />
      )}
    </Suspense>
    <CitrusToaster />
    <StormyChatBubble />
    <MobileBottomNav />
  </MemoryRouter>
  </QueryClientProvider>,
);
