/**
 * PlayoffBracketBuilder — Pure TypeScript playoff bracket structure generator
 *
 * Generates the complete bracket topology (rounds, matchups, seeding, byes,
 * advancement wiring, week assignments) for 4/6/8 team brackets.
 *
 * This is a pure-logic module with ZERO database dependencies, designed
 * for comprehensive unit testing and to serve as the single source of truth
 * for bracket structure across the stack.
 */

// ============================================================================
// TYPES
// ============================================================================

export type BracketSize = 4 | 6 | 8;
export type BracketPosition = 'winners' | 'consolation' | 'third_place';
export type SeriesStatus = 'pending' | 'active' | 'bye';
export type SlotPosition = 'home' | 'away';

export interface BracketOptions {
  /** Number of teams in the playoff bracket (4, 6, or 8) */
  bracketSize: BracketSize;
  /** First week number of playoffs (regularSeasonWeeks + 1) */
  playoffStartWeek: number;
  /** If true, each round spans 2 weeks instead of 1 */
  twoWeekMatchups?: boolean;
  /** If true, generate consolation bracket for eliminated teams */
  consolationEnabled?: boolean;
}

export interface BracketSeries {
  /** Unique key for this series: "W-R1-M1", "C-R2-M1", "3P-R3-M1" */
  key: string;
  roundNumber: number;
  matchNumber: number;
  bracketPosition: BracketPosition;
  homeSeed: number | null;
  awaySeed: number | null;
  status: SeriesStatus;
  matchupWeek1: number;
  matchupWeek2: number | null;
  /** Key of the series the winner advances to */
  winnerAdvancesTo: string | null;
  winnerSlot: SlotPosition | null;
  /** Key of the series the loser drops to */
  loserDropsTo: string | null;
  loserSlot: SlotPosition | null;
}

export interface BracketStructure {
  bracketSize: BracketSize;
  totalRounds: number;
  playoffStartWeek: number;
  totalWeeksNeeded: number;
  twoWeekMatchups: boolean;
  consolationEnabled: boolean;
  series: BracketSeries[];
  /** Seeds that get first-round byes (empty for 4 and 8 team brackets) */
  byeSeeds: number[];
  /** Round names by round number */
  roundNames: Record<number, string>;
}

// ============================================================================
// ROUND NAMES
// ============================================================================

const ROUND_NAMES: Record<BracketSize, Record<number, string>> = {
  8: { 1: 'Quarterfinals', 2: 'Semifinals', 3: 'Championship' },
  6: { 1: 'Wild Card Round', 2: 'Semifinals', 3: 'Championship' },
  4: { 1: 'Semifinals', 2: 'Championship' },
};

// ============================================================================
// HELPERS
// ============================================================================

function seriesKey(position: BracketPosition, round: number, match: number): string {
  const prefix = position === 'winners' ? 'W' : position === 'consolation' ? 'C' : '3P';
  return `${prefix}-R${round}-M${match}`;
}

function weekForRound(
  roundIndex: number,
  playoffStartWeek: number,
  twoWeek: boolean
): { week1: number; week2: number | null } {
  const weeksPerRound = twoWeek ? 2 : 1;
  const offset = roundIndex * weeksPerRound;
  return {
    week1: playoffStartWeek + offset,
    week2: twoWeek ? playoffStartWeek + offset + 1 : null,
  };
}

// ============================================================================
// BRACKET BUILDERS
// ============================================================================

