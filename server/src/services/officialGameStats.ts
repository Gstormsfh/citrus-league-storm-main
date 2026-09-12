/** Official NHL boxscore columns only. A corrected official zero must stay zero. */
export const OFFICIAL_GAME_STAT_COLUMNS = {
  goals: 'nhl_goals', assists: 'nhl_assists', points: 'nhl_points', shots_on_goal: 'nhl_shots_on_goal',
  pim: 'nhl_pim', plus_minus: 'nhl_plus_minus', toi_seconds: 'nhl_toi_seconds', hits: 'nhl_hits', blocks: 'nhl_blocks',
  faceoff_wins: 'nhl_faceoff_wins', faceoff_losses: 'nhl_faceoff_losses', faceoff_taken: 'nhl_faceoff_taken',
  takeaways: 'nhl_takeaways', giveaways: 'nhl_giveaways', ppp: 'nhl_ppp', ppg: 'nhl_ppg', ppa: 'nhl_ppa',
  shp: 'nhl_shp', shg: 'nhl_shg', sha: 'nhl_sha', shots_missed: 'nhl_shots_missed', shots_blocked: 'nhl_shots_blocked',
  shot_attempts: 'nhl_shot_attempts', gwg: 'nhl_gwg', otg: 'nhl_otg', shifts: 'nhl_shifts',
  wins: 'nhl_wins', losses: 'nhl_losses', ot_losses: 'nhl_ot_losses', saves: 'nhl_saves', shots_faced: 'nhl_shots_faced',
  goals_against: 'nhl_goals_against', shutouts: 'nhl_shutouts', save_pct: 'nhl_save_pct',
  even_saves: 'nhl_even_saves', even_shots_against: 'nhl_even_shots_against', pp_saves: 'nhl_pp_saves',
  pp_shots_against: 'nhl_pp_shots_against', sh_saves: 'nhl_sh_saves', sh_shots_against: 'nhl_sh_shots_against',
} as const;
export const OFFICIAL_GAME_STAT_SELECT = ['player_id', 'game_id', 'is_goalie', ...Object.values(OFFICIAL_GAME_STAT_COLUMNS)].join(',');
export function officialGameStats(row: Record<string, unknown>): Record<string, unknown> {
  return { player_id: row.player_id, game_id: row.game_id, is_goalie: row.is_goalie,
    ...Object.fromEntries(Object.entries(OFFICIAL_GAME_STAT_COLUMNS).map(([name, column]) => {
      const value = row[column];
      const parsed = value == null ? null : Number(value);
      return [name, parsed !== null && Number.isFinite(parsed) ? parsed : null];
    })) };
}
