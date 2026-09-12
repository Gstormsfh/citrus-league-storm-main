import { playerApi } from '@/api/players';
import { ScheduleService } from '@/services/ScheduleService';
import { apiClient } from '@/api/client';
import { leagueApi } from '@/api/leagues';
import { rosterApi } from '@/api/rosters';
import { getCurrentSeason, getProjectionsSeason } from '@/utils/seasonConstants';
import { logger } from '@/utils/logger';
import { ScoringCalculator } from '@citrus/shared';
import { expectedDailyProjection, projectionSettings } from '@citrus/shared/leagueProjection';

/**
 * Get weekly projected fantasy points for players
 * Queries player_projected_stats table for all days in the week
 * Returns a map of playerId -> total weekly projected points
 */
export async function getWeeklyProjections(
  playerIds: number[],
  weekStart: Date,
  weekEnd: Date,
  /** Required loaded league scorer; absent scoring cannot produce fantasy points. */
  scorer?: ScoringCalculator,
): Promise<Map<number, number>> {
  if (!scorer || !playerIds || playerIds.length === 0) {
    return new Map();
  }

  try {
    // Generate all dates in the week
    const dates: string[] = [];
    const current = new Date(weekStart);
    while (current <= weekEnd) {
      // Use local date formatting to avoid UTC shift (toISOString converts to UTC first)
      const y = current.getFullYear();
      const m = String(current.getMonth() + 1).padStart(2, '0');
      const d = String(current.getDate()).padStart(2, '0');
      dates.push(`${y}-${m}-${d}`);
      current.setDate(current.getDate() + 1);
    }

    // Query projections via API client
    const startDate = dates[0];
    const endDate = dates[dates.length - 1];
    // PROJECTIONS ARE KEYED TO THE SEASON THEY DESCRIBE (2026-09-04).
    //
    // This asked for `getCurrentSeason()` - the season being PLAYED - while
    // `player_projected_stats` stores rows under the season they describe.
    // Measured on production 2026-09-04: 66,024 rows for season 2026 running
    // 2026-09-29 to 2027-04-10, and 72,060 rows for season 2025 that are
    // entirely in the past. So all summer this asked for the OLD season's
    // projections. Not zero rows, which would have been obvious - a full set
    // of stale ones.
    //
    // Same distinction the Player Stats modal now draws: schedule and
    // projections look forward, season stats and advanced metrics look back.
    // The directory read below is deliberately NOT changed: it is a positions
    // lookup, and 2025 is the season with full coverage (1,089 rows to 820).
    const { data } = await apiClient.get(
      `/api/players/projections/batch?ids=${playerIds.join(',')}&startDate=${startDate}&endDate=${endDate}&season=${getProjectionsSeason()}`
    );

    if (!Array.isArray(data)) return new Map();
    const directory = await playerApi.getPlayersByIds(playerIds.map(String));
    if (!Array.isArray(directory.data)) return new Map();
    const identities = new Map<number, { team: string; goalie: boolean }>();
    const ambiguous = new Set<number>();
    for (const player of directory.data as Array<{ id: number; team?: string; position?: string; is_goalie?: boolean }>) {
      const id = Number(player.id);
      if (identities.has(id)) ambiguous.add(id);
      if (player.team) identities.set(id, { team: player.team.toUpperCase(), goalie: player.is_goalie === true || player.position === 'G' });
    }
    const schedule = await ScheduleService.getGamesForTeams([...new Set([...identities.values()].map(p => p.team))], weekStart, weekEnd);
    if (schedule.error) return new Map();
    const weeklyTotals = new Map<number, number>();
    for (const id of new Set(playerIds)) {
      const identity = identities.get(id);
      if (!identity || ambiguous.has(id)) continue;
      const games = schedule.gamesByTeam.get(identity.team);
      if (!games) continue;
      const scheduledDates = new Set(games.filter(game => game.status !== 'postponed')
        .map(game => game.game_date.slice(0, 10)).filter(date => date >= startDate && date <= endDate));
      const rows = (data as Record<string, unknown>[]).filter(row => Number(row.player_id) === id);
      let total = 0;
      let complete = true;
      for (const date of scheduledDates) {
        const day = rows.filter(row => String(row.projection_date).slice(0, 10) === date);
        if (day.length !== 1) { complete = false; break; }
        const expected = expectedDailyProjection(day[0], scorer.getSettings(), identity.goalie);
        if (!expected) { complete = false; break; }
        total += expected.total_projected_points;
      }
      if (complete) weeklyTotals.set(id, total);
    }
    return weeklyTotals;
  } catch (error) {
    logger.error('Error in getWeeklyProjections:', error);
    return new Map();
  }
}

