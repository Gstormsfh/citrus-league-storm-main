/**
 * Comprehensive League Type Definitions
 * Supports ALL fantasy hockey and pool-style league formats
 *
 * League Types:
 * - Fantasy Hockey (traditional): Draft players, manage rosters, compete weekly/seasonally
 * - Pick'em Pool: Pick NHL game winners each week
 * - Survivor Pool: Pick one NHL team to win each week, can't repeat, one strike and out
 * - Confidence Pool: Rank your weekly picks by confidence points
 */

// ============================================================================
// LEAGUE TYPE - The fundamental format of the league
// ============================================================================

export type LeagueType = 'fantasy' | 'pickem' | 'survivor' | 'confidence-pool' | 'playoff-bracket-pickem' | 'playoff-confidence-pool' | 'playoff-roster-pool';

export const LEAGUE_TYPE_LABELS: Record<LeagueType, string> = {
  'fantasy': 'Fantasy Hockey',
  'pickem': "Pick'em Pool",
  'survivor': 'Survivor Pool',
  'confidence-pool': 'Confidence Pool',
  'playoff-bracket-pickem': 'Playoff Bracket Challenge',
  'playoff-confidence-pool': 'Playoff Confidence Pool',
  'playoff-roster-pool': 'Playoff Roster Pool',
};

export const LEAGUE_TYPE_DESCRIPTIONS: Record<LeagueType, string> = {
  'fantasy': 'Draft players, manage your roster, and compete head-to-head or season-long. The classic fantasy experience.',
  'pickem': 'Pick the winners of NHL games each week. No roster management needed — just predict outcomes.',
  'survivor': 'Pick one NHL team to win each week. Get it wrong and you\'re eliminated. Can\'t pick the same team twice.',
  'confidence-pool': 'Pick NHL game winners and rank them by confidence. Higher confidence = more points if correct.',
  'playoff-bracket-pickem': 'Pick the winner of every Stanley Cup Playoff series. Bonus for predicting games. Points double each round.',
  'playoff-confidence-pool': 'Pick playoff series winners and assign confidence points (1-15). Higher confidence = more risk, more reward.',
  'playoff-roster-pool': 'Build your dream roster from all 16 playoff teams. Earn fantasy points all playoffs long. Fully customizable scoring.',
};

// ============================================================================
// SCORING FORMAT - How fantasy points/standings are calculated
// ============================================================================

export type ScoringFormat =
  | 'h2h-points'        // Head-to-Head: total fantasy points determine weekly winner
  | 'h2h-categories'    // Head-to-Head: each stat category is a separate W/L/T
  | 'roto'              // Rotisserie: season-long cumulative stat rankings
  | 'total-points'      // Season-long: cumulative total points, no matchups
  | 'best-ball'         // Auto-optimized lineups each week, H2H or season-long
  | 'points-per-game';  // Season-long: average points per game determines standings

export const SCORING_FORMAT_LABELS: Record<ScoringFormat, string> = {
  'h2h-points': 'Head-to-Head Points',
  'h2h-categories': 'Head-to-Head Categories',
  'roto': 'Rotisserie',
  'total-points': 'Season Points',
  'best-ball': 'Best Ball',
  'points-per-game': 'Points Per Game',
};

export const SCORING_FORMAT_DESCRIPTIONS: Record<ScoringFormat, string> = {
  'h2h-points': 'Teams face off weekly. Total fantasy points determine the winner of each matchup.',
  'h2h-categories': 'Teams face off weekly. Each stat category (goals, assists, etc.) is a separate win/loss/tie.',
  'roto': 'No weekly matchups. Teams are ranked in each stat category all season. Rankings are summed for final standings.',
  'total-points': 'No weekly matchups. The team with the most cumulative fantasy points over the season wins.',
  'best-ball': 'Your best possible lineup is automatically set each week. No roster management needed — just draft well.',
  'points-per-game': 'Like Total Points, but standings are ranked by average points per game played. Rewards efficiency.',
};

// Which scoring formats need weekly matchups vs. season-long
export const FORMAT_HAS_MATCHUPS: Record<ScoringFormat, boolean> = {
  'h2h-points': true,
  'h2h-categories': true,
  'roto': false,
  'total-points': false,
  'best-ball': true, // Can be H2H best ball
  'points-per-game': false,
};

// Which scoring formats use point values vs. category rankings
export const FORMAT_USES_POINT_VALUES: Record<ScoringFormat, boolean> = {
  'h2h-points': true,
  'h2h-categories': false, // Uses raw stat counts per category
  'roto': false,           // Uses category rankings
  'total-points': true,
  'best-ball': true,
  'points-per-game': true,
};

