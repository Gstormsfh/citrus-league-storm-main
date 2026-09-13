/**
 * League history import API client: Yahoo and ESPN discovery, the import
 * job, the trophy room, and member claiming.
 *
 * ESPN credentials (for a private league, web only) travel in one request
 * body to the API, which holds them for the life of the job and never
 * stores them. Nothing here caches: every read is a state a person is
 * waiting on.
 */
import { apiClient } from './client';

export type ImportPlatform = 'espn' | 'yahoo';
export type ImportJobStatus = 'queued' | 'discovering' | 'importing' | 'matching' | 'computing' | 'done' | 'partial' | 'failed' | 'needs_credentials';

export interface EspnCredentials { espnS2: string; swid?: string }

export interface EspnDiscovery {
  externalLeagueId: string;
  needsCredentials: boolean;
  message?: string;
  leagueName?: string | null;
  latestSeason?: number;
  latestEspnSeason?: number;
  seasons?: number[];
  isPublic?: boolean | null;
  scoringType?: string;
  teamCount?: number;
}

export interface ImportJob {
  id: string;
  league_id: string;
  platform: ImportPlatform;
  external_league_id: string;
  status: ImportJobStatus;
  seasons_discovered: number[];
  seasons_imported: number[];
  seasons_needing_credentials: number[];
  progress: { seasons?: Array<{ season: number; teams: number; matchups: number; picks: number; unmatched_players: number; warnings: string[] }> } & Record<string, unknown>;
  error: { code?: string; message?: string; retry_after_ms?: number; season?: number } | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface YahooConnection { connected: boolean; guid: string | null; grantedAt: string | null; revokedAt: string | null; configured: boolean }

export interface YahooLeagueSeason { leagueKey: string; season: number; name: string; isFinished: boolean; scoringType: string; numTeams: number | null }
export interface YahooChain { key: string; name: string; latestSeason: number; scoringType: string; numTeams: number | null; seasons: YahooLeagueSeason[] }
export interface YahooDiscovery { guid: string | null; chains: YahooChain[] }

export interface HistorySeason { season: number; platform: string; team_count: number | null; champion: string | null; runner_up: string | null; regular_season_winner: string | null }
export interface HistoryStanding { season: number; member_id: string; team_name: string | null; rank: number | null; wins: number | null; losses: number | null; ties: number | null; points_for: number | null; points_against: number | null; made_playoffs: boolean | null; playoff_finish: number | null; playoff_seed: number | null; category_record: string | null }
export interface HistoryMember { member_id: string; display_name: string; owner_id: string | null; first_season: number | null; last_season: number | null; seasons_played: number | null; titles: number | null; finals_lost: number | null; playoff_seasons: number | null; best_finish: number | null; career_wins: number | null; career_losses: number | null; career_ties: number | null }
export interface Trophy { id: string; season: number | null; member_id: string | null; trophy_key: string; rank: number | null; value: number | null; detail: Record<string, unknown>; source: 'imported' | 'computed' | 'manual'; display_name: string | null; icon_key: string | null; is_hidden: boolean }
export interface ImportedSettings {
  platform: string; season: number;
  scoringFormat: string | null;
  scoringSettings: { skater: Record<string, number>; goalie: Record<string, number> };
  categories: string[];
  rosterSlots: Array<{ slot: string; count: number }>;
  unmapped: Array<{ sourceStatId: string; citrusKey: string; points: number | null; reason: string }>;
  keeper: { count: number | null; orderType: string | null };
  playoffs: { teamCount: number | null; weeks: number | null; regularSeasonWeeks: number | null };
  draftType: string | null;
  usesFaab: boolean | null;
}
export interface UnmatchedPlayer { platform: string; externalPlayerId: string; name: string | null; season: number }
export interface LeagueHistory {
  league: { id: string; name: string; founded_season: number | null; imported_from: string | null; history_locked: boolean } | null;
  seasons: HistorySeason[];
  standings: HistoryStanding[];
  members: HistoryMember[];
  trophies: Trophy[];
  sources: Array<{ platform: string; externalLeagueId: string; season: number; isPublicSource: boolean | null }>;
  importedSettings: ImportedSettings | null;
  unmatchedPlayers: UnmatchedPlayer[];
}
export interface UnclaimedMember { id: string; display_name: string; first_season: number | null; last_season: number | null; titles: number; seasons_played: number; playoff_seasons: number; best_finish: number | null }
/**
 * "Which one is you?" for the signed-in member: the managers nobody has
 * claimed, and whether this person is already attached to their history.
 * The screens ask only while `attached` is false and `members` is non-empty.
 */
export interface ClaimQuestion { members: UnclaimedMember[]; attached: boolean }
export interface ClaimResult { member_id: string; league_id: string; display_name: string; claim_method: string }

export const importApi = {
  // ---- ESPN ---------------------------------------------------------------
  discoverEspn(league: string, credentials?: EspnCredentials) {
    return apiClient.post<EspnDiscovery>('/api/imports/espn/discover', { league, credentials });
  },
  startEspn(leagueId: string, body: { externalLeagueId: string; latestEspnSeason?: number; seasons?: number[]; credentials?: EspnCredentials }) {
    return apiClient.post<ImportJob>(`/api/leagues/${leagueId}/imports/espn`, body);
  },

  // ---- Yahoo --------------------------------------------------------------
  yahooConnectUrl() {
    return apiClient.get<{ url: string }>('/api/imports/yahoo/connect');
  },
  yahooCallback(code: string, state: string) {
    return apiClient.post<{ connected: boolean; guid: string }>('/api/imports/yahoo/callback', { code, state });
  },
  yahooConnection() {
    return apiClient.get<YahooConnection>('/api/imports/yahoo/connection');
  },
  yahooDisconnect() {
    return apiClient.delete<{ connected: boolean }>('/api/imports/yahoo/connection');
  },
  yahooLeagues() {
    return apiClient.get<YahooDiscovery>('/api/imports/yahoo/leagues', { timeoutMs: 30_000 });
  },
  startYahoo(leagueId: string, body: { leagueKey: string; seasons?: number[] }) {
    return apiClient.post<ImportJob>(`/api/leagues/${leagueId}/imports/yahoo`, body);
  },

  // ---- jobs and the room --------------------------------------------------
  getJob(leagueId: string, jobId: string) {
    return apiClient.get<ImportJob>(`/api/leagues/${leagueId}/imports/${jobId}`);
  },
  getHistory(leagueId: string) {
    return apiClient.get<LeagueHistory>(`/api/leagues/${leagueId}/history`);
  },
  listUnclaimed(leagueId: string) {
    return apiClient.get<ClaimQuestion>(`/api/leagues/${leagueId}/history/unclaimed`);
  },
  claim(leagueId: string, memberId: string, claimToken?: string | null) {
    return apiClient.post<ClaimResult>(`/api/leagues/${leagueId}/history/claim`, { memberId, ...(claimToken ? { claimToken } : {}) });
  },

  // ---- commissioner -------------------------------------------------------
  recompute(leagueId: string) {
    return apiClient.post<{ trophies: number }>(`/api/leagues/${leagueId}/history/recompute`, {});
  },
  lock(leagueId: string) {
    return apiClient.post<{ history_locked: boolean }>(`/api/leagues/${leagueId}/history/lock`, {});
  },
  mergeMembers(leagueId: string, fromMemberId: string, intoMemberId: string) {
    return apiClient.post<{ survivorMemberId: string }>(`/api/leagues/${leagueId}/history/members/merge`, { fromMemberId, intoMemberId });
  },
  assignMember(leagueId: string, memberId: string, userId: string) {
    return apiClient.post<{ memberId: string; userId: string; merged: boolean }>(`/api/leagues/${leagueId}/history/members/${memberId}/assign`, { userId });
  },
  unclaimMember(leagueId: string, memberId: string) {
    return apiClient.post<{ memberId: string; unclaimed: boolean }>(`/api/leagues/${leagueId}/history/members/${memberId}/unclaim`, {});
  },
  decorateTrophy(leagueId: string, trophyId: string, patch: { display_name?: string | null; icon_key?: string | null; is_hidden?: boolean }) {
    return apiClient.patch<{ trophyId: string }>(`/api/leagues/${leagueId}/history/trophies/${trophyId}`, patch);
  },
  addTrophy(leagueId: string, body: { season: number | null; member_id: string | null; display_name: string; detail?: Record<string, unknown>; icon_key?: string | null }) {
    return apiClient.post<{ added: boolean }>(`/api/leagues/${leagueId}/history/trophies`, body);
  },
  resolvePlayer(leagueId: string, platform: ImportPlatform, externalPlayerId: string, nhlPlayerId: number) {
    return apiClient.post<{ nhlPlayerId: number }>(`/api/leagues/${leagueId}/history/players/${platform}/${encodeURIComponent(externalPlayerId)}`, { nhlPlayerId });
  },
};