/**
 * Get league average projected points per position
 * Queries all teams in the league and calculates average
 */
export async function getLeagueAverageProjections(
  leagueId: string,
  weekStart: Date,
  weekEnd: Date
): Promise<Map<string, number>> {
  try {
    // Get all teams in the league
    const { data: teams } = await leagueApi.getTeams(leagueId);

    if (!teams || (teams as any[]).length === 0) {
      return new Map();
    }

    // Get all roster players from all teams via league rosters
    const { data: lineups } = await rosterApi.getLeagueRosters(leagueId);

    if (!lineups) {
      return new Map();
    }

    // Collect all player IDs
    const allPlayerIds = new Set<number>();
    ((lineups as any[]) || []).forEach(lineup => {
      const starters = (lineup.starters as unknown[]) || [];
      const bench = (lineup.bench as unknown[]) || [];
      [...starters, ...bench].forEach(id => {
        if (id) allPlayerIds.add(Number(id));
      });
    });

    if (allPlayerIds.size === 0) {
      return new Map();
    }

    const { data: league } = await leagueApi.getLeague(leagueId) as { data?: { scoring_settings?: unknown } };
    if (!league || !('scoring_settings' in league)) return new Map();
    // Explicitly loaded persisted rules; no stored/default total fallback.
    const weeklyProjections = await getWeeklyProjections(
      Array.from(allPlayerIds),
      weekStart,
      weekEnd,
      new ScoringCalculator(projectionSettings(league.scoring_settings))
    );

    // Get player positions to group by position via API client
    const playerIdsArray = Array.from(allPlayerIds);
    const { data: players } = await apiClient.get(
      `/api/players/directory?ids=${playerIdsArray.join(',')}&season=${getCurrentSeason()}`
    );

    if (!players) {
      return new Map();
    }

    // Group projections by position and calculate average
    const positionTotals = new Map<string, { total: number; count: number }>();

    ((players as Record<string, unknown>[]) || []).forEach((player) => {
      const playerId = Number(player.player_id);
      const position = String(player.position_code || '');
      const normalizedPos = normalizePosition(position);

      if (!normalizedPos) return;

      const projectedPoints = weeklyProjections.get(playerId);
      if (projectedPoints == null) return;
      const current = positionTotals.get(normalizedPos) || { total: 0, count: 0 };
      positionTotals.set(normalizedPos, {
        total: current.total + projectedPoints,
        count: current.count + 1
      });
      // F/D/G leagues grade forwards as one group, so the map also carries
      // an 'F' average over every C, LW and RW (per player, like the rest).
      if (normalizedPos === 'C' || normalizedPos === 'LW' || normalizedPos === 'RW') {
        const fwd = positionTotals.get('F') || { total: 0, count: 0 };
        positionTotals.set('F', { total: fwd.total + projectedPoints, count: fwd.count + 1 });
      }
    });

    // Calculate averages
    const averages = new Map<string, number>();
    positionTotals.forEach((value, position) => {
      const avg = value.count > 0 ? value.total / value.count : 0;
      averages.set(position, avg);
    });

    return averages;
  } catch (error) {
    logger.error('Error in getLeagueAverageProjections:', error);
    return new Map();
  }
}

// Normalize position (L -> LW, R -> RW)
function normalizePosition(pos: string): string {
  if (!pos) return '';
  const upper = pos.toUpperCase();
  if (upper === 'L' || upper === 'LEFT' || upper === 'LEFTWING') return 'LW';
  if (upper === 'R' || upper === 'RIGHT' || upper === 'RIGHTWING') return 'RW';
  if (upper.includes('C') && !upper.includes('LW') && !upper.includes('RW')) return 'C';
  if (upper.includes('D')) return 'D';
  if (upper.includes('G')) return 'G';
  return '';
}
