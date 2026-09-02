/**
 * The real Scores page at a phone viewport, with `scoresApi` replaced by
 * fixtures. `?case=` picks which day the stub answers with.
 *
 *   ?case=slate    opening night, five games, all scheduled  (DEFAULT)
 *   ?case=empty    the offseason day the app actually opens on today
 *   ?case=live     a live / final / scheduled mix            (SYNTHETIC)
 *   ?case=mine     the slate with league roster context attached
 *
 * PROVENANCE, because this harness exists to look at real shapes:
 *
 *   `slate`, `empty` and `mine` are TRANSCRIBED FROM PRODUCTION. The games,
 *   the game ids, the puck-drop times, the player names, the projected point
 *   totals and the confidence labels were read out of the production database
 *   on 2026-09-02 and pasted here unchanged.
 *
 *   `live` is SYNTHETIC and labelled as such on screen. `nhl_games` has never
 *   held a live row: status is only ever 'final' or 'scheduled' across all
 *   2,738 rows. The live branch of the UI therefore cannot be exercised by
 *   real data, and this case exists to prove the clock, the intermission
 *   marker, the final-minute urgency treatment and Final/OT all render before
 *   the first live night rather than after it. Nothing in this case is a
 *   claim about a game that happened.
 */

import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, lazy } from 'react';
import '../src/index.css';
import { scoresApi } from '../src/api/scores';
import type {
  ScoreboardGame,
  ScoresDayResponse,
  ScoresGameDetailResponse,
  ScoresPlayerLine,
} from '@citrus/shared';

const which = new URLSearchParams(location.search).get('case') || 'slate';

// ── Real production rows, transcribed 2026-09-02 ────────────────────────

const TEAM_META: Record<string, { city: string; name: string; id: number }> = {
  FLA: { city: 'Florida', name: 'Panthers', id: 13 },
  CAR: { city: 'Carolina', name: 'Hurricanes', id: 12 },
  MTL: { city: 'Montreal', name: 'Canadiens', id: 8 },
  TOR: { city: 'Toronto', name: 'Maple Leafs', id: 10 },
  NYR: { city: 'New York', name: 'Rangers', id: 3 },
  BOS: { city: 'Boston', name: 'Bruins', id: 6 },
  VAN: { city: 'Vancouver', name: 'Canucks', id: 23 },
  EDM: { city: 'Edmonton', name: 'Oilers', id: 22 },
  CHI: { city: 'Chicago', name: 'Blackhawks', id: 16 },
  VGK: { city: 'Vegas', name: 'Golden Knights', id: 54 },
};

const side = (abbrev: string) => ({
  abbrev,
  teamId: TEAM_META[abbrev]?.id ?? null,
  city: TEAM_META[abbrev]?.city ?? null,
  name: TEAM_META[abbrev]?.name ?? null,
});

const player = (
  playerId: number,
  name: string,
  teamAbbrev: string,
  position: string,
  projectedPoints: number,
  confidenceLabel: string,
  over: Partial<ScoresPlayerLine> = {},
): ScoresPlayerLine => ({
  playerId,
  name,
  teamAbbrev,
  position,
  isGoalie: position === 'G',
  headshotUrl: null,
  projectedPoints,
  confidenceLabel,
  actualPoints: null,
  actuals: null,
  roster: null,
  ...over,
});

// Read straight out of player_projected_stats for game_id 2026020001.
const CAR_FLA_FIELD: ScoresPlayerLine[] = [
  player(8483548, 'Brandon Bussi', 'CAR', 'G', 9.749, 'High'),
  player(8481611, 'Pyotr Kochetkov', 'CAR', 'G', 9.632, 'High'),
  player(8480801, 'Brady Tkachuk', 'FLA', 'LW', 8.889, 'High'),
  player(8479314, 'Matthew Tkachuk', 'FLA', 'LW', 8.692, 'High'),
  player(8482093, 'Seth Jarvis', 'CAR', 'RW', 8.569, 'High'),
  player(8478427, 'Sebastian Aho', 'CAR', 'C', 8.145, 'High'),
  player(8474593, 'Jacob Markstrom', 'FLA', 'G', 8.141, 'High'),
  player(8477933, 'Sam Reinhart', 'FLA', 'C', 7.978, 'High'),
];

const game = (
  gameId: number,
  away: string,
  home: string,
  startsAt: string,
  field: ScoresPlayerLine[],
  over: Partial<ScoreboardGame> = {},
): ScoreboardGame => {
  const shown = field.slice(0, 3);
  return {
    gameId,
    gameDate: '2026-09-29',
    startsAt,
    state: 'scheduled',
    statusRaw: 'scheduled',
    period: null,
    periodTime: null,
    // NULL on every 2026 row in production. Kept null here on purpose.
    venue: null,
    gameType: 'regular',
    season: 2026,
    away: side(away),
    home: side(home),
    // Production stores 0/0 on a scheduled row; the server nulls them, and so
    // does this fixture. A scheduled row must never carry a score.
    awayScore: null,
    homeScore: null,
    citrus: field.length
      ? {
          projectedPlayers: field.length,
          players: shown,
          rosteredCount: null,
          myCount: null,
          confidence: { high: field.length, medium: 0, low: 0, unlabeled: 0 },
          hasActuals: false,
        }
      : null,
    ...over,
  };
};

