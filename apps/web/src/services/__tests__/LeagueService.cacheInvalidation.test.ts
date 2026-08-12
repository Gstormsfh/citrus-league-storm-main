// ARCHITECT 2026-08-12 (LEAGUE-CACHE / inbox E126) — membership mutations
// must invalidate the league request cache.
//
// WHAT WENT WRONG. `getLeagueCachedOrFetch` memoises RESOLVED PROMISES for
// LEAGUE_CACHE_TTL (30s) under four keys, one of them 'userLeagues'. The
// module exported `clearLeagueCache()` with the doc comment "useful after
// mutations like joining/creating" — and a grep across apps/web found
// exactly one call site, inside its own unit test. Nothing in the running
// app ever invalidated it.
//
// The visible consequence is not hypothetical. `CreateLeague.handleJoinLeague`
// does `await refreshLeagues()` right after a successful join, and the
// comment above that line says it exists because "users reported joined but
// got dumped in a different league / GM Office". With a live cache entry —
// near-certain, since the list is fetched on mount seconds earlier — that
// refresh replayed the PRE-JOIN promise and the fix did nothing for up to
// 30 seconds. Eleven managers join by code within a few minutes of each
// other on draft night.
//
// The fix invalidates inside joinLeagueByCode and createLeague rather than
// at the call site, so every caller is correct by default. These tests lock
// that: the cache must still work (or it is not a cache), and a membership
// mutation must blow it away.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreateLeague = vi.fn();
const mockJoinLeague = vi.fn();
const mockGetUserLeagues = vi.fn();

vi.mock('@/api/leagues', () => ({
  leagueApi: {
    getLeague: vi.fn(),
    createLeague: (...a: unknown[]) => mockCreateLeague(...a),
    joinLeague: (...a: unknown[]) => mockJoinLeague(...a),
    getUserLeagues: (...a: unknown[]) => mockGetUserLeagues(...a),
    getTeams: vi.fn(),
    getMyTeam: vi.fn(),
    deleteTeam: vi.fn(),
    updateSettings: vi.fn(),
    updateScoringSettings: vi.fn(),
  },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), auth: { getSession: vi.fn() } },
}));

vi.mock('@/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { LeagueService } from '../LeagueService';

const OLD = [{ id: 'league-old', name: 'Old League' }];
const NEW = [{ id: 'league-old', name: 'Old League' }, { id: 'league-new', name: 'Just Joined' }];

beforeEach(() => {
  vi.clearAllMocks();
  LeagueService.clearLeagueCache();
});

describe('LeagueService — the cache is real (control)', () => {
  it('serves a second getUserLeagues from cache without re-hitting the API', async () => {
    // Without this passing, every test below would pass vacuously.
    mockGetUserLeagues.mockResolvedValue({ data: OLD });
    await LeagueService.getUserLeagues('u1');
    await LeagueService.getUserLeagues('u1');
    expect(mockGetUserLeagues).toHaveBeenCalledTimes(1);
  });
});

describe('LeagueService.joinLeagueByCode — invalidates on success', () => {
  it('the next getUserLeagues re-fetches and sees the newly joined league', async () => {
    mockGetUserLeagues.mockResolvedValueOnce({ data: OLD });
    const first = await LeagueService.getUserLeagues('u1');
    expect(first.leagues).toEqual(OLD);

    mockJoinLeague.mockResolvedValue({
      data: { league: { id: 'league-new' }, team: { id: 'team-9' } },
    });
    const join = await LeagueService.joinLeagueByCode('ABCD12', 'u1', 'My Team');
    expect(join.error).toBeNull();

    // This is the assertion the whole entry exists for.
    mockGetUserLeagues.mockResolvedValueOnce({ data: NEW });
    const second = await LeagueService.getUserLeagues('u1');
    expect(mockGetUserLeagues).toHaveBeenCalledTimes(2);
    expect(second.leagues).toEqual(NEW);
    expect(second.leagues.map((l: { id: string }) => l.id)).toContain('league-new');
  });

  it('does NOT invalidate when the join fails — a failed join changed nothing', async () => {
    mockGetUserLeagues.mockResolvedValue({ data: OLD });
    await LeagueService.getUserLeagues('u1');

    mockJoinLeague.mockRejectedValue(new Error('invalid code'));
    const join = await LeagueService.joinLeagueByCode('BADCODE', 'u1');
    expect(join.error).toBeTruthy();

    await LeagueService.getUserLeagues('u1');
    expect(mockGetUserLeagues).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty code before touching the API or the cache', async () => {
    mockGetUserLeagues.mockResolvedValue({ data: OLD });
    await LeagueService.getUserLeagues('u1');

    const join = await LeagueService.joinLeagueByCode('   ', 'u1');
    expect(join.error).toBeTruthy();
    expect(mockJoinLeague).not.toHaveBeenCalled();

    await LeagueService.getUserLeagues('u1');
    expect(mockGetUserLeagues).toHaveBeenCalledTimes(1);
  });
});

describe('LeagueService.createLeague — invalidates on success', () => {
  it('the next getUserLeagues re-fetches and sees the new league', async () => {
    mockGetUserLeagues.mockResolvedValueOnce({ data: OLD });
    await LeagueService.getUserLeagues('u1');

    mockCreateLeague.mockResolvedValue({
      data: { league: { id: 'league-made' }, team: { id: 'team-1' } },
    });
    const created = await LeagueService.createLeague('Blizzard Cup', 'u1');
    expect(created.error).toBeNull();

    mockGetUserLeagues.mockResolvedValueOnce({ data: NEW });
    await LeagueService.getUserLeagues('u1');
    expect(mockGetUserLeagues).toHaveBeenCalledTimes(2);
  });

  it('does NOT invalidate when creation fails', async () => {
    mockGetUserLeagues.mockResolvedValue({ data: OLD });
    await LeagueService.getUserLeagues('u1');

    mockCreateLeague.mockRejectedValue(new Error('boom'));
    const created = await LeagueService.createLeague('Nope', 'u1');
    expect(created.error).toBeTruthy();

    await LeagueService.getUserLeagues('u1');
    expect(mockGetUserLeagues).toHaveBeenCalledTimes(1);
  });
});
