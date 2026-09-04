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

// Every network call the pages make, stubbed at the module object.
import { WaiverService } from '../src/services/WaiverService';
import { PlayerService } from '../src/services/PlayerService';
import { LeagueService } from '../src/services/LeagueService';
import { ScheduleService } from '../src/services/ScheduleService';
import { MatchupService } from '../src/services/MatchupService';
import { matchupApi } from '../src/api/matchups';
import { leagueApi } from '../src/api/leagues';
import { rosterApi } from '../src/api/rosters';
import { waiverApi } from '../src/api/waivers';
import { ScoringCalculator, extractScoringSettings } from '../src/utils/scoringUtils';
import { HARNESS_PLAYERS, harnessDirectoryPlayer, harnessPlayer } from './players';

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
  league: { id: 'harness-league', name: 'Harness League', team_count: 10, settings: {}, scoring_settings: HARNESS_SCORING, waiver_type: 'rolling', draft_status: 'completed', commissioner_id: 'harness-user' },
  error: null,
});
(LeagueService as any).getUserLeagues = async () => ({
  leagues: [{ id: 'harness-league', name: 'Harness League', commissioner_id: 'harness-user', draft_status: 'completed' }],
  error: null,
});
(LeagueService as any).getLeagueTeamsWithOwners = async () => ({ teams: PRIORITY.map(p => ({ id: p.team_id, name: p.team_name })), error: null });
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
(leagueApi as any).getTeams = async () => ({ data: PRIORITY.map(p => ({ id: p.team_id, name: p.team_name, owner_id: 'harness-user' })) });
(leagueApi as any).getLeague = async () => ({ data: { id: 'harness-league', name: 'Harness League', settings: {}, scoring_settings: HARNESS_SCORING, team_count: 10, waiver_type: 'rolling', draft_status: 'completed', commissioner_id: 'harness-user' } });
(rosterApi as any).getTeamRoster = async () => ({ data: MY_ROSTER.map((p: any) => ({ player_id: p.id })) });
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
/* eslint-enable @typescript-eslint/no-explicit-any */

const PAGES: Record<string, () => Promise<{ default: React.ComponentType }>> = {
  waivers: () => import('../src/pages/WaiverWire'),
  settings: () => import('../src/pages/Settings'),
  contact: () => import('../src/pages/Contact'),
  teamanalytics: () => import('../src/pages/TeamAnalytics'),
  profile: () => import('../src/pages/Profile'),
  freeagents: () => import('../src/pages/FreeAgents'),
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
    <MobileBottomNav />
  </MemoryRouter>
  </QueryClientProvider>,
);