function build4TeamBracket(opts: Required<Pick<BracketOptions, 'playoffStartWeek' | 'twoWeekMatchups' | 'consolationEnabled'>>): BracketSeries[] {
  const { playoffStartWeek, twoWeekMatchups, consolationEnabled } = opts;
  const series: BracketSeries[] = [];

  // Round 1 (Semifinals): #1 vs #4, #2 vs #3
  const r1 = weekForRound(0, playoffStartWeek, twoWeekMatchups);
  const sf1Key = seriesKey('winners', 1, 1);
  const sf2Key = seriesKey('winners', 1, 2);
  const finalsKey = seriesKey('winners', 2, 1);

  series.push({
    key: sf1Key,
    roundNumber: 1, matchNumber: 1, bracketPosition: 'winners',
    homeSeed: 1, awaySeed: 4, status: 'active',
    matchupWeek1: r1.week1, matchupWeek2: r1.week2,
    winnerAdvancesTo: finalsKey, winnerSlot: 'home',
    loserDropsTo: null, loserSlot: null,
  });

  series.push({
    key: sf2Key,
    roundNumber: 1, matchNumber: 2, bracketPosition: 'winners',
    homeSeed: 2, awaySeed: 3, status: 'active',
    matchupWeek1: r1.week1, matchupWeek2: r1.week2,
    winnerAdvancesTo: finalsKey, winnerSlot: 'away',
    loserDropsTo: null, loserSlot: null,
  });

  // Round 2 (Finals)
  const r2 = weekForRound(1, playoffStartWeek, twoWeekMatchups);
  series.push({
    key: finalsKey,
    roundNumber: 2, matchNumber: 1, bracketPosition: 'winners',
    homeSeed: null, awaySeed: null, status: 'pending',
    matchupWeek1: r2.week1, matchupWeek2: r2.week2,
    winnerAdvancesTo: null, winnerSlot: null,
    loserDropsTo: null, loserSlot: null,
  });

  // Consolation: third-place game
  if (consolationEnabled) {
    const thirdPlaceKey = seriesKey('third_place', 2, 1);
    series.push({
      key: thirdPlaceKey,
      roundNumber: 2, matchNumber: 1, bracketPosition: 'third_place',
      homeSeed: null, awaySeed: null, status: 'pending',
      matchupWeek1: r2.week1, matchupWeek2: r2.week2,
      winnerAdvancesTo: null, winnerSlot: null,
      loserDropsTo: null, loserSlot: null,
    });

    // Wire SF losers to third-place
    series[0].loserDropsTo = thirdPlaceKey;
    series[0].loserSlot = 'home';
    series[1].loserDropsTo = thirdPlaceKey;
    series[1].loserSlot = 'away';
  }

  return series;
}