// ============================================================================
// DRAFT TYPE - How teams acquire players
// ============================================================================

export type DraftType = 'snake' | 'linear' | 'auction' | 'autopick' | 'offline';

export const DRAFT_TYPE_LABELS: Record<DraftType, string> = {
  'snake': 'Snake Draft',
  'linear': 'Linear Draft',
  'auction': 'Auction Draft',
  'autopick': 'Autopick Draft',
  'offline': 'Offline / Manual Draft',
};

export const DRAFT_TYPE_DESCRIPTIONS: Record<DraftType, string> = {
  'snake': 'Pick order reverses each round. Team picking 1st in round 1 picks last in round 2. Most popular format.',
  'linear': 'Same pick order every round. Team picking 1st always picks 1st. Rewards top draft position heavily.',
  'auction': 'Every team gets a salary budget. Players are nominated and teams bid. Most strategic draft format.',
  'autopick': 'Players are automatically drafted based on pre-set rankings. Set your preferences and the system drafts for you.',
  'offline': 'Commissioner imports draft results after an external draft. Use your own draft board or live event.',
};

// ============================================================================
// POOL-SPECIFIC SETTINGS
// ============================================================================

export type PickemFormat = 'straight-up' | 'against-the-spread';

export const PICKEM_FORMAT_LABELS: Record<PickemFormat, string> = {
  'straight-up': 'Straight Up',
  'against-the-spread': 'Against the Spread',
};

// ============================================================================
// ROSTER SETTINGS
// ============================================================================

export interface RosterSlotConfig {
  slot: string;
  label: string;
  count: number;
}

export const DEFAULT_ROSTER_SLOTS: RosterSlotConfig[] = [
  { slot: 'C', label: 'Center', count: 2 },
  { slot: 'LW', label: 'Left Wing', count: 2 },
  { slot: 'RW', label: 'Right Wing', count: 2 },
  { slot: 'D', label: 'Defense', count: 4 },
  { slot: 'G', label: 'Goalie', count: 2 },
  { slot: 'UTIL', label: 'Utility', count: 2 },
  { slot: 'BN', label: 'Bench', count: 5 },
  { slot: 'IR', label: 'Injured Reserve', count: 2 },
];

export const DEFAULT_FDG_ROSTER_SLOTS: RosterSlotConfig[] = [
  { slot: 'F', label: 'Forward', count: 6 },
  { slot: 'D', label: 'Defense', count: 4 },
  { slot: 'G', label: 'Goalie', count: 2 },
  { slot: 'UTIL', label: 'Utility', count: 1 },
  { slot: 'BN', label: 'Bench', count: 8 },
  { slot: 'IR', label: 'Injured Reserve', count: 2 },
];

// ============================================================================
// ROTO / CATEGORY STAT DEFINITIONS
// ============================================================================

export interface CategoryStat {
  id: string;
  name: string;
  abbreviation: string;
  isGoalie: boolean;
  higherIsBetter: boolean; // For roto rankings - goals: higher is better, GAA: lower is better
}

export const AVAILABLE_CATEGORIES: CategoryStat[] = [
  // Skater categories
  { id: 'goals', name: 'Goals', abbreviation: 'G', isGoalie: false, higherIsBetter: true },
  { id: 'assists', name: 'Assists', abbreviation: 'A', isGoalie: false, higherIsBetter: true },
  { id: 'points', name: 'Points', abbreviation: 'PTS', isGoalie: false, higherIsBetter: true },
  { id: 'plus_minus', name: 'Plus/Minus', abbreviation: '+/-', isGoalie: false, higherIsBetter: true },
  { id: 'ppp', name: 'Power Play Points', abbreviation: 'PPP', isGoalie: false, higherIsBetter: true },
  { id: 'shp', name: 'Shorthanded Points', abbreviation: 'SHP', isGoalie: false, higherIsBetter: true },
  { id: 'sog', name: 'Shots on Goal', abbreviation: 'SOG', isGoalie: false, higherIsBetter: true },
  { id: 'hits', name: 'Hits', abbreviation: 'HIT', isGoalie: false, higherIsBetter: true },
  { id: 'blocks', name: 'Blocked Shots', abbreviation: 'BLK', isGoalie: false, higherIsBetter: true },
  { id: 'pim', name: 'Penalty Minutes', abbreviation: 'PIM', isGoalie: false, higherIsBetter: true },
  // Goalie categories
  { id: 'wins', name: 'Wins', abbreviation: 'W', isGoalie: true, higherIsBetter: true },
  { id: 'saves', name: 'Saves', abbreviation: 'SV', isGoalie: true, higherIsBetter: true },
  { id: 'shutouts', name: 'Shutouts', abbreviation: 'SO', isGoalie: true, higherIsBetter: true },
  { id: 'gaa', name: 'Goals Against Average', abbreviation: 'GAA', isGoalie: true, higherIsBetter: false },
  { id: 'save_pct', name: 'Save Percentage', abbreviation: 'SV%', isGoalie: true, higherIsBetter: true },
];

