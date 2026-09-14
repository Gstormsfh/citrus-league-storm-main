/**
 * Yahoo Fantasy Hockey identifier maps.
 *
 * Yahoo's settings payload names every stat it uses (`display_name`, `name`),
 * so the id table is a first pass and the name table is the authority when
 * the two disagree or the id is unknown. Ids marked `library` come from the
 * yahoo_fantasy_api / yfpy NHL references; `name` means the id is not
 * trusted on its own and the display name decides. Anything still unknown is
 * surfaced as `unknown_yahoo_{id}` for the commissioner, never guessed.
 *
 * Citrus stat keys are the same set the ESPN map uses.
 */

export interface YahooStatDef {
  citrusKey: string;
  group: 'skater' | 'goalie';
  provenance: 'library' | 'name';
}

export const YAHOO_STAT_MAP: Record<number, YahooStatDef> = {
  0:  { citrusKey: 'games_played',          group: 'skater', provenance: 'library' },
  1:  { citrusKey: 'goals',                 group: 'skater', provenance: 'library' },
  2:  { citrusKey: 'assists',               group: 'skater', provenance: 'library' },
  3:  { citrusKey: 'points',                group: 'skater', provenance: 'library' },
  4:  { citrusKey: 'plus_minus',            group: 'skater', provenance: 'library' },
  5:  { citrusKey: 'penalty_minutes',       group: 'skater', provenance: 'library' },
  6:  { citrusKey: 'power_play_goals',      group: 'skater', provenance: 'library' },
  7:  { citrusKey: 'power_play_assists',    group: 'skater', provenance: 'library' },
  8:  { citrusKey: 'power_play_points',     group: 'skater', provenance: 'library' },
  9:  { citrusKey: 'short_handed_goals',    group: 'skater', provenance: 'library' },
  10: { citrusKey: 'short_handed_assists',  group: 'skater', provenance: 'library' },
  11: { citrusKey: 'short_handed_points',   group: 'skater', provenance: 'library' },
  12: { citrusKey: 'game_winning_goals',    group: 'skater', provenance: 'library' },
  13: { citrusKey: 'game_tying_goals',      group: 'skater', provenance: 'library' },
  14: { citrusKey: 'shots_on_goal',         group: 'skater', provenance: 'library' },
  15: { citrusKey: 'shooting_percentage',   group: 'skater', provenance: 'library' },
  16: { citrusKey: 'faceoff_wins',          group: 'skater', provenance: 'library' },
  17: { citrusKey: 'faceoff_losses',        group: 'skater', provenance: 'library' },
  18: { citrusKey: 'goalie_games_played',   group: 'goalie', provenance: 'name' },
  19: { citrusKey: 'goalie_games_started',  group: 'goalie', provenance: 'library' },
  20: { citrusKey: 'wins',                  group: 'goalie', provenance: 'library' },
  21: { citrusKey: 'losses',                group: 'goalie', provenance: 'library' },
  22: { citrusKey: 'ties',                  group: 'goalie', provenance: 'name' },
  23: { citrusKey: 'goals_against',         group: 'goalie', provenance: 'library' },
  24: { citrusKey: 'goals_against_average', group: 'goalie', provenance: 'library' },
  25: { citrusKey: 'shots_faced',           group: 'goalie', provenance: 'library' },
  26: { citrusKey: 'saves',                 group: 'goalie', provenance: 'library' },
  27: { citrusKey: 'save_percentage',       group: 'goalie', provenance: 'library' },
  28: { citrusKey: 'shutouts',              group: 'goalie', provenance: 'library' },
  29: { citrusKey: 'goalie_toi_seconds',    group: 'goalie', provenance: 'name' },
  31: { citrusKey: 'hits',                  group: 'skater', provenance: 'library' },
  32: { citrusKey: 'blocks',                group: 'skater', provenance: 'library' },
};

/**
 * display_name as Yahoo prints it in league settings -> Citrus key. Compared
 * case-insensitively after trimming. Wins over the id table.
 */
