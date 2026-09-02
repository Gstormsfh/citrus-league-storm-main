/** Renders one real page at a phone viewport. ?p=waivers|settings|contact */
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, lazy } from 'react';
import '../src/index.css';
import { Toaster } from '../src/components/ui/toaster';

// Every network call the pages make, stubbed at the module object.
import { WaiverService } from '../src/services/WaiverService';
import { PlayerService } from '../src/services/PlayerService';
import { LeagueService } from '../src/services/LeagueService';
import { ScheduleService } from '../src/services/ScheduleService';
import { leagueApi } from '../src/api/leagues';
import { rosterApi } from '../src/api/rosters';
import { waiverApi } from '../src/api/waivers';
import { HARNESS_PLAYERS, harnessDirectoryPlayer, harnessPlayer } from './players';

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
  league: { id: 'harness-league', name: 'Harness League', team_count: 10, settings: {}, scoring_settings: {}, waiver_type: 'rolling', draft_status: 'completed', commissioner_id: 'harness-user' },
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
(leagueApi as any).getLeague = async () => ({ data: { id: 'harness-league', name: 'Harness League', settings: {}, scoring_settings: {}, team_count: 10, waiver_type: 'rolling', draft_status: 'completed', commissioner_id: 'harness-user' } });
(rosterApi as any).getTeamRoster = async () => ({ data: MY_ROSTER.map((p: any) => ({ player_id: p.id })) });
(rosterApi as any).getPlayerIds = async () => ({ data: MY_ROSTER.map((p: any) => Number(p.id)) });
(ScheduleService as any).getGamesForTeams = async () => ({ gamesByTeam: new Map() });
(ScheduleService as any).getNextGamesForTeams = async () => new Map();
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
    <Toaster />
  </MemoryRouter>
  </QueryClientProvider>,
);
