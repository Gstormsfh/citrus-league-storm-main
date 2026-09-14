/**
 * Platform-neutral shape of one imported season.
 *
 * Every source parser (ESPN, Yahoo, later Fantrax) produces exactly this, and
 * every service downstream (crosswalk, identity, trophies, the writer) consumes
 * only this. The parsers are the only code that knows a source's field names,
 * which is what makes a source renaming a field a one-file fix.
 *
 * Conventions that are easy to get backwards:
 *   - `season` is the START year of the NHL season (2025 = 2025-26), matching
 *     raw_shots.season and league_seasons.season. Each source counts
 *     differently; the parser converts.
 *   - Managers are keyed on the source's stable account id (Yahoo guid, ESPN
 *     SWID with braces). Team ids are per-season and get reused when a manager
 *     leaves, so they are never an identity.
 *   - A category league has no "score". `homeScore`/`awayScore` stay null and
 *     the category columns are filled instead. Nothing downstream may compute
 *     a points record from a category matchup.
 */

export type ImportPlatform = 'espn' | 'yahoo';

export type ImportedScoringType =
  | 'points'
  | 'h2h_points'
  | 'h2h_categories'
  | 'h2h_one_win'
  | 'roto'
  | 'unknown';

export interface ImportedManager {
  /** Yahoo guid or ESPN SWID (braces kept). */
  externalManagerId: string;
  displayName: string;
  /** Present only when the source returned it to an authenticated commissioner. */
  emailHint?: string;
}

export interface ImportedTeam {
  externalTeamId: string;
  teamName: string;
  /** Primary owner first; co-managers follow. */
  managers: ImportedManager[];
  finalRank: number | null;
  /** Where the source records who overrode the rank: 'source_final' | 'source_calculated' | 'commissioner'. */
  finalRankSource: string | null;
  playoffSeed: number | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  pointsFor: number | null;
  pointsAgainst: number | null;
  /** Verbatim record string for category leagues, e.g. '132-69-9'. */
  categoryRecord: string | null;
  madePlayoffs: boolean | null;
  /** 1 won the final, 2 lost the final, null unknown. */
  playoffFinish: number | null;
}

export interface ImportedCategoryResult {
  statKey: string;
  home: number | null;
  away: number | null;
  winner: 'home' | 'away' | 'tie' | null;
}

export interface ImportedMatchup {
  week: number;
  homeExternalTeamId: string;
  /** null for a bye. */
  awayExternalTeamId: string | null;
  homeScore: number | null;
  awayScore: number | null;
  homeCatWins: number | null;
  homeCatLosses: number | null;
  homeCatTies: number | null;
  categoryResults: ImportedCategoryResult[] | null;
  isPlayoff: boolean;
  isConsolation: boolean;
  isChampionship: boolean;
  winner: 'home' | 'away' | 'tie' | null;
  externalMatchupId: string | null;
}

export interface ImportedPlayerRef {
  externalPlayerId: string;
  name: string;
  teamAbbr: string | null;
  jerseyNumber: string | null;
  position: string | null;
}

export interface ImportedPick {
  overallPick: number;
  round: number | null;
  pickInRound: number | null;
  externalTeamId: string | null;
  player: ImportedPlayerRef;
  isKeeper: boolean;
  keeperCost: string | null;
  auctionCost: number | null;
}

export interface ImportedKeeperDesignation {
  externalTeamId: string;
  player: ImportedPlayerRef;
  /** Round the keeper cost this season, where the source says. */
  round: number | null;
  /** Round the keeper would cost next season, where the source says. */
  roundNext: number | null;
}

export interface ImportedTransaction {
  externalTransactionId: string | null;
  occurredAt: string | null;
  type: 'add' | 'drop' | 'trade' | 'waiver' | 'commish' | 'keeper' | 'unknown';
  externalTeamId: string | null;
  counterpartyExternalTeamId: string | null;
  player: ImportedPlayerRef | null;
  faabBid: number | null;
}

export interface ImportedScoringItem {
  /** Source stat identifier, verbatim. */
  sourceStatId: string;
  /** Citrus stat key when the translation knows it, otherwise `unknown_{platform}_{id}`. */
  citrusKey: string;
  group: 'skater' | 'goalie' | 'unknown';
  /** Points per unit in a points league; null in category leagues. */
  points: number | null;
  /** True when lower is better (GAA). */
  reverse: boolean;
  enabled: boolean;
}

export interface ImportedRosterSlot {
  slot: string;
  count: number;
}

export interface ImportedSettings {
  leagueName: string;
  scoringType: ImportedScoringType;
  scoringItems: ImportedScoringItem[];
  rosterSlots: ImportedRosterSlot[];
  regularSeasonWeeks: number | null;
  playoffTeamCount: number | null;
  playoffWeeks: number | null;
  keeperCount: number | null;
  keeperOrderType: string | null;
  draftType: string | null;
  usesFaab: boolean | null;
  isPublic: boolean | null;
}

export interface ImportedSeason {
  platform: ImportPlatform;
  externalLeagueId: string;
  /** ESPN seasonId or Yahoo game_id; whatever addresses this season at the source. */
  externalSeasonKey: string;
  /** START year, Citrus convention. */
  season: number;
  isFinished: boolean;
  settings: ImportedSettings;
  teams: ImportedTeam[];
  matchups: ImportedMatchup[];
  picks: ImportedPick[];
  keepers: ImportedKeeperDesignation[];
  transactions: ImportedTransaction[];
  /** Seasons the source says exist before this one, when it says. */
  previousSeasons: number[];
  /** Parser notes worth surfacing to the commissioner: unknown stat ids, missing views. */
  warnings: string[];
}

/** Thrown by a client when the source demands a session we do not hold. */
export class NeedsCredentialsError extends Error {
  readonly season: number;
  constructor(season: number, message: string) {
    super(message);
    this.name = 'NeedsCredentialsError';
    this.season = season;
  }
}

/** Thrown by a client on throttling; the job records it and retries later. */
export class SourceThrottledError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number, message = 'Source is throttling requests') {
    super(message);
    this.name = 'SourceThrottledError';
    this.retryAfterMs = retryAfterMs;
  }
}
