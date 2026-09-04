import { apiClient } from '@/api/client';
import { leagueApi } from '@/api/leagues';
import { rosterApi } from '@/api/rosters';
import { getCurrentSeason, getProjectionsSeason } from '@/utils/seasonConstants';
import { logger } from '@/utils/logger';

/**
 * Get weekly projected fantasy points for players
 * Queries player_projected_stats table for all days in the week
 * Returns a map of playerId -> total weekly projected points
 */
export async function getWeeklyProjections(
  playerIds: number[],
  weekStart: Date,
  weekEnd: Date
): Promise<Map<number, number>> {
  if (!playerIds || playerIds.length === 0) {
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

    // Sum projections per player across all days
    const weeklyTotals = new Map<number, number>();

    ((data || []) as Record<string, unknown>[]).forEach((projection) => {
      const playerId = Number(projection.player_id);
      const points = Number(projection.total_projected_points) || 0;
      const current = weeklyTotals.get(playerId) || 0;
      weeklyTotals.set(playerId, current + points);
    });

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

    // Get weekly projections for all players
    const weeklyProjections = await getWeeklyProjections(
      Array.from(allPlayerIds),
      weekStart,
      weekEnd
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

      const projectedPoints = weeklyProjections.get(playerId) || 0;
      const current = positionTotals.get(normalizedPos) || { total: 0, count: 0 };
      positionTotals.set(normalizedPos, {
        total: current.total + projectedPoints,
        count: current.count + 1
      });
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
