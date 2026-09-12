/**
 * `League setup:` tokens for Stormy's context block.
 *
 * Split out of StormyService so it can be imported — and tested — without
 * booting the Supabase client, which throws on a missing VITE_SUPABASE_URL.
 * StormyService re-exports it, so existing importers are unaffected.
 */

/**
 * `League setup:` — the configuration an assistant GM has to know before any
 * recommendation is worth anything.
 *
 * 2026-09-09, from stormy_chat_log: asked whether the league changes lineups
 * daily or weekly, Stormy answered "I don't have a league-configuration field
 * in your context", then cited a `[Tue,Thu,Sat]` token it had never been
 * given and had to be corrected. Both failures are this block's absence.
 * Waiver type, add limits, the trade deadline, keepers and best ball decide
 * whether a piece of advice is even legal in a league, and none of it was in
 * front of the model.
 *
 * Token rule as everywhere else in this file: a token is written only when
 * the value behind it is real, so a missing token reads as "not set" rather
 * than a zero that reads as a measurement.
 */
export function formatLeagueSetup(
  settings: Record<string, unknown> | null | undefined,
  rosterSlots?: Record<string, number> | null,
  leagueSize?: number | null,
): string {
  const s = settings ?? {};
  const str = (k: string): string | null => {
    const v = s[k];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  const num = (k: string): number | null => {
    const v = s[k];
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const on = (k: string): boolean => s[k] === true;

  const parts: string[] = [];
  const format = str('scoringFormat') ?? str('scoringType') ?? str('leagueType');
  if (format) parts.push(`Format:${format}`);
  const teams = leagueSize ?? num('teamsCount');
  if (teams) parts.push(`Teams:${teams}`);
  if (rosterSlots && Object.keys(rosterSlots).length > 0) {
    parts.push(`Roster:${Object.entries(rosterSlots).map(([slot, n]) => `${slot}${n}`).join('/')}`);
  }
  const weekStart = str('weekStartDay');
  if (weekStart) parts.push(`WeekStarts:${weekStart}`);
  const waiverType = str('waiver_type');
  if (waiverType) parts.push(`Waivers:${waiverType}`);
  const faab = num('faab_budget') ?? num('faabBudget');
  if (faab !== null) parts.push(`FAAB:${faab}`);
  const waiverHold = num('waiver_period_hours');
  if (waiverHold !== null) parts.push(`WaiverHold:${waiverHold}h`);
  const waiverRun = str('waiver_process_time');
  if (waiverRun) parts.push(`WaiverRun:${waiverRun}`);
  if (on('waiver_game_lock')) parts.push('WaiverGameLock:on');
  // 0 is unlimited on both add limits (types/leagueTypes.ts:256, the ESPN and
  // Yahoo convention), and every production league is sitting on that default.
  // `AddsPerWeek:0` would read as "he has no moves left", which is the exact
  // opposite, so the token says what the number means. Both spellings are
  // accepted because server/src/lib/leagueRules.ts accepts both.
  const weeklyAdds = num('weeklyAddLimit') ?? num('weekly_add_limit');
  if (weeklyAdds !== null) parts.push(`AddsPerWeek:${weeklyAdds > 0 ? weeklyAdds : 'unlimited'}`);
  const seasonAdds = num('seasonAddLimit') ?? num('season_add_limit');
  if (seasonAdds !== null) parts.push(`AddsPerSeason:${seasonAdds > 0 ? seasonAdds : 'unlimited'}`);
  // isPastTradeDeadline only enforces a week above zero, so zero is no
  // deadline at all rather than "the deadline was week zero".
  const deadline = num('tradeDeadlineWeek');
  if (deadline !== null) parts.push(deadline > 0 ? `TradeDeadline:wk${deadline}` : 'TradeDeadline:none');
  if (s['allow_trades_during_games'] === false) parts.push('TradesDuringGames:off');
  if (on('keeperEnabled')) {
    const count = num('keeperCount');
    parts.push(count !== null ? `Keepers:${count}` : 'Keepers:on');
    const penalty = str('keeperPenalty');
    if (penalty) parts.push(`KeeperPenalty:${penalty}`);
  }
  if (on('dynastyMode')) parts.push('Dynasty:on');
  if (on('bestBallEnabled')) parts.push('BestBall:on');
  const playoffTeams = num('playoffTeams') ?? num('playoff_teams');
  if (playoffTeams !== null) parts.push(`PlayoffTeams:${playoffTeams}`);
  const playoffWeeks = num('playoffWeeks');
  if (playoffWeeks !== null) parts.push(`PlayoffWeeks:${playoffWeeks}`);
  const minGoalieGames = num('minGoalieGames');
  if (minGoalieGames !== null) parts.push(`MinGoalieStarts:${minGoalieGames}`);

  return parts.join(' ');
}
