/**
 * ESPN fantasy hockey (game "fhl") identifier maps.
 *
 * ESPN has no public API and no documentation. Every entry below was either
 * verified against a live 2025-26 player line (marked verified) or taken from
 * the community espn-api library's STATS_MAP (marked library). Ids with no
 * confident meaning are deliberately absent: the translation surfaces them as
 * `unknown_espn_{id}` for the commissioner rather than guessing.
 *
 * Citrus stat keys come from packages/shared scoring: skater keys and goalie
 * keys as ScoringCalculator understands them.
 */

export interface EspnStatDef {
  citrusKey: string;
  group: 'skater' | 'goalie';
  /** verified = checked against a real box score; library = espn-api STATS_MAP. */
  provenance: 'verified' | 'library';
}

export const ESPN_STAT_MAP: Record<number, EspnStatDef> = {
  // goalie
  0:  { citrusKey: 'goalie_games_started', group: 'goalie', provenance: 'verified' },
  1:  { citrusKey: 'wins',                 group: 'goalie', provenance: 'verified' },
  2:  { citrusKey: 'losses',               group: 'goalie', provenance: 'verified' },
  3:  { citrusKey: 'shots_faced',          group: 'goalie', provenance: 'verified' },
  4:  { citrusKey: 'goals_against',        group: 'goalie', provenance: 'verified' },
  6:  { citrusKey: 'saves',                group: 'goalie', provenance: 'verified' },
  7:  { citrusKey: 'shutouts',             group: 'goalie', provenance: 'verified' },
  8:  { citrusKey: 'goalie_toi_seconds',   group: 'goalie', provenance: 'library' },
  9:  { citrusKey: 'ot_losses',            group: 'goalie', provenance: 'verified' },
  10: { citrusKey: 'goals_against_average',group: 'goalie', provenance: 'verified' },
  11: { citrusKey: 'save_percentage',      group: 'goalie', provenance: 'verified' },
  12: { citrusKey: 'goalie_win_percentage',group: 'goalie', provenance: 'library' },
  // skater
  13: { citrusKey: 'goals',                group: 'skater', provenance: 'verified' },
  14: { citrusKey: 'assists',              group: 'skater', provenance: 'verified' },
  15: { citrusKey: 'plus_minus',           group: 'skater', provenance: 'verified' },
  16: { citrusKey: 'points',               group: 'skater', provenance: 'verified' },
  17: { citrusKey: 'penalty_minutes',      group: 'skater', provenance: 'verified' },
  18: { citrusKey: 'power_play_goals',     group: 'skater', provenance: 'verified' },
  19: { citrusKey: 'power_play_assists',   group: 'skater', provenance: 'verified' },
  20: { citrusKey: 'short_handed_goals',   group: 'skater', provenance: 'verified' },
  21: { citrusKey: 'short_handed_assists', group: 'skater', provenance: 'verified' },
  22: { citrusKey: 'game_winning_goals',   group: 'skater', provenance: 'verified' },
  23: { citrusKey: 'faceoff_wins',         group: 'skater', provenance: 'library' },
  24: { citrusKey: 'faceoff_losses',       group: 'skater', provenance: 'library' },
  26: { citrusKey: 'toi_seconds',          group: 'skater', provenance: 'library' },
  27: { citrusKey: 'atoi_seconds',         group: 'skater', provenance: 'verified' },
  28: { citrusKey: 'hat_tricks',           group: 'skater', provenance: 'library' },
  29: { citrusKey: 'shots_on_goal',        group: 'skater', provenance: 'verified' },
  30: { citrusKey: 'games_played',         group: 'skater', provenance: 'library' },
  31: { citrusKey: 'hits',                 group: 'skater', provenance: 'library' },
  32: { citrusKey: 'blocks',               group: 'skater', provenance: 'library' },
  33: { citrusKey: 'defenseman_points',    group: 'skater', provenance: 'library' },
  34: { citrusKey: 'skater_games_played',  group: 'skater', provenance: 'library' },
  35: { citrusKey: 'special_teams_goals',  group: 'skater', provenance: 'library' },
  36: { citrusKey: 'special_teams_assists',group: 'skater', provenance: 'library' },
  37: { citrusKey: 'special_teams_points', group: 'skater', provenance: 'library' },
  38: { citrusKey: 'power_play_points',    group: 'skater', provenance: 'library' },
  39: { citrusKey: 'short_handed_points',  group: 'skater', provenance: 'library' },
};

/** Lineup slot ids as they appear in rosterSettings.lineupSlotCounts. */
export const ESPN_SLOT_MAP: Record<number, string> = {
  0: 'C', 1: 'LW', 2: 'RW', 3: 'F', 4: 'D', 5: 'G', 6: 'UTIL', 7: 'BN', 8: 'IR',
};

/** defaultPositionId on a player. */
export const ESPN_POSITION_MAP: Record<number, string> = {
  1: 'C', 2: 'LW', 3: 'RW', 4: 'D', 5: 'G',
};

/** proTeamId -> NHL abbreviation. 0 is free agent. */
export const ESPN_PRO_TEAM_MAP: Record<number, string> = {
  1: 'BOS', 2: 'BUF', 3: 'CGY', 4: 'CHI', 5: 'DET', 6: 'EDM', 7: 'CAR', 8: 'LAK',
  9: 'DAL', 10: 'MTL', 11: 'NJD', 12: 'NYI', 13: 'NYR', 14: 'OTT', 15: 'PHI', 16: 'PIT',
  17: 'COL', 18: 'SJS', 19: 'STL', 20: 'TBL', 21: 'TOR', 22: 'VAN', 23: 'WSH', 24: 'ARI',
  25: 'ANA', 26: 'FLA', 27: 'NSH', 28: 'WPG', 29: 'CBJ', 30: 'MIN', 37: 'VGK',
  124292: 'SEA', 129764: 'UTA',
};

/**
 * ESPN's seasonId is the END year of the NHL season (seasons/2026 = 2025-26).
 * Citrus stores the START year.
 */
export function espnSeasonToCitrus(espnSeasonId: number): number {
  return espnSeasonId - 1;
}

export function citrusSeasonToEspn(citrusSeason: number): number {
  return citrusSeason + 1;
}
