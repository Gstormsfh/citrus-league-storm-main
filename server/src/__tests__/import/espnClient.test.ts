import { describe, it, expect, vi } from 'vitest';
import { EspnClient, ESPN_BASE, ESPN_VIEWS, type FetchLike } from '../../import/espn/client';
import { NeedsCredentialsError, SourceThrottledError } from '../../import/types';

type Route = { status: number; body?: unknown };

/** A fetch stub keyed by URL prefix; records every call so headers can be inspected. */
function fakeFetch(routes: Array<[match: (url: string) => boolean, route: Route]>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const hit = routes.find(([m]) => m(url));
    if (!hit) throw new Error(`no route for ${url}`);
    const { status, body } = hit[1];
    return {
      status,
      json: async () => body,
    } as unknown as Response;
  };
  return { impl, calls };
}

const SEASONS = (url: string) => url.startsWith(`${ESPN_BASE}/seasons/`);
const HISTORY = (url: string) => url.startsWith(`${ESPN_BASE}/leagueHistory/`);

describe('EspnClient URLs', () => {
  it('2018 and later come from the seasons path; earlier from leagueHistory', () => {
    expect(EspnClient.seasonUrl('12345', 2021, ['mSettings', 'mTeam'])).toBe(
      `${ESPN_BASE}/seasons/2021/segments/0/leagues/12345?view=mSettings&view=mTeam`,
    );
    expect(EspnClient.seasonUrl('12345', 2017, ['mTeam'])).toBe(`${ESPN_BASE}/leagueHistory/12345?seasonId=2017&view=mTeam`);
    expect(EspnClient.historyUrl('12345', 2018, ['mTeam'])).toBe(`${ESPN_BASE}/leagueHistory/12345?seasonId=2018&view=mTeam`);
  });

  it('encodes the league id and view names', () => {
    expect(EspnClient.seasonUrl('1 2', 2021, ['m Team'])).toContain('/leagues/1%202?view=m%20Team');
  });

  it('exposes the view sets the import job uses', () => {
    expect(ESPN_VIEWS.core).toEqual(['mSettings', 'mTeam']);
    expect(ESPN_VIEWS.schedule).toEqual(['mMatchupScore']);
    expect(ESPN_VIEWS.draft).toEqual(['mDraftDetail']);
  });
});