const OPENING_NIGHT: ScoreboardGame[] = [
  game(2026020001, 'FLA', 'CAR', '2026-09-29T21:00:00+00:00', CAR_FLA_FIELD),
  game(2026020002, 'MTL', 'TOR', '2026-09-29T23:00:00+00:00', CAR_FLA_FIELD.slice(2, 8)),
  game(2026020003, 'NYR', 'BOS', '2026-09-30T00:00:00+00:00', CAR_FLA_FIELD.slice(1, 7)),
  game(2026020004, 'VAN', 'EDM', '2026-09-30T02:00:00+00:00', CAR_FLA_FIELD.slice(3, 8)),
  // The honest zero case: a game we hold no projection for at all.
  game(2026020005, 'CHI', 'VGK', '2026-09-30T02:30:00+00:00', []),
];

/** SYNTHETIC. No live row has ever existed in `nhl_games`. */
const LIVE_MIX: ScoreboardGame[] = [
  {
    ...OPENING_NIGHT[0],
    state: 'live',
    statusRaw: 'live',
    period: '3rd',
    periodTime: '00:42',
    awayScore: 2,
    homeScore: 3,
  },
  {
    ...OPENING_NIGHT[1],
    state: 'live',
    statusRaw: 'live',
    period: '2nd',
    periodTime: 'INT',
    awayScore: 1,
    homeScore: 1,
  },
  {
    ...OPENING_NIGHT[2],
    state: 'live',
    statusRaw: 'live',
    period: '1st',
    periodTime: '11:07',
    awayScore: 0,
    homeScore: 0,
  },
  {
    ...OPENING_NIGHT[3],
    state: 'final',
    statusRaw: 'final',
    period: 'OT',
    periodTime: null,
    awayScore: 4,
    homeScore: 5,
  },
  { ...OPENING_NIGHT[4], state: 'final', statusRaw: 'final', period: '3rd', awayScore: 2, homeScore: 1 },
];

/** The slate with league roster context, as `?leagueId=` would return it. */
const WITH_ROSTERS: ScoreboardGame[] = OPENING_NIGHT.map((g, i) => {
  if (!g.citrus) return g;
  const players = g.citrus.players.map((p, j) =>
    j === 0 && i < 3
      ? { ...p, roster: { teamId: 'tm-me', teamName: 'Zest Fleet', isMine: true } }
      : j === 1
        ? { ...p, roster: { teamId: 'tm-them', teamName: 'Rink Rats', isMine: false } }
        : p,
  );
  return {
    ...g,
    citrus: {
      ...g.citrus,
      players,
      rosteredCount: players.filter((p) => p.roster).length,
      myCount: players.filter((p) => p.roster?.isMine).length,
    },
  };
});

const CASES: Record<string, { date: string; games: ScoreboardGame[]; field: ScoresPlayerLine[] }> = {
  slate: { date: '2026-09-29', games: OPENING_NIGHT, field: CAR_FLA_FIELD },
  live: { date: '2026-09-29', games: LIVE_MIX, field: CAR_FLA_FIELD },
  mine: { date: '2026-09-29', games: WITH_ROSTERS, field: CAR_FLA_FIELD },
  empty: { date: '2026-09-02', games: [], field: [] },
};

const active = CASES[which] ?? CASES.slate;

(scoresApi as any).getDay = async (): Promise<ScoresDayResponse> => ({
  date: active.date,
  games: active.games,
  // Real: the last game before 2026-09-02 and the first one after it.
  nearestDateWithGames:
    active.games.length === 0
      ? { before: '2026-06-14', after: '2026-09-29' }
      : { before: null, after: null },
  league: { id: which === 'mine' ? 'harness-league' : null, rostersResolved: which === 'mine' },
  truncated: false,
  generatedAt: new Date(0).toISOString(),
});

(scoresApi as any).getGame = async (gameId: number): Promise<ScoresGameDetailResponse> => {
  const found = active.games.find((g) => g.gameId === gameId) ?? active.games[0];
  return {
    game: found,
    players: found?.citrus ? active.field : [],
    league: { id: which === 'mine' ? 'harness-league' : null, rostersResolved: which === 'mine' },
    truncated: false,
    generatedAt: new Date(0).toISOString(),
  };
};

(scoresApi as any).clearCache = () => {};

const Scores = lazy(() => import('../src/pages/Scores'));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <MemoryRouter initialEntries={['/scores']}>
      <div className="bg-pastel-orange text-pastel-surface font-jbmono text-[10px] px-3 py-1.5 text-center">
        harness fixtures, case={which}
        {which === 'live' ? ' (SYNTHETIC: no live row has ever existed in nhl_games)' : ''}
      </div>
      <Suspense fallback={<div style={{ padding: 24, color: '#fff' }}>loading…</div>}>
        <Scores />
      </Suspense>
    </MemoryRouter>
  </QueryClientProvider>,
);
