/**
 * ESPN fantasy hockey read client.
 *
 * ESPN has no public API. This talks to the same internal endpoints ESPN's own
 * web client uses, read-only, for leagues the user either owns publicly or has
 * a session for. Two facts drive the shape of this file:
 *
 *   1. Seasons 2018+ are served from the seasons path and, for a league the
 *      commissioner has made public, need no credentials at all. Seasons 2017
 *      and earlier are served from the leagueHistory path, and since 2025 that
 *      path demands the espn_s2 session cookie. A 2018 season is a known quirk
 *      that answers 401 on the seasons path even with a session and must be
 *      re-requested from leagueHistory.
 *   2. Credentials are an argument to a call, never state on the client and
 *      never logged. The web import page holds them for the life of one job.
 */
import { NeedsCredentialsError, SourceThrottledError } from '../types';

export const ESPN_BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fhl';

export interface EspnCredentials {
  espnS2: string;
  swid?: string;
}

export interface EspnFetchResult {
  endpoint: string;
  status: number;
  body: unknown;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const HISTORY_CUTOVER_SEASON = 2018; // ESPN seasonId; 2018 and later use the seasons path

export class EspnClient {
  private readonly fetchImpl: FetchLike;

  constructor(fetchImpl: FetchLike = (url, init) => fetch(url, init)) {
    this.fetchImpl = fetchImpl;
  }

  /** Build the URL for one season and a set of views. */
  static seasonUrl(leagueId: string, espnSeasonId: number, views: string[]): string {
    const qs = views.map((v) => `view=${encodeURIComponent(v)}`).join('&');
    if (espnSeasonId >= HISTORY_CUTOVER_SEASON) {
      return `${ESPN_BASE}/seasons/${espnSeasonId}/segments/0/leagues/${encodeURIComponent(leagueId)}?${qs}`;
    }
    return `${ESPN_BASE}/leagueHistory/${encodeURIComponent(leagueId)}?seasonId=${espnSeasonId}&${qs}`;
  }

  static historyUrl(leagueId: string, espnSeasonId: number, views: string[]): string {
    const qs = views.map((v) => `view=${encodeURIComponent(v)}`).join('&');
    return `${ESPN_BASE}/leagueHistory/${encodeURIComponent(leagueId)}?seasonId=${espnSeasonId}&${qs}`;
  }

  /**
   * Fetch one season with the given views. Returns the parsed body, unwrapping
   * the array that the leagueHistory path returns. Throws NeedsCredentialsError
   * when ESPN wants a session we do not have.
   */
  async fetchSeason(
    leagueId: string,
    espnSeasonId: number,
    views: string[],
    creds?: EspnCredentials,
  ): Promise<EspnFetchResult> {
    const primary = EspnClient.seasonUrl(leagueId, espnSeasonId, views);
    const first = await this.get(primary, creds);

    if (first.status === 200) {
      return { endpoint: primary, status: 200, body: unwrap(first.body) };
    }

    // 2018 quirk and the general rule: a 401 on the seasons path means try
    // the history path before concluding we need a session.
    if (first.status === 401 && espnSeasonId >= HISTORY_CUTOVER_SEASON) {
      const alt = EspnClient.historyUrl(leagueId, espnSeasonId, views);
      const second = await this.get(alt, creds);
      if (second.status === 200) {
        return { endpoint: alt, status: 200, body: unwrap(second.body) };
      }
      throw new NeedsCredentialsError(
        espnSeasonId,
        creds
          ? `ESPN refused season ${espnSeasonId} with the session provided (${second.status}).`
          : `ESPN season ${espnSeasonId} is private. Sign in to ESPN to import it.`,
      );
    }

    if (first.status === 401 || first.status === 403 || (first.status === 404 && espnSeasonId < HISTORY_CUTOVER_SEASON)) {
      // The history endpoint answers 404, not 401, when it wants a session.
      throw new NeedsCredentialsError(
        espnSeasonId,
        creds
          ? `ESPN refused season ${espnSeasonId} with the session provided (${first.status}).`
          : `ESPN keeps season ${espnSeasonId} behind a login. Sign in to ESPN to import it.`,
      );
    }

    if (first.status === 429) {
      throw new SourceThrottledError(60_000, 'ESPN is rate limiting requests');
    }

    throw new Error(`ESPN returned ${first.status} for season ${espnSeasonId}`);
  }

  private async get(url: string, creds?: EspnCredentials): Promise<{ status: number; body: unknown }> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (creds?.espnS2) {
      // Do not re-encode espn_s2: it arrives percent-encoded and ESPN expects it that way.
      headers.Cookie = creds.swid ? `espn_s2=${creds.espnS2}; SWID=${creds.swid}` : `espn_s2=${creds.espnS2}`;
    }
    const res = await this.fetchImpl(url, { headers, redirect: 'manual' });
    let body: unknown = null;
    if (res.status === 200) {
      body = await res.json();
    }
    return { status: res.status, body };
  }
}

/** leagueHistory returns an array with one element per season requested. */
function unwrap(body: unknown): unknown {
  if (Array.isArray(body)) return body[0] ?? null;
  return body;
}

export const ESPN_VIEWS = {
  core: ['mSettings', 'mTeam'],
  schedule: ['mMatchupScore'],
  draft: ['mDraftDetail'],
  roster: ['mRoster'],
} as const;