describe('EspnClient.fetchSeason', () => {
  it('public league: 200 on the seasons path, no cookie sent', async () => {
    const { impl, calls } = fakeFetch([[SEASONS, { status: 200, body: { id: 1, seasonId: 2021 } }]]);
    const res = await new EspnClient(impl).fetchSeason('1', 2021, ['mTeam']);
    expect(res).toEqual({ endpoint: EspnClient.seasonUrl('1', 2021, ['mTeam']), status: 200, body: { id: 1, seasonId: 2021 } });
    expect(calls).toHaveLength(1);
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Cookie).toBeUndefined();
    expect(headers.Accept).toBe('application/json');
  });

  it('leagueHistory answers with an array; the client unwraps the one season', async () => {
    const { impl } = fakeFetch([[HISTORY, { status: 200, body: [{ id: 1, seasonId: 2016 }] }]]);
    const res = await new EspnClient(impl).fetchSeason('1', 2016, ['mTeam']);
    expect(res.body).toEqual({ id: 1, seasonId: 2016 });
    expect(res.endpoint).toBe(EspnClient.historyUrl('1', 2016, ['mTeam']));
  });

  it('the 2018 quirk: 401 on the seasons path, retried on leagueHistory', async () => {
    const { impl, calls } = fakeFetch([
      [SEASONS, { status: 401 }],
      [HISTORY, { status: 200, body: [{ id: 1, seasonId: 2018 }] }],
    ]);
    const res = await new EspnClient(impl).fetchSeason('1', 2018, ['mTeam']);
    expect(res.body).toEqual({ id: 1, seasonId: 2018 });
    expect(calls.map((c) => c.url)).toEqual([EspnClient.seasonUrl('1', 2018, ['mTeam']), EspnClient.historyUrl('1', 2018, ['mTeam'])]);
  });

  it('private league without a session: 401 on both paths -> NeedsCredentialsError naming the season', async () => {
    const { impl } = fakeFetch([[SEASONS, { status: 401 }], [HISTORY, { status: 401 }]]);
    const err = await new EspnClient(impl).fetchSeason('1', 2021, ['mTeam']).catch((e) => e);
    expect(err).toBeInstanceOf(NeedsCredentialsError);
    expect(err.season).toBe(2021);
    expect(err.message).toMatch(/Sign in to ESPN/);
  });

  it('private league with a bad session: the message says the session was refused', async () => {
    const { impl, calls } = fakeFetch([[SEASONS, { status: 401 }], [HISTORY, { status: 401 }]]);
    const err = await new EspnClient(impl).fetchSeason('1', 2021, ['mTeam'], { espnS2: 'AEB%2Fx', swid: '{ABC}' }).catch((e) => e);
    expect(err).toBeInstanceOf(NeedsCredentialsError);
    expect(err.message).toMatch(/with the session provided/);
    // Cookie goes out verbatim, never re-encoded.
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Cookie).toBe('espn_s2=AEB%2Fx; SWID={ABC}');
  });

  it('espn_s2 alone is sent without a SWID fragment', async () => {
    const { impl, calls } = fakeFetch([[SEASONS, { status: 200, body: {} }]]);
    await new EspnClient(impl).fetchSeason('1', 2021, ['mTeam'], { espnS2: 'abc' });
    expect((calls[0].init?.headers as Record<string, string>).Cookie).toBe('espn_s2=abc');
  });

  it('old season behind a login: leagueHistory 404 -> NeedsCredentialsError', async () => {
    const { impl } = fakeFetch([[HISTORY, { status: 404 }]]);
    const err = await new EspnClient(impl).fetchSeason('1', 2015, ['mTeam']).catch((e) => e);
    expect(err).toBeInstanceOf(NeedsCredentialsError);
    expect(err.season).toBe(2015);
  });

  it('403 is treated as needing credentials', async () => {
    const { impl } = fakeFetch([[SEASONS, { status: 403 }]]);
    await expect(new EspnClient(impl).fetchSeason('1', 2022, ['mTeam'])).rejects.toBeInstanceOf(NeedsCredentialsError);
  });

  it('429 -> SourceThrottledError with a retry hint', async () => {
    const { impl } = fakeFetch([[SEASONS, { status: 429 }]]);
    const err = await new EspnClient(impl).fetchSeason('1', 2022, ['mTeam']).catch((e) => e);
    expect(err).toBeInstanceOf(SourceThrottledError);
    expect(err.retryAfterMs).toBeGreaterThan(0);
  });

  it('a missing league on the seasons path is a plain error, not a credentials prompt', async () => {
    const { impl } = fakeFetch([[SEASONS, { status: 404 }]]);
    const err = await new EspnClient(impl).fetchSeason('999', 2022, ['mTeam']).catch((e) => e);
    expect(err).not.toBeInstanceOf(NeedsCredentialsError);
    expect(err.message).toMatch(/ESPN returned 404 for season 2022/);
  });

  it('never follows redirects (a login bounce must surface as a status, not a page)', async () => {
    const { impl, calls } = fakeFetch([[SEASONS, { status: 200, body: {} }]]);
    await new EspnClient(impl).fetchSeason('1', 2021, ['mTeam']);
    expect(calls[0].init?.redirect).toBe('manual');
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('uses global fetch when no implementation is injected', () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 200, json: async () => ({}) } as unknown as Response);
    return new EspnClient().fetchSeason('1', 2021, ['mTeam']).then(() => {
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });
  });
});