// Default categories for H2H Categories and Roto leagues
export const DEFAULT_ROTO_CATEGORIES = [
  'goals', 'assists', 'ppp', 'sog', 'hits', 'blocks', // Skater
  'wins', 'saves', 'shutouts', 'gaa',                   // Goalie
];

// ============================================================================
// COMPREHENSIVE LEAGUE SETTINGS INTERFACE
// ============================================================================

export interface LeagueFormatSettings {
  // === Core Format ===
  leagueType: LeagueType;
  scoringFormat: ScoringFormat;
  draftType: DraftType;

  // === Team Config ===
  teamsCount: number;

  // === Draft Settings ===
  draftRounds: number;
  pickTimeLimit: number;         // Seconds per pick (snake/linear)
  auctionBudget?: number;        // $ budget per team (auction only)
  auctionMinBid?: number;        // Minimum bid amount
  auctionNominationTime?: number;// Seconds to nominate (auction only)

  // === Season Settings ===
  playoffTeams?: number;         // 0 = no playoffs, 4, 6, or 8
  playoffWeeks?: number;         // Weeks for playoffs (default: 3)
  tradeDeadlineWeek?: number;    // Week number trade deadline (0 = no deadline)
  regularSeasonWeeks?: number;   // Override auto-calculated season length

  // === Keeper / Dynasty ===
  keeperEnabled?: boolean;       // Keep players between seasons
  keeperCount?: number;          // Max keepers per team (0 = unlimited for dynasty)
  keeperPenalty?: 'none' | 'round-cost' | 'round-escalation'; // Draft cost for keepers
  dynastyMode?: boolean;         // Keep entire roster (implies keeperEnabled)

  // === Best Ball ===
  bestBallEnabled?: boolean;     // Auto-optimize lineups (no management)

  // === Category / Roto Settings ===
  categories?: string[];         // Stat category IDs for H2H-Cat/Roto
  minGoalieGames?: number;       // Minimum goalie starts for counting (roto)

  // === Pool Settings (Pick'em / Survivor / Confidence) ===
  pickemFormat?: PickemFormat;   // Straight up vs spread
  picksPerWeek?: number;         // How many games to pick per week
  survivorLives?: number;        // 1 = standard, 2+ = mulligan variant
  confidenceMaxPoints?: number;  // Max confidence points (usually = number of games)

  // === Trade Settings (Commissioner-configurable) ===
  tradeExpirationDays?: number;    // How many days before a trade offer expires (default: 7)
  tradeReviewType?: 'none' | 'commissioner' | 'league_vote';  // How trades are reviewed
  tradeReviewPeriodHours?: number;  // Voting window (default: 48h)
  tradeVetoThreshold?: number;     // Fraction needed to veto (0-1, default: 0.5)

  // === Roster Slot Configuration (Commissioner-configurable) ===
  rosterSlots?: Record<string, number>;  // e.g., { C: 2, LW: 2, RW: 2, D: 4, G: 2, UTIL: 2 }

  // === Position Type (Commissioner-configurable) ===
  positionType?: 'individual' | 'forward';  // 'individual' = C/LW/RW/D/G, 'forward' = F/D/G

  // === Transaction Limits (Commissioner-configurable) ===
  weeklyAddLimit?: number;           // Max adds per team per week (0 = unlimited, ESPN/Yahoo/Sleeper standard)
  seasonAddLimit?: number;           // Max adds per team per season (0 = unlimited)

  // === FAAB Budget ===
  faabBudget?: number;             // FAAB budget per team (default: 100)

  // === Scoring Point Values (for points-based formats) ===
  stats: Array<{
    id: string;
    name: string;
    points: number;
    default: boolean;
    category: string;
    enabled: boolean;
  }>;

  // Allow additional keys from the JSONB column without breaking type safety
  [key: string]: unknown;
}

/**
 * Convenience alias for league.settings JSONB.
 * Use this everywhere instead of `Record<string, unknown>` or `as any`.
 */
export type LeagueSettings = Partial<LeagueFormatSettings>;

