// DR-1 chunk (2026-07-28) — tests for the draft-order matrix fetcher.
//
// Covers the F1-ratified acceptance:
//   - Round 1 fetched first; teamCount derived from its .length;
//     totalRounds derived from totalPicks / teamCount.
//   - Rounds 2..R fetched in parallel via Promise.all (verified by
//     counting apiClient.get invocations).
//   - Flattened matrix is monotonically pickNumber-numbered.
//   - Both top-level and enveloped {data} shapes accepted (F3 hedge).
//   - Non-fatal failure: any fetch error → returns null (caller retries).
//   - Divergence detection: totalPicks not divisible by teamCount, or
//     a round's team count differs from round 1, both surface as
//     silent-null (non-fatal) — the caller renders the "fetch failed"
//     path and retries.
//   - Not-yet-configured league (totalPicks === 0) short-circuits null
//     without hitting the network.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiClientGetMock = vi.fn();
vi.mock('@/api/client', () => ({
  apiClient: { get: apiClientGetMock },
}));

import { fetchDraftOrderMatrix } from '../fetchDraftOrderMatrix';

const LEAGUE_ID = 'league-42';
const TEAM_IDS = Array.from({ length: 12 }, (_, i) => `team-${i + 1}`);

// The v1 route returns a row with a team_order JSONB array. Some
// callers accept it wrapped in an array (routes/draft.ts:99 delegates
// to DraftService.getDraftOrder which may return either shape); tests
// exercise both to lock in the hedge.
function roundResponseTopLevel(teamIds: string[]) {
  return { team_order: teamIds };
}
function roundResponseEnveloped(teamIds: string[]) {
  return { data: { team_order: teamIds } };
}
function roundResponseArrayWrapped(teamIds: string[]) {
  return [{ team_order: teamIds }];
}

beforeEach(() => {
  apiClientGetMock.mockReset();
});

describe('fetchDraftOrderMatrix — happy path', () => {
  it('fetches round 1 first, then rounds 2..R in parallel; returns flat monotonic matrix', async () => {
    // Round 1: forward. Round 2: reverse. Round 3: forward. Standard
    // snake — but the fetcher doesn't derive; it consumes what the
    // server returns per round. We use snake here to make the assert
    // easy to read; the fetcher would work identically for any custom
    // per-round ordering the commissioner set.
    apiClientGetMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/order/1')) return roundResponseTopLevel(TEAM_IDS);
      if (url.endsWith('/order/2'))
        return roundResponseTopLevel([...TEAM_IDS].reverse());
      if (url.endsWith('/order/3')) return roundResponseTopLevel(TEAM_IDS);
      throw new Error(`unexpected url ${url}`);
    });

    const matrix = await fetchDraftOrderMatrix(LEAGUE_ID, 36);
    expect(matrix).not.toBeNull();
    expect(matrix?.length).toBe(36);
    // Round 1 forward.
    expect(matrix?.[0]).toEqual({ round: 1, pickNumber: 1, teamId: 'team-1' });
    expect(matrix?.[11]).toEqual({ round: 1, pickNumber: 12, teamId: 'team-12' });
    // Round 2 reversed.
    expect(matrix?.[12]).toEqual({ round: 2, pickNumber: 13, teamId: 'team-12' });
    expect(matrix?.[23]).toEqual({ round: 2, pickNumber: 24, teamId: 'team-1' });
    // Round 3 forward.
    expect(matrix?.[24]).toEqual({ round: 3, pickNumber: 25, teamId: 'team-1' });
    expect(matrix?.[35]).toEqual({ round: 3, pickNumber: 36, teamId: 'team-12' });
    // pickNumber is 1-indexed and monotonically increasing.
    for (let i = 0; i < 36; i++) {
      expect(matrix?.[i].pickNumber).toBe(i + 1);
    }
  });

  it('accepts enveloped {data: {team_order}} shape (F3 hedge)', async () => {
    apiClientGetMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/order/1')) return roundResponseEnveloped(TEAM_IDS);
      if (url.endsWith('/order/2'))
        return roundResponseEnveloped([...TEAM_IDS].reverse());
      if (url.endsWith('/order/3')) return roundResponseEnveloped(TEAM_IDS);
      throw new Error(`unexpected url ${url}`);
    });
    const matrix = await fetchDraftOrderMatrix(LEAGUE_ID, 36);
    expect(matrix?.length).toBe(36);
  });

  it('accepts array-wrapped [{team_order}] shape (v1 route quirk)', async () => {
    apiClientGetMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/order/1')) return roundResponseArrayWrapped(TEAM_IDS);
      if (url.endsWith('/order/2'))
        return roundResponseArrayWrapped([...TEAM_IDS].reverse());
      if (url.endsWith('/order/3')) return roundResponseArrayWrapped(TEAM_IDS);
      throw new Error(`unexpected url ${url}`);
    });
    const matrix = await fetchDraftOrderMatrix(LEAGUE_ID, 36);
    expect(matrix?.length).toBe(36);
  });

  it('fetches rounds 2..R IN PARALLEL — verified by kicking off the round-1 promise', async () => {
    // Have the round-1 mock resolve immediately; then track that
    // rounds 2 and 3 are ALL invoked before either resolves.
    let round2Started = false;
    let round3Started = false;
    let round2Resolve!: (v: unknown) => void;
    let round3Resolve!: (v: unknown) => void;
    apiClientGetMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/order/1')) return roundResponseTopLevel(TEAM_IDS);
      if (url.endsWith('/order/2')) {
        round2Started = true;
        return new Promise((r) => (round2Resolve = r));
      }
      if (url.endsWith('/order/3')) {
        round3Started = true;
        return new Promise((r) => (round3Resolve = r));
      }
      throw new Error(`unexpected url ${url}`);
    });
    const promise = fetchDraftOrderMatrix(LEAGUE_ID, 36);
    // Yield to microtasks so round 1 resolves and rounds 2+3 kick off.
    await new Promise((r) => setTimeout(r, 0));
    expect(round2Started).toBe(true);
    expect(round3Started).toBe(true);
    // Now resolve them in reverse order — result should be correct.
    round3Resolve(roundResponseTopLevel(TEAM_IDS));
    round2Resolve(roundResponseTopLevel([...TEAM_IDS].reverse()));
    const matrix = await promise;
    expect(matrix?.length).toBe(36);
  });

  it('single-round draft (totalPicks === teamCount) works without fetching rounds 2+', async () => {
    apiClientGetMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/order/1')) return roundResponseTopLevel(TEAM_IDS);
      throw new Error(`unexpected url ${url}`);
    });
    const matrix = await fetchDraftOrderMatrix(LEAGUE_ID, 12);
    expect(matrix?.length).toBe(12);
    expect(apiClientGetMock).toHaveBeenCalledTimes(1);
  });
});

