import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet, mockPost, mockPatch, mockDelete } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
  mockPatch: vi.fn(),
  mockDelete: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

vi.mock('@/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));

import { importApi } from '../imports';

const LEAGUE = 'league-1';

describe('importApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ data: {} });
    mockPost.mockResolvedValue({ data: {} });
    mockPatch.mockResolvedValue({ data: {} });
    mockDelete.mockResolvedValue({ data: {} });
  });

  it('ESPN discovery sends the pasted link and, only when given, the credentials', async () => {
    await importApi.discoverEspn('https://fantasy.espn.com/hockey/league?leagueId=777');
    expect(mockPost).toHaveBeenCalledWith('/api/imports/espn/discover', { league: 'https://fantasy.espn.com/hockey/league?leagueId=777', credentials: undefined });
    await importApi.discoverEspn('777', { espnS2: 'x'.repeat(30), swid: '{ABC}' });
    expect(mockPost).toHaveBeenLastCalledWith('/api/imports/espn/discover', { league: '777', credentials: { espnS2: 'x'.repeat(30), swid: '{ABC}' } });
  });

  it('starting an ESPN import posts to the league with the discovered season', async () => {
    await importApi.startEspn(LEAGUE, { externalLeagueId: '777', latestEspnSeason: 2026 });
    expect(mockPost).toHaveBeenCalledWith(`/api/leagues/${LEAGUE}/imports/espn`, { externalLeagueId: '777', latestEspnSeason: 2026 });
  });

  it('Yahoo connection lifecycle hits the four endpoints', async () => {
    await importApi.yahooConnectUrl();
    expect(mockGet).toHaveBeenCalledWith('/api/imports/yahoo/connect');
    await importApi.yahooCallback('code', 'state');
    expect(mockPost).toHaveBeenCalledWith('/api/imports/yahoo/callback', { code: 'code', state: 'state' });
    await importApi.yahooConnection();
    expect(mockGet).toHaveBeenCalledWith('/api/imports/yahoo/connection');
    await importApi.yahooDisconnect();
    expect(mockDelete).toHaveBeenCalledWith('/api/imports/yahoo/connection');
    await importApi.yahooLeagues();
    expect(mockGet).toHaveBeenLastCalledWith('/api/imports/yahoo/leagues', { timeoutMs: 30_000 });
    await importApi.startYahoo(LEAGUE, { leagueKey: '453.l.200' });
    expect(mockPost).toHaveBeenLastCalledWith(`/api/leagues/${LEAGUE}/imports/yahoo`, { leagueKey: '453.l.200' });
  });

  it('reads the job and the room', async () => {
    await importApi.getJob(LEAGUE, 'job-1');
    expect(mockGet).toHaveBeenCalledWith(`/api/leagues/${LEAGUE}/imports/job-1`);
    await importApi.getHistory(LEAGUE);
    expect(mockGet).toHaveBeenCalledWith(`/api/leagues/${LEAGUE}/history`);
    await importApi.listUnclaimed(LEAGUE);
    expect(mockGet).toHaveBeenCalledWith(`/api/leagues/${LEAGUE}/history/unclaimed`);
  });

  it('claiming sends the token only when there is one', async () => {
    await importApi.claim(LEAGUE, 'm-1');
    expect(mockPost).toHaveBeenCalledWith(`/api/leagues/${LEAGUE}/history/claim`, { memberId: 'm-1' });
    await importApi.claim(LEAGUE, 'm-1', 'tok');
    expect(mockPost).toHaveBeenLastCalledWith(`/api/leagues/${LEAGUE}/history/claim`, { memberId: 'm-1', claimToken: 'tok' });
  });

  it('commissioner tools', async () => {
    await importApi.recompute(LEAGUE);
    expect(mockPost).toHaveBeenCalledWith(`/api/leagues/${LEAGUE}/history/recompute`, {});
    await importApi.lock(LEAGUE);
    expect(mockPost).toHaveBeenCalledWith(`/api/leagues/${LEAGUE}/history/lock`, {});
    await importApi.mergeMembers(LEAGUE, 'a', 'b');
    expect(mockPost).toHaveBeenCalledWith(`/api/leagues/${LEAGUE}/history/members/merge`, { fromMemberId: 'a', intoMemberId: 'b' });
    await importApi.assignMember(LEAGUE, 'm', 'u');
    expect(mockPost).toHaveBeenCalledWith(`/api/leagues/${LEAGUE}/history/members/m/assign`, { userId: 'u' });
    await importApi.unclaimMember(LEAGUE, 'm');
    expect(mockPost).toHaveBeenCalledWith(`/api/leagues/${LEAGUE}/history/members/m/unclaim`, {});
    await importApi.decorateTrophy(LEAGUE, 't', { display_name: 'The Cup' });
    expect(mockPatch).toHaveBeenCalledWith(`/api/leagues/${LEAGUE}/history/trophies/t`, { display_name: 'The Cup' });
    await importApi.addTrophy(LEAGUE, { season: 2019, member_id: 'm', display_name: 'Lost the trophy in a lake' });
    expect(mockPost).toHaveBeenCalledWith(`/api/leagues/${LEAGUE}/history/trophies`, { season: 2019, member_id: 'm', display_name: 'Lost the trophy in a lake' });
    await importApi.resolvePlayer(LEAGUE, 'espn', '3895074', 8478402);
    expect(mockPost).toHaveBeenCalledWith(`/api/leagues/${LEAGUE}/history/players/espn/3895074`, { nhlPlayerId: 8478402 });
  });
});