// ============================================================================
// DEFAULT SETTINGS PER LEAGUE TYPE
// ============================================================================

// INDUSTRY-STANDARD DEFAULTS (2026-09-01): Yahoo-aligned; SHP/hits/PIM/+/- opt-in.
// Must equal DEFAULT_SCORING in @citrus/shared (guard-tested).
const BASE_STATS = [
  { id: "g", name: "Goals", points: 6, default: true, category: "Offense", enabled: true },
  { id: "a", name: "Assists", points: 4, default: true, category: "Offense", enabled: true },
  { id: "ppp", name: "Power Play Points", points: 2, default: true, category: "Offense", enabled: true },
  { id: "shg", name: "Shorthanded Points", points: 2, default: false, category: "Offense", enabled: false },
  { id: "sog", name: "Shots on Goal", points: 0.9, default: true, category: "Offense", enabled: true },
  { id: "blk", name: "Blocks", points: 1, default: true, category: "Defense", enabled: true },
  { id: "hit", name: "Hits", points: 0.5, default: false, category: "Defense", enabled: false },
  { id: "pim", name: "Penalty Minutes", points: 0.5, default: false, category: "Defense", enabled: false },
  { id: "pm", name: "Plus/Minus", points: 2, default: false, category: "Defense", enabled: false },
  { id: "w", name: "Wins", points: 5, default: true, category: "Goalie", enabled: true },
  { id: "so", name: "Shutouts", points: 5, default: true, category: "Goalie", enabled: true },
  { id: "sv", name: "Saves", points: 0.6, default: true, category: "Goalie", enabled: true },
  { id: "ga", name: "Goals Against", points: -3, default: true, category: "Goalie", enabled: true },
];

export function getDefaultSettings(leagueType: LeagueType): LeagueFormatSettings {
  switch (leagueType) {
    case 'fantasy':
      return {
        leagueType: 'fantasy',
        scoringFormat: 'h2h-points',
        draftType: 'snake',
        teamsCount: 12,
        draftRounds: 21,
        pickTimeLimit: 90,
        playoffTeams: 6,
        playoffWeeks: 3,
        tradeDeadlineWeek: 0,
        keeperEnabled: false,
        keeperCount: 0,
        dynastyMode: false,
        bestBallEnabled: false,
        categories: [...DEFAULT_ROTO_CATEGORIES],
        weeklyAddLimit: 0,   // 0 = unlimited (industry standard default)
        seasonAddLimit: 0,   // 0 = unlimited (industry standard default)
        stats: [...BASE_STATS],
      };
    case 'pickem':
      return {
        leagueType: 'pickem',
        scoringFormat: 'total-points',
        draftType: 'snake', // Not used for pools
        teamsCount: 20,     // Pools can be much larger
        draftRounds: 0,
        pickTimeLimit: 0,
        pickemFormat: 'straight-up',
        picksPerWeek: 10,
        stats: [],
      };
    case 'survivor':
      return {
        leagueType: 'survivor',
        scoringFormat: 'total-points',
        draftType: 'snake',
        teamsCount: 30,
        draftRounds: 0,
        pickTimeLimit: 0,
        survivorLives: 1,
        stats: [],
      };
    case 'confidence-pool':
      return {
        leagueType: 'confidence-pool',
        scoringFormat: 'total-points',
        draftType: 'snake',
        teamsCount: 20,
        draftRounds: 0,
        pickTimeLimit: 0,
        picksPerWeek: 10,
        confidenceMaxPoints: 10,
        stats: [],
      };
    case 'playoff-bracket-pickem':
      return {
        leagueType: 'playoff-bracket-pickem',
        scoringFormat: 'total-points',
        draftType: 'snake',
        teamsCount: 20,
        draftRounds: 0,
        pickTimeLimit: 0,
        stats: [],
      };
    case 'playoff-confidence-pool':
      return {
        leagueType: 'playoff-confidence-pool',
        scoringFormat: 'total-points',
        draftType: 'snake',
        teamsCount: 20,
        draftRounds: 0,
        pickTimeLimit: 0,
        stats: [],
      };
    case 'playoff-roster-pool':
      return {
        leagueType: 'playoff-roster-pool',
        scoringFormat: 'total-points',
        draftType: 'snake',
        teamsCount: 20,
        draftRounds: 0,
        pickTimeLimit: 0,
        stats: [],
      };
    default: {
      const _exhaustive: never = leagueType;
      throw new Error(`Unknown league type: ${_exhaustive}`);
    }
  }
}

// ============================================================================
// HELPERS
// ============================================================================