function build6TeamBracket(opts: Required<Pick<BracketOptions, 'playoffStartWeek' | 'twoWeekMatchups' | 'consolationEnabled'>>): BracketSeries[] {
  const { playoffStartWeek, twoWeekMatchups, consolationEnabled } = opts;
  const series: BracketSeries[] = [];

  // Round 1 (Wild Card): #3 vs #6, #4 vs #5 — Seeds 1 & 2 get byes
  const r1 = weekForRound(0, playoffStartWeek, twoWeekMatchups);
  const wc1Key = seriesKey('winners', 1, 1);
  const wc2Key = seriesKey('winners', 1, 2);
  const sf1Key = seriesKey('winners', 2, 1);
  const sf2Key = seriesKey('winners', 2, 2);
  const finalsKey = seriesKey('winners', 3, 1);

  // WC1: #3 vs #6
  series.push({
    key: wc1Key,
    roundNumber: 1, matchNumber: 1, bracketPosition: 'winners',
    homeSeed: 3, awaySeed: 6, status: 'active',
    matchupWeek1: r1.week1, matchupWeek2: r1.week2,
    winnerAdvancesTo: sf2Key, winnerSlot: 'away',
    loserDropsTo: null, loserSlot: null,
  });

  // WC2: #4 vs #5
  series.push({
    key: wc2Key,
    roundNumber: 1, matchNumber: 2, bracketPosition: 'winners',
    homeSeed: 4, awaySeed: 5, status: 'active',
    matchupWeek1: r1.week1, matchupWeek2: r1.week2,
    winnerAdvancesTo: sf1Key, winnerSlot: 'away',
    loserDropsTo: null, loserSlot: null,
  });

  // Round 2 (Semifinals): #1 (bye) vs WC2 winner, #2 (bye) vs WC1 winner
  const r2 = weekForRound(1, playoffStartWeek, twoWeekMatchups);

  // SF1: #1 seed vs WC2 winner
  series.push({
    key: sf1Key,
    roundNumber: 2, matchNumber: 1, bracketPosition: 'winners',
    homeSeed: 1, awaySeed: null, status: 'pending',
    matchupWeek1: r2.week1, matchupWeek2: r2.week2,
    winnerAdvancesTo: finalsKey, winnerSlot: 'home',
    loserDropsTo: null, loserSlot: null,
  });

  // SF2: #2 seed vs WC1 winner
  series.push({
    key: sf2Key,
    roundNumber: 2, matchNumber: 2, bracketPosition: 'winners',
    homeSeed: 2, awaySeed: null, status: 'pending',
    matchupWeek1: r2.week1, matchupWeek2: r2.week2,
    winnerAdvancesTo: finalsKey, winnerSlot: 'away',
    loserDropsTo: null, loserSlot: null,
  });

  // Round 3 (Finals)
  const r3 = weekForRound(2, playoffStartWeek, twoWeekMatchups);
  series.push({
    key: finalsKey,
    roundNumber: 3, matchNumber: 1, bracketPosition: 'winners',
    homeSeed: null, awaySeed: null, status: 'pending',
    matchupWeek1: r3.week1, matchupWeek2: r3.week2,
    winnerAdvancesTo: null, winnerSlot: null,
    loserDropsTo: null, loserSlot: null,
  });

  // Third-place game
  if (consolationEnabled) {
    const thirdPlaceKey = seriesKey('third_place', 3, 1);
    series.push({
      key: thirdPlaceKey,
      roundNumber: 3, matchNumber: 1, bracketPosition: 'third_place',
      homeSeed: null, awaySeed: null, status: 'pending',
      matchupWeek1: r3.week1, matchupWeek2: r3.week2,
      winnerAdvancesTo: null, winnerSlot: null,
      loserDropsTo: null, loserSlot: null,
    });

    // SF losers -> third-place
    series[2].loserDropsTo = thirdPlaceKey;  // SF1
    series[2].loserSlot = 'home';
    series[3].loserDropsTo = thirdPlaceKey;  // SF2
    series[3].loserSlot = 'away';
  }

  return series;
}