describe('fetchDraftOrderMatrix — non-fatal failure returns null', () => {
  it('returns null when round 1 errors', async () => {
    apiClientGetMock.mockResolvedValueOnce({ error: 'db_down' });
    const matrix = await fetchDraftOrderMatrix(LEAGUE_ID, 36);
    expect(matrix).toBeNull();
  });

  it('returns null when a later round errors', async () => {
    apiClientGetMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/order/1')) return roundResponseTopLevel(TEAM_IDS);
      if (url.endsWith('/order/2')) return { error: 'timeout' };
      if (url.endsWith('/order/3')) return roundResponseTopLevel(TEAM_IDS);
      throw new Error(`unexpected url ${url}`);
    });
    const matrix = await fetchDraftOrderMatrix(LEAGUE_ID, 36);
    expect(matrix).toBeNull();
  });

  it('returns null when the response is missing team_order', async () => {
    apiClientGetMock.mockResolvedValueOnce({ something_else: [] });
    const matrix = await fetchDraftOrderMatrix(LEAGUE_ID, 36);
    expect(matrix).toBeNull();
  });

  it('returns null when team_order is not an array', async () => {
    apiClientGetMock.mockResolvedValueOnce({ team_order: 'oops' });
    const matrix = await fetchDraftOrderMatrix(LEAGUE_ID, 36);
    expect(matrix).toBeNull();
  });

  it('returns null when team_order contains a non-string entry', async () => {
    apiClientGetMock.mockResolvedValueOnce({ team_order: ['team-1', 42] });
    const matrix = await fetchDraftOrderMatrix(LEAGUE_ID, 36);
    expect(matrix).toBeNull();
  });

  it('returns null when totalPicks is not divisible by round-1 teamCount', async () => {
    apiClientGetMock.mockResolvedValueOnce(roundResponseTopLevel(TEAM_IDS));
    // totalPicks=35 with teamCount=12 → not divisible → divergence.
    const matrix = await fetchDraftOrderMatrix(LEAGUE_ID, 35);
    expect(matrix).toBeNull();
  });

  it('returns null when a later round has a different team count', async () => {
    apiClientGetMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/order/1')) return roundResponseTopLevel(TEAM_IDS);
      // Round 2 has only 11 teams — mid-draft team-count change is
      // not supported; fetcher fails safe.
      if (url.endsWith('/order/2'))
        return roundResponseTopLevel(TEAM_IDS.slice(0, 11));
      if (url.endsWith('/order/3')) return roundResponseTopLevel(TEAM_IDS);
      throw new Error(`unexpected url ${url}`);
    });
    const matrix = await fetchDraftOrderMatrix(LEAGUE_ID, 36);
    expect(matrix).toBeNull();
  });
});

describe('fetchDraftOrderMatrix — not-yet-configured', () => {
  it('short-circuits null when totalPicks is 0 (never fetches)', async () => {
    const matrix = await fetchDraftOrderMatrix(LEAGUE_ID, 0);
    expect(matrix).toBeNull();
    expect(apiClientGetMock).not.toHaveBeenCalled();
  });
});