/** Check if a league type requires player drafting */
export function requiresDraft(leagueType: LeagueType): boolean {
  return leagueType === 'fantasy';
}

/** Check if a league type requires roster management */
export function requiresRoster(leagueType: LeagueType): boolean {
  return leagueType === 'fantasy';
}

/** Check if a league type uses weekly matchups */
export function hasWeeklyMatchups(settings: LeagueFormatSettings): boolean {
  if (settings.leagueType !== 'fantasy') return false;
  return FORMAT_HAS_MATCHUPS[settings.scoringFormat] ?? false;
}

/** Check if a scoring format uses point values (vs categories) */
export function usesPointValues(scoringFormat: ScoringFormat): boolean {
  return FORMAT_USES_POINT_VALUES[scoringFormat] ?? true;
}

/** Check if the format supports playoffs */
export function supportsPlayoffs(settings: LeagueFormatSettings): boolean {
  if (settings.leagueType !== 'fantasy') return false;
  return FORMAT_HAS_MATCHUPS[settings.scoringFormat] ?? false;
}

/** Get the number of category matchups per week for H2H Categories */
export function getCategoryMatchupsPerWeek(categories: string[]): number {
  return categories.length;
}

/** Check if a league uses waivers */
export function hasWaivers(leagueType: LeagueType): boolean {
  return leagueType === 'fantasy';
}

/** Check if a league supports trades */
export function hasTrades(leagueType: LeagueType): boolean {
  return leagueType === 'fantasy';
}

/** Extract LeagueFormatSettings from a league's settings JSON */
export function extractFormatSettings(settings: Record<string, unknown>): Partial<LeagueFormatSettings> {
  return {
    leagueType: (settings.leagueType as LeagueType) || 'fantasy',
    scoringFormat: (settings.scoringFormat as ScoringFormat) || (settings.scoringType as ScoringFormat) || 'h2h-points',
    draftType: (settings.draftType as DraftType) || 'snake',
    teamsCount: (settings.teamsCount as number) || 12,
    draftRounds: (settings.draftRounds as number) || 21,
    pickTimeLimit: (settings.pickTimeLimit as number) || 90,

    // Auction
    auctionBudget: (settings.auctionBudget as number) || 200,
    auctionMinBid: (settings.auctionMinBid as number) || 1,
    auctionNominationTime: (settings.auctionNominationTime as number) || 30,

    // Season
    playoffTeams: (settings.playoffTeams as number) ?? 6,
    playoffWeeks: (settings.playoffWeeks as number) ?? 3,
    tradeDeadlineWeek: (settings.tradeDeadlineWeek as number) ?? 0,
    regularSeasonWeeks: (settings.regularSeasonWeeks as number) || undefined,

    // Keeper / Dynasty
    keeperEnabled: (settings.keeperEnabled as boolean) || false,
    keeperCount: (settings.keeperCount as number) || 0,
    keeperPenalty: (settings.keeperPenalty as 'none' | 'round-cost' | 'round-escalation') || 'none',
    dynastyMode: (settings.dynastyMode as boolean) || false,

    // Best Ball
    bestBallEnabled: (settings.bestBallEnabled as boolean) || false,

    // Categories / Roto
    categories: (settings.categories as string[]) || [...DEFAULT_ROTO_CATEGORIES],
    minGoalieGames: (settings.minGoalieGames as number) ?? 3,

    // Pool settings
    pickemFormat: (settings.pickemFormat as PickemFormat) || 'straight-up',
    picksPerWeek: (settings.picksPerWeek as number) || 10,
    survivorLives: (settings.survivorLives as number) || 1,
    confidenceMaxPoints: (settings.confidenceMaxPoints as number) || 10,

    // Trade settings (commissioner-configurable)
    tradeExpirationDays: (settings.tradeExpirationDays as number) || 7,
    tradeReviewType: (settings.tradeReviewType as 'none' | 'commissioner' | 'league_vote') || 'none',
    tradeReviewPeriodHours: (settings.tradeReviewPeriodHours as number) || 48,
    tradeVetoThreshold: (settings.tradeVetoThreshold as number) || 0.5,

    // Roster slots (commissioner-configurable)
    rosterSlots: (settings.rosterSlots as Record<string, number>) || undefined,

    // Position type (commissioner-configurable)
    positionType: (settings.positionType as 'individual' | 'forward') || 'individual',

    // Transaction limits
    weeklyAddLimit: (settings.weeklyAddLimit as number) ?? 0,
    seasonAddLimit: (settings.seasonAddLimit as number) ?? 0,

    // FAAB
    faabBudget: (settings.faabBudget as number) || 100,
  };
}