function build8TeamBracket(opts: Required<Pick<BracketOptions, 'playoffStartWeek' | 'twoWeekMatchups' | 'consolationEnabled'>>): BracketSeries[] {
  const { playoffStartWeek, twoWeekMatchups, consolationEnabled } = opts;
  const series: BracketSeries[] = [];

  const qf1Key = seriesKey('winners', 1, 1);
  const qf2Key = seriesKey('winners', 1, 2);
  const qf3Key = seriesKey('winners', 1, 3);
  const qf4Key = seriesKey('winners', 1, 4);
  const sf1Key = seriesKey('winners', 2, 1);
  const sf2Key = seriesKey('winners', 2, 2);
  const finalsKey = seriesKey('winners', 3, 1);

  // Round 1 (Quarterfinals): 1v8, 4v5, 2v7, 3v6
  const r1 = weekForRound(0, playoffStartWeek, twoWeekMatchups);

  series.push({
    key: qf1Key,
    roundNumber: 1, matchNumber: 1, bracketPosition: 'winners',
    homeSeed: 1, awaySeed: 8, status: 'active',
    matchupWeek1: r1.week1, matchupWeek2: r1.week2,
    winnerAdvancesTo: sf1Key, winnerSlot: 'home',
    loserDropsTo: null, loserSlot: null,
  });

  series.push({
    key: qf2Key,
    roundNumber: 1, matchNumber: 2, bracketPosition: 'winners',
    homeSeed: 4, awaySeed: 5, status: 'active',
    matchupWeek1: r1.week1, matchupWeek2: r1.week2,
    winnerAdvancesTo: sf1Key, winnerSlot: 'away',
    loserDropsTo: null, loserSlot: null,
  });

  series.push({
    key: qf3Key,
    roundNumber: 1, matchNumber: 3, bracketPosition: 'winners',
    homeSeed: 2, awaySeed: 7, status: 'active',
    matchupWeek1: r1.week1, matchupWeek2: r1.week2,
    winnerAdvancesTo: sf2Key, winnerSlot: 'home',
    loserDropsTo: null, loserSlot: null,
  });

  series.push({
    key: qf4Key,
    roundNumber: 1, matchNumber: 4, bracketPosition: 'winners',
    homeSeed: 3, awaySeed: 6, status: 'active',
    matchupWeek1: r1.week1, matchupWeek2: r1.week2,
    winnerAdvancesTo: sf2Key, winnerSlot: 'away',
    loserDropsTo: null, loserSlot: null,
  });

  // Round 2 (Semifinals): QF1w vs QF2w, QF3w vs QF4w
  const r2 = weekForRound(1, playoffStartWeek, twoWeekMatchups);

  series.push({
    key: sf1Key,
    roundNumber: 2, matchNumber: 1, bracketPosition: 'winners',
    homeSeed: null, awaySeed: null, status: 'pending',
    matchupWeek1: r2.week1, matchupWeek2: r2.week2,
    winnerAdvancesTo: finalsKey, winnerSlot: 'home',
    loserDropsTo: null, loserSlot: null,
  });

  series.push({
    key: sf2Key,
    roundNumber: 2, matchNumber: 2, bracketPosition: 'winners',
    homeSeed: null, awaySeed: null, status: 'pending',
    matchupWeek1: r2.week1, matchupWeek2: r2.week2,
    winnerAdvancesTo: finalsKey, winnerSlot: 'away',
    loserDropsTo: null, loserSlot: null,
  });

  // Round 3 (Finals)
  const r3 = weekForRound(2, playoffStartWeek, twoWeekMatchups);

  series.push({
    key: finalsKey,
    roundNumber: 3, matchNumber: 1, bracketPosition: 'winners',
    homeSeed: null, awaySeed: null, status: 'pending',
    matchupWeek1: r3.week1, matchupWeek2: r3.week2,
    winnerAdvancesTo: null, winnerSlot: null,
    loserDropsTo: null, loserSlot: null,
  });

  // Consolation bracket
  if (consolationEnabled) {
    const thirdPlaceKey = seriesKey('third_place', 3, 1);
    const conR1_1Key = seriesKey('consolation', 2, 1);
    const conR1_2Key = seriesKey('consolation', 2, 2);
    const conFinalsKey = seriesKey('consolation', 3, 1);

    // Third-place game (same week as finals)
    series.push({
      key: thirdPlaceKey,
      roundNumber: 3, matchNumber: 1, bracketPosition: 'third_place',
      homeSeed: null, awaySeed: null, status: 'pending',
      matchupWeek1: r3.week1, matchupWeek2: r3.week2,
      winnerAdvancesTo: null, winnerSlot: null,
      loserDropsTo: null, loserSlot: null,
    });

    // SF losers -> third-place
    series[4].loserDropsTo = thirdPlaceKey;  // SF1
    series[4].loserSlot = 'home';
    series[5].loserDropsTo = thirdPlaceKey;  // SF2
    series[5].loserSlot = 'away';

    // Consolation R1 (runs same week as SF): QF losers play each other
    // Con1: QF1 loser vs QF2 loser
    series.push({
      key: conR1_1Key,
      roundNumber: 2, matchNumber: 1, bracketPosition: 'consolation',
      homeSeed: null, awaySeed: null, status: 'pending',
      matchupWeek1: r2.week1, matchupWeek2: r2.week2,
      winnerAdvancesTo: conFinalsKey, winnerSlot: 'home',
      loserDropsTo: null, loserSlot: null,
    });

    // Con2: QF3 loser vs QF4 loser
    series.push({
      key: conR1_2Key,
      roundNumber: 2, matchNumber: 2, bracketPosition: 'consolation',
      homeSeed: null, awaySeed: null, status: 'pending',
      matchupWeek1: r2.week1, matchupWeek2: r2.week2,
      winnerAdvancesTo: conFinalsKey, winnerSlot: 'away',
      loserDropsTo: null, loserSlot: null,
    });

    // Consolation Finals (runs same week as championship)
    series.push({
      key: conFinalsKey,
      roundNumber: 3, matchNumber: 1, bracketPosition: 'consolation',
      homeSeed: null, awaySeed: null, status: 'pending',
      matchupWeek1: r3.week1, matchupWeek2: r3.week2,
      winnerAdvancesTo: null, winnerSlot: null,
      loserDropsTo: null, loserSlot: null,
    });

    // Wire QF losers -> consolation
    series[0].loserDropsTo = conR1_1Key;  // QF1
    series[0].loserSlot = 'home';
    series[1].loserDropsTo = conR1_1Key;  // QF2
    series[1].loserSlot = 'away';
    series[2].loserDropsTo = conR1_2Key;  // QF3
    series[2].loserSlot = 'home';
    series[3].loserDropsTo = conR1_2Key;  // QF4
    series[3].loserSlot = 'away';
  }

  return series;
}