export const YAHOO_STAT_BY_NAME: Record<string, YahooStatDef> = {
  'GP':    { citrusKey: 'games_played',          group: 'skater', provenance: 'name' },
  'G':     { citrusKey: 'goals',                 group: 'skater', provenance: 'name' },
  'A':     { citrusKey: 'assists',               group: 'skater', provenance: 'name' },
  'P':     { citrusKey: 'points',                group: 'skater', provenance: 'name' },
  'PTS':   { citrusKey: 'points',                group: 'skater', provenance: 'name' },
  '+/-':   { citrusKey: 'plus_minus',            group: 'skater', provenance: 'name' },
  'PIM':   { citrusKey: 'penalty_minutes',       group: 'skater', provenance: 'name' },
  'PPG':   { citrusKey: 'power_play_goals',      group: 'skater', provenance: 'name' },
  'PPA':   { citrusKey: 'power_play_assists',    group: 'skater', provenance: 'name' },
  'PPP':   { citrusKey: 'power_play_points',     group: 'skater', provenance: 'name' },
  'SHG':   { citrusKey: 'short_handed_goals',    group: 'skater', provenance: 'name' },
  'SHA':   { citrusKey: 'short_handed_assists',  group: 'skater', provenance: 'name' },
  'SHP':   { citrusKey: 'short_handed_points',   group: 'skater', provenance: 'name' },
  'GWG':   { citrusKey: 'game_winning_goals',    group: 'skater', provenance: 'name' },
  'GTG':   { citrusKey: 'game_tying_goals',      group: 'skater', provenance: 'name' },
  'SOG':   { citrusKey: 'shots_on_goal',         group: 'skater', provenance: 'name' },
  'SH%':   { citrusKey: 'shooting_percentage',   group: 'skater', provenance: 'name' },
  'FW':    { citrusKey: 'faceoff_wins',          group: 'skater', provenance: 'name' },
  'FL':    { citrusKey: 'faceoff_losses',        group: 'skater', provenance: 'name' },
  'HIT':   { citrusKey: 'hits',                  group: 'skater', provenance: 'name' },
  'BLK':   { citrusKey: 'blocks',                group: 'skater', provenance: 'name' },
  'TOI':   { citrusKey: 'toi_seconds',           group: 'skater', provenance: 'name' },
  'TOI/G': { citrusKey: 'atoi_seconds',          group: 'skater', provenance: 'name' },
  'HAT':   { citrusKey: 'hat_tricks',            group: 'skater', provenance: 'name' },
  'DEF':   { citrusKey: 'defenseman_points',     group: 'skater', provenance: 'name' },
  'GS':    { citrusKey: 'goalie_games_started',  group: 'goalie', provenance: 'name' },
  'W':     { citrusKey: 'wins',                  group: 'goalie', provenance: 'name' },
  'L':     { citrusKey: 'losses',                group: 'goalie', provenance: 'name' },
  'OTL':   { citrusKey: 'ot_losses',             group: 'goalie', provenance: 'name' },
  'T':     { citrusKey: 'ties',                  group: 'goalie', provenance: 'name' },
  'GA':    { citrusKey: 'goals_against',         group: 'goalie', provenance: 'name' },
  'GAA':   { citrusKey: 'goals_against_average', group: 'goalie', provenance: 'name' },
  'SA':    { citrusKey: 'shots_faced',           group: 'goalie', provenance: 'name' },
  'SV':    { citrusKey: 'saves',                 group: 'goalie', provenance: 'name' },
  'SV%':   { citrusKey: 'save_percentage',       group: 'goalie', provenance: 'name' },
  'SHO':   { citrusKey: 'shutouts',              group: 'goalie', provenance: 'name' },
  'MIN':   { citrusKey: 'goalie_toi_seconds',    group: 'goalie', provenance: 'name' },
};

/** Stats where lower is better, by Citrus key. Yahoo marks these sort_order 0. */
export const REVERSE_KEYS = new Set(['goals_against_average', 'goals_against', 'losses', 'ot_losses', 'penalty_minutes', 'faceoff_losses']);

/**
 * Resolve one Yahoo stat to a Citrus key. The display name decides when it is
 * known; the id fills in when the name is not; otherwise the stat is carried
 * as unknown_yahoo_{id} so nothing is dropped.
 */
export function resolveYahooStat(statId: number, displayName: string | null | undefined, positionType?: string | null): YahooStatDef & { known: boolean } {
  const name = (displayName ?? '').trim().toUpperCase();
  const byName = name ? YAHOO_STAT_BY_NAME[name] : undefined;
  if (byName) {
    // "GP" is a skater stat unless Yahoo says it is the goalie one.
    if (byName.citrusKey === 'games_played' && positionType === 'G') return { citrusKey: 'goalie_games_played', group: 'goalie', provenance: 'name', known: true };
    return { ...byName, known: true };
  }
  const byId = YAHOO_STAT_MAP[statId];
  if (byId) return { ...byId, known: true };
  return { citrusKey: `unknown_yahoo_${statId}`, group: positionType === 'G' ? 'goalie' : 'skater', provenance: 'name', known: false };
}

/** Yahoo scoring_type -> ImportedScoringType. */
export const YAHOO_SCORING_TYPE: Record<string, 'h2h_categories' | 'h2h_points' | 'h2h_one_win' | 'roto' | 'points'> = {
  head: 'h2h_categories',
  headpoint: 'h2h_points',
  headone: 'h2h_one_win',
  roto: 'roto',
  point: 'points',
};

/** Roster position names Yahoo uses, normalised to Citrus slot names. */
export function yahooSlot(position: string): string {
  const p = position.trim().toUpperCase();
  switch (p) {
    case 'C': case 'LW': case 'RW': case 'D': case 'G': case 'F': case 'W': case 'UTIL': case 'BN': case 'IR': return p;
    case 'IR+': return 'IR';
    case 'NA': return 'NA';
    default: return p;
  }
}

/** Yahoo's league key from the underscore form used in renew/renewed. */
export function renewToLeagueKey(renew: string | null | undefined): string | null {
  const s = (renew ?? '').trim();
  const m = s.match(/^(\d+)_(\d+)$/);
  return m ? `${m[1]}.l.${m[2]}` : null;
}

/** "{game}.l.{league}" -> its parts. */
export function splitLeagueKey(leagueKey: string): { gameId: string; leagueId: string } | null {
  const m = leagueKey.trim().match(/^(\d+)\.l\.(\d+)$/);
  return m ? { gameId: m[1], leagueId: m[2] } : null;
}
