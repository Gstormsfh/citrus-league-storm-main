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

export type ImportPlatform = 'espn' | 'yahoo' | 'fantrax' | 'cbs' | 'sleeper' | 'manual';
export type ImportJobMethod = 'api' | 'screenshot' | 'paste';
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
  method?: ImportJobMethod;
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

/** What a one-tap league was set up with, and what the commissioner should look at. */
export interface FoundingPlan {
  name: string;
  scoringFormat: string;
  scoringSettings: { skater: Record<string, number>; goalie: Record<string, number> } | null;
  categories: string[] | null;
  rosterSlots: Record<string, number>;
  rosterSize: number;
  draftRounds: number;
  draftType: 'snake' | 'auction';
  teamsCount: number;
  playoffTeams: number | null;
  playoffWeeks: number | null;
  keeper: { enabled: boolean; count: number };
  notes: string[];
}
export interface FoundedLeague { league: { id: string; name: string; join_code: string | null }; job: ImportJob; plan: FoundingPlan }

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

// ---- screenshots -------------------------------------------------------------
/**
 * One league page as the reader saw it, and as the commissioner edits it.
 * Mirrors server/src/import/screenshot/schema.ts; the server re-validates
 * on confirm, so a field the reader left null can be filled here.
 */
export type PageKind = 'champions' | 'awards' | 'standings' | 'playoffs' | 'draft' | 'transactions' | 'keepers' | 'roster' | 'pick_ownership' | 'settings' | 'scoreboard' | 'other';
export interface ChampionRow { season: number; championTeam: string; championManager?: string | null; runnerUpTeam?: string | null; runnerUpManager?: string | null; note?: string | null }
export interface AwardRow { season?: number | null; award: string; winnerTeam?: string | null; winnerManager?: string | null; note?: string | null }
export type PagePlatform = 'yahoo' | 'espn' | 'fantrax' | 'cbs' | 'sleeper' | 'unknown';
export interface StandingsRow { rank?: number | null; teamName: string; managerName?: string | null; wins?: number | null; losses?: number | null; ties?: number | null; pointsFor?: number | null; pointsAgainst?: number | null; categoryRecord?: string | null; playoffSeed?: number | null; playoffFinish?: number | null; madePlayoffs?: boolean | null; isChampion?: boolean | null }
export interface PlayoffRow { round: 'final' | 'third_place' | 'semifinal' | 'quarterfinal' | 'consolation' | 'other'; week?: number | null; homeTeam: string; awayTeam?: string | null; homeScore?: number | null; awayScore?: number | null; winner?: 'home' | 'away' | 'tie' | null }
export interface DraftPickRow { overall?: number | null; round?: number | null; pickInRound?: number | null; teamName: string; playerName: string; playerTeamAbbr?: string | null; position?: string | null; isKeeper?: boolean | null; keeperCost?: string | null; auctionCost?: number | null }
export interface TransactionRow { date?: string | null; type: 'add' | 'drop' | 'trade' | 'waiver' | 'commish' | 'keeper' | 'unknown'; teamName: string; counterpartyTeamName?: string | null; playerName?: string | null; playerTeamAbbr?: string | null; position?: string | null; pickSeason?: number | null; pickRound?: number | null; pickOriginalTeamName?: string | null; faabBid?: number | null }
export interface KeeperRow { teamName: string; playerName: string; playerTeamAbbr?: string | null; position?: string | null; round?: number | null; roundNext?: number | null; yearsKept?: number | null }
export interface RosterRow { teamName: string; players: Array<{ playerName: string; playerTeamAbbr?: string | null; position?: string | null }> }
export interface PickOwnershipRow { draftSeason: number; round: number; originalTeamName: string; ownerTeamName: string }
export interface PageSettings { scoringType?: 'points' | 'h2h_points' | 'h2h_categories' | 'h2h_one_win' | 'roto' | 'unknown' | null; categories?: string[] | null; pointValues?: Array<{ stat: string; points: number }> | null; rosterSlots?: Array<{ slot: string; count: number }> | null; keeperCount?: number | null; keeperRule?: string | null; draftType?: string | null; usesFaab?: boolean | null; regularSeasonWeeks?: number | null; playoffTeams?: number | null; playoffWeeks?: number | null; teamCount?: number | null }
export interface ScoreboardPage { week: number; isPlayoff?: boolean | null; matchups: Array<{ homeTeam: string; awayTeam?: string | null; homeScore?: number | null; awayScore?: number | null; homeCatWins?: number | null; homeCatLosses?: number | null; homeCatTies?: number | null; winner?: 'home' | 'away' | 'tie' | null }> }
export interface ScreenshotPage {
  index: number; platform: PagePlatform; kind: PageKind; season: number | null; leagueName?: string | null; confidence: 'high' | 'medium' | 'low'; notes?: string | null;
  champions?: ChampionRow[] | null; awards?: AwardRow[] | null;
  standings?: StandingsRow[] | null; playoffs?: PlayoffRow[] | null; picks?: DraftPickRow[] | null; transactions?: TransactionRow[] | null; keepers?: KeeperRow[] | null;
  roster?: RosterRow[] | null; pickOwnership?: PickOwnershipRow[] | null; settings?: PageSettings | null; scoreboard?: ScoreboardPage | null;
}
export interface ScreenshotImage { data: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' }
export interface ScreenshotReadOutcome { job: ImportJob; pages: ScreenshotPage[]; usage: { inputTokens: number; outputTokens: number } }
export interface ScreenshotStatus { configured: boolean; maxImages: number; platforms: ImportPlatform[] }

// ---- one season's long parts, and the keeper/dynasty carry-over ----------------
export interface SeasonPick { overall_pick: number; round: number | null; pick_in_round: number | null; member_id: string | null; nhl_player_id: number | null; external_player_id: string | null; external_player_name: string | null; is_keeper: boolean; keeper_cost: string | null; auction_cost: number | null; source: string }
export interface SeasonTransaction { id: string; occurred_at: string | null; type: string; member_id: string | null; counterparty_member_id: string | null; nhl_player_id: number | null; external_player_id: string | null; external_player_name: string | null; pick_season: number | null; pick_round: number | null; pick_original_member_id: string | null; faab_bid: number | null; external_transaction_id: string | null; source: string }
export interface SeasonMatchup { week: number; home_member_id: string; away_member_id: string | null; home_score: number | null; away_score: number | null; home_cat_wins: number | null; home_cat_losses: number | null; home_cat_ties: number | null; is_playoff: boolean; is_consolation: boolean; is_championship: boolean; winner_member_id: string | null; is_tie: boolean }
export interface SeasonKeeper { member_id: string; external_player_id: string; external_player_name: string | null; nhl_player_id: number | null; round: number | null; round_next: number | null; years_kept: number | null; source: string }
export interface SeasonDetail { season: number; picks: SeasonPick[]; transactions: SeasonTransaction[]; matchups: SeasonMatchup[]; keepers: SeasonKeeper[] }
export interface KeeperPlanRow { memberId: string; memberName: string; teamId: string | null; teamName: string | null; playerName: string | null; nhlPlayerId: number | null; externalPlayerId: string; round: number | null; yearsKept: number | null; blocker: 'unclaimed' | 'unmatched' | null }
export interface TradedPickRow { draftSeason: number; round: number; originalMemberId: string; originalName: string; originalTeamId: string | null; ownerMemberId: string; ownerName: string; ownerTeamId: string | null; appliedAt: string | null; source: string; blocker: 'unclaimed' | null }
export interface Carryover { draftSeason: number; keepers: { season: number | null; seasonYear: number; rows: KeeperPlanRow[]; ready: number; blocked: number }; picks: TradedPickRow[] }

export const importApi = {
  // ---- ESPN ---------------------------------------------------------------
  discoverEspn(league: string, credentials?: EspnCredentials) {
    return apiClient.post<EspnDiscovery>('/api/imports/espn/discover', { league, credentials });
  },
  startEspn(leagueId: string, body: { externalLeagueId: string; latestEspnSeason?: number; seasons?: number[]; credentials?: EspnCredentials }) {
    return apiClient.post<ImportJob>(`/api/leagues/${leagueId}/imports/espn`, body);
  },
  /** One tap: a new Citrus league set up from the ESPN league, with the import running into it. */
  foundEspn(body: { externalLeagueId: string; latestEspnSeason?: number; credentials?: EspnCredentials }) {
    return apiClient.post<FoundedLeague>('/api/imports/espn/found', body, { timeoutMs: 60_000 });
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
  /** One tap: a new Citrus league set up from the Yahoo league, with the import running into it. */
  foundYahoo(body: { leagueKey: string }) {
    return apiClient.post<FoundedLeague>('/api/imports/yahoo/found', body, { timeoutMs: 60_000 });
  },

  // ---- screenshots, any platform -------------------------------------------
  screenshotStatus() {
    return apiClient.get<ScreenshotStatus>('/api/imports/screenshots/status');
  },
  /** The images go up once and are read once; the reply is the pages to review. Vision reads take a while. */
  readScreenshots(leagueId: string, body: { platform: ImportPlatform; leagueName?: string | null; season?: number | null; images: ScreenshotImage[] }) {
    return apiClient.post<ScreenshotReadOutcome>(`/api/leagues/${leagueId}/imports/screenshots/read`, body, { timeoutMs: 180_000 });
  },
  confirmScreenshots(leagueId: string, jobId: string, body: { platform: ImportPlatform; leagueName?: string | null; pages: ScreenshotPage[]; finished?: Record<string, boolean>; rostersAsKeepers?: boolean }) {
    return apiClient.post<ImportJob>(`/api/leagues/${leagueId}/imports/screenshots/${jobId}/confirm`, body, { timeoutMs: 60_000 });
  },
  getSeasonDetail(leagueId: string, season: number) {
    return apiClient.get<SeasonDetail>(`/api/leagues/${leagueId}/history/seasons/${season}`);
  },
  getCarryover(leagueId: string) {
    return apiClient.get<Carryover>(`/api/leagues/${leagueId}/history/carryover`);
  },
  applyKeepers(leagueId: string) {
    return apiClient.post<{ seasonYear: number; written: number; skippedLocked: number; blocked: number }>(`/api/leagues/${leagueId}/history/carryover/keepers`, {});
  },
  applyTradedPicks(leagueId: string, draftSeason: number) {
    return apiClient.post<{ applied: number; alreadyApplied: number; skipped: Array<{ round: number; reason: string }> }>(`/api/leagues/${leagueId}/history/carryover/picks`, { draftSeason });
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