// ============================================================================
// VALIDATION
// ============================================================================

const VALID_BRACKET_SIZES: BracketSize[] = [4, 6, 8];

export function validateBracketSize(teams: number): BracketSize | null {
  if (teams >= 8) return 8;
  if (teams >= 6) return 6;
  if (teams >= 4) return 4;
  return null;
}

export function snapToBracketSize(playoffTeams: number): BracketSize | null {
  if (VALID_BRACKET_SIZES.includes(playoffTeams as BracketSize)) {
    return playoffTeams as BracketSize;
  }
  return validateBracketSize(playoffTeams);
}

// ============================================================================
// WEEK CALCULATION
// ============================================================================

/**
 * Calculate total playoff weeks needed for a given bracket configuration.
 */
export function calculatePlayoffWeeksNeeded(bracketSize: BracketSize, twoWeekMatchups: boolean): number {
  const rounds = bracketSize === 4 ? 2 : 3;
  return rounds * (twoWeekMatchups ? 2 : 1);
}

/**
 * Calculate the playoff start week given the total schedule length and playoff weeks.
 * If regularSeasonWeeks is explicitly set, use it. Otherwise derive from total available weeks.
 */
export function calculatePlayoffStartWeek(opts: {
  regularSeasonWeeks?: number;
  totalAvailableWeeks: number;
  bracketSize: BracketSize;
  twoWeekMatchups: boolean;
}): { playoffStartWeek: number; regularSeasonWeeks: number; playoffWeeksNeeded: number; fits: boolean } {
  const playoffWeeksNeeded = calculatePlayoffWeeksNeeded(opts.bracketSize, opts.twoWeekMatchups);

  let regularSeasonWeeks: number;
  if (opts.regularSeasonWeeks && opts.regularSeasonWeeks > 0) {
    regularSeasonWeeks = opts.regularSeasonWeeks;
  } else {
    // Auto-calculate: total weeks minus playoff weeks
    regularSeasonWeeks = Math.max(1, opts.totalAvailableWeeks - playoffWeeksNeeded);
  }

  const playoffStartWeek = regularSeasonWeeks + 1;
  const lastPlayoffWeek = playoffStartWeek + playoffWeeksNeeded - 1;
  const fits = lastPlayoffWeek <= opts.totalAvailableWeeks;

  return { playoffStartWeek, regularSeasonWeeks, playoffWeeksNeeded, fits };
}

// ============================================================================
// MAIN BUILDER
// ============================================================================

