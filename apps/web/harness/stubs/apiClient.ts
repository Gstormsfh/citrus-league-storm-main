/** Stand-in for @/api/client. Routes the three GETs the draft room makes. */
import { TEAMS, MY_TEAM_ID, ROUNDS, TEAM_COUNT } from './draftFixtures';

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
