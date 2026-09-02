/** Stand-in for @/api/client. Routes the three GETs the draft room makes. */
import { TEAMS, MY_TEAM_ID, ROUNDS, TEAM_COUNT, DASHBOARD_INDEX } from './draftFixtures';
import { DASHBOARD_PLAYER_INDEX, playerDashboardFixture } from '../dashboardFixtures';

const LEAGUE = {
  id: 'harness-league',
  name: 'Harness Invitational',
  commissioner_id: 'harness-user',
  draft_rounds: ROUNDS,
  draft_status: 'in_progress',
  league_size: TEAM_COUNT,
  settings: {
    draftType: 'snake',
    rosterSlots: { C: 2, LW: 2, RW: 2, D: 4, G: 2, UTIL: 1, BENCH: 4, IR: 2 },
  },
  scoring_settings: null,
};

async function get<T>(path: string): Promise<{ data: T }> {
  // COMPONENT 6.5 — one player's dashboard. Registered BEFORE the
  // dashboard-index branch because `/api/players/8478402/dashboard` would
  // otherwise never be reached if the index regex ever loosened.
  const dash = path.match(/\/api\/players\/(\d+)\/dashboard/);
  if (dash) {
    const payload = playerDashboardFixture(Number(dash[1]));
    if (payload) return { data: payload as unknown as T };
    throw new ApiError(`No harness dashboard fixture for id ${dash[1]}`, 404);
  }

  // The advanced player card's payload. Served here so the draft room's
  // real PlayerStatsModal shows the real card; a stub that returned {} left
  // the card in its degraded (render-nothing) state and the integration
  // could not be reviewed at all.
  //
  // TWO SLICES, CONCATENATED. The draft-room rows are ids 8470000+i (they
  // have to match `draftFixtures.PLAYERS`, which the pool renders), and the
  // player-dashboard harness needs the REAL NHL ids so a screenshot shows a
  // real player's identity. The two id ranges do not overlap — the draft
  // slice tops out at 8470239 and the lowest real roster id is 8474590 — so
  // one array serves both and no lookup can resolve to the wrong player.
  if (/\/api\/players\/dashboard-index/.test(path)) {
    return { data: [...DASHBOARD_INDEX, ...DASHBOARD_PLAYER_INDEX] as unknown as T };
  }
  if (/\/my-team$/.test(path)) return { data: { id: MY_TEAM_ID } as T };
  if (/\/teams$/.test(path)) return { data: TEAMS as unknown as T };
  if (/\/api\/leagues\/[^/]+$/.test(path)) return { data: LEAGUE as unknown as T };
  return { data: {} as T };
}

async function post<T>(_path: string, _body?: unknown): Promise<{ data: T }> {
  return { data: {} as T };
}

export const API_BASE_URL = '';

export class ApiError extends Error {
  constructor(message: string, public status = 500, public body?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

export const apiClient = { get, post, put: post, patch: post, delete: get };
export default apiClient;