/**
 * Build a complete playoff bracket structure.
 *
 * This is a pure function — no database calls, no side effects.
 * Returns the full bracket topology ready for persistence or display.
 */
export function buildPlayoffBracket(opts: BracketOptions): BracketStructure {
  const { bracketSize, playoffStartWeek } = opts;
  const twoWeekMatchups = opts.twoWeekMatchups ?? false;
  const consolationEnabled = opts.consolationEnabled ?? false;

  if (!VALID_BRACKET_SIZES.includes(bracketSize)) {
    throw new Error(`Invalid bracket size: ${bracketSize}. Must be 4, 6, or 8.`);
  }

  const builderOpts = { playoffStartWeek, twoWeekMatchups, consolationEnabled };

  let series: BracketSeries[];
  switch (bracketSize) {
    case 4:
      series = build4TeamBracket(builderOpts);
      break;
    case 6:
      series = build6TeamBracket(builderOpts);
      break;
    case 8:
      series = build8TeamBracket(builderOpts);
      break;
  }

  const totalRounds = bracketSize === 4 ? 2 : 3;
  const totalWeeksNeeded = calculatePlayoffWeeksNeeded(bracketSize, twoWeekMatchups);
  const byeSeeds = bracketSize === 6 ? [1, 2] : [];
  const roundNames = ROUND_NAMES[bracketSize];

  return {
    bracketSize,
    totalRounds,
    playoffStartWeek,
    totalWeeksNeeded,
    twoWeekMatchups,
    consolationEnabled,
    series,
    byeSeeds,
    roundNames,
  };
}

// ============================================================================
// QUERY HELPERS (for working with a built bracket)
// ============================================================================

/** Get all series in a specific round */
export function getSeriesByRound(bracket: BracketStructure, round: number): BracketSeries[] {
  return bracket.series.filter(s => s.roundNumber === round);
}

/** Get all winners bracket series */
export function getWinnersSeries(bracket: BracketStructure): BracketSeries[] {
  return bracket.series.filter(s => s.bracketPosition === 'winners');
}

/** Get all consolation series */
export function getConsolationSeries(bracket: BracketStructure): BracketSeries[] {
  return bracket.series.filter(s => s.bracketPosition === 'consolation');
}

/** Get the championship (final winners) series */
export function getChampionshipSeries(bracket: BracketStructure): BracketSeries | undefined {
  return bracket.series.find(
    s => s.bracketPosition === 'winners' && s.roundNumber === bracket.totalRounds
  );
}

/** Get the third-place series (if consolation enabled) */
export function getThirdPlaceSeries(bracket: BracketStructure): BracketSeries | undefined {
  return bracket.series.find(s => s.bracketPosition === 'third_place');
}

/** Get all first-round active matchups (the ones that need team IDs populated) */
export function getFirstRoundMatchups(bracket: BracketStructure): BracketSeries[] {
  return bracket.series.filter(s => s.status === 'active' && s.roundNumber === 1);
}

/** Get the round name for a bracket size and round number */
export function getRoundName(bracketSize: BracketSize, roundNumber: number): string {
  return ROUND_NAMES[bracketSize]?.[roundNumber] ?? `Round ${roundNumber}`;
}

/** Validate that advancement wiring is complete (every non-final series has a destination) */
export function validateAdvancementWiring(bracket: BracketStructure): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const s of bracket.series) {
    if (s.bracketPosition === 'winners' && s.roundNumber < bracket.totalRounds) {
      if (!s.winnerAdvancesTo) {
        errors.push(`${s.key}: missing winnerAdvancesTo`);
      }
      if (!s.winnerSlot) {
        errors.push(`${s.key}: missing winnerSlot`);
      }
    }

    if (s.bracketPosition === 'consolation' && s.roundNumber < bracket.totalRounds) {
      if (!s.winnerAdvancesTo) {
        errors.push(`${s.key}: consolation series missing winnerAdvancesTo`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
