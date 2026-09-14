/**
 * Yahoo Fantasy Sports API read client.
 *
 * Every call is `GET https://fantasysports.yahooapis.com/fantasy/v2/{resource}?format=json`
 * with a bearer token from the connection's token provider. Two Yahoo habits
 * shape the error handling: a 401 means the hour-long access token has
 * expired (refresh once, retry once); an HTTP 999 with an HTML "Request
 * denied" body is throttling and is surfaced as SourceThrottledError so the
 * job records where it stopped and the client retries later. Responses are
 * passed through `unpack` so callers see plain objects.
 */
import { SourceThrottledError, NeedsCredentialsError } from '../types';
import { unpack } from './normalize';

export const YAHOO_API_BASE = 'https://fantasysports.yahooapis.com/fantasy/v2';

export interface AccessTokenProvider {
  get(): Promise<string>;
  /** Drop the cached access token so the next get() refreshes. */
  invalidate(): void;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface YahooFetchResult {
  endpoint: string;
  /** The unpacked `fantasy_content` object. */
  content: unknown;
  /** Raw JSON as Yahoo sent it, for import_raw_payloads. */
  raw: unknown;
}

const PLAYER_KEY_BATCH = 25;

export class YahooClient {
  constructor(
    private readonly tokens: AccessTokenProvider,
    private readonly fetchImpl: FetchLike = (u, i) => fetch(u, i),
    /** Pause between calls so a ten-season import does not trip Yahoo's limiter. */
    private readonly pacingMs = 0,
  ) {}

  static url(resource: string): string {
    const r = resource.replace(/^\/+/, '');
    return `${YAHOO_API_BASE}/${r}${r.includes('?') ? '&' : '?'}format=json`;
  }

  async get(resource: string): Promise<YahooFetchResult> {
    const endpoint = YahooClient.url(resource);
    let res = await this.request(endpoint);
    if (res.status === 401) {
      this.tokens.invalidate();
      res = await this.request(endpoint);
      if (res.status === 401) throw new NeedsCredentialsError(0, 'Yahoo no longer accepts this connection. Connect Yahoo again.');
    }
    if (res.status === 999 || res.status === 429) throw new SourceThrottledError(60_000, 'Yahoo is rate limiting requests');
    if (res.status === 403) throw new NeedsCredentialsError(0, 'Yahoo says this account is not a member of that league.');
    if (res.status !== 200) throw new Error(`Yahoo returned ${res.status} for ${resource}`);
    const raw = await res.json();
    const unpacked = unpack(raw) as { fantasy_content?: unknown } | null;
    return { endpoint, content: unpacked?.fantasy_content ?? null, raw };
  }

  /** Every NHL league the signed-in user has ever been in, by game (season). */
  userLeagues(): Promise<YahooFetchResult> {
    return this.get('users;use_login=1/games;game_codes=nhl;game_types=full/leagues');
  }

  /** One season's league with the sub-resources the parser reads. */
  league(leagueKey: string, out: string[] = ['settings', 'standings', 'draftresults']): Promise<YahooFetchResult> {
    return this.get(`league/${encodeURIComponent(leagueKey)};out=${out.join(',')}`);
  }

  leagueMeta(leagueKey: string): Promise<YahooFetchResult> {
    return this.get(`league/${encodeURIComponent(leagueKey)}/metadata`);
  }

  scoreboard(leagueKey: string, week: number): Promise<YahooFetchResult> {
    return this.get(`league/${encodeURIComponent(leagueKey)}/scoreboard;week=${week}`);
  }

  keepers(leagueKey: string): Promise<YahooFetchResult> {
    return this.get(`league/${encodeURIComponent(leagueKey)}/players;status=K;out=ownership`);
  }

  transactions(leagueKey: string): Promise<YahooFetchResult> {
    return this.get(`league/${encodeURIComponent(leagueKey)}/transactions`);
  }

  /** Player details for a set of keys, in Yahoo's batch size. */
  async players(leagueKey: string, playerKeys: string[]): Promise<YahooFetchResult[]> {
    const out: YahooFetchResult[] = [];
    for (let i = 0; i < playerKeys.length; i += PLAYER_KEY_BATCH) {
      const batch = playerKeys.slice(i, i + PLAYER_KEY_BATCH);
      out.push(await this.get(`league/${encodeURIComponent(leagueKey)}/players;player_keys=${batch.map(encodeURIComponent).join(',')}`));
    }
    return out;
  }

  private async request(url: string): Promise<Response> {
    if (this.pacingMs > 0) await new Promise((r) => setTimeout(r, this.pacingMs));
    const token = await this.tokens.get();
    return this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
  }
}
