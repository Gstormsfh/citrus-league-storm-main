import { supabase } from '@/integrations/supabase/client';

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
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 1);
    }

    // Query projections for all days in the week
    const { data, error } = await supabase
      .from('player_projected_stats')
      .select('player_id, total_projected_points, projection_date')
      .in('player_id', playerIds)
      .in('projection_date', dates)
      .eq('season', 2025);

    if (error) {
      console.error('Error fetching weekly projections:', error);
      return new Map();
    }

    // Sum projections per player across all days
    const weeklyTotals = new Map<number, number>();
    
    (data || []).forEach((projection: any) => {
      const playerId = Number(projection.player_id);
      const points = Number(projection.total_projected_points) || 0;
      const current = weeklyTotals.get(playerId) || 0;
      weeklyTotals.set(playerId, current + points);
    });

    return weeklyTotals;
  } catch (error) {
    console.error('Error in getWeeklyProjections:', error);
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
    const { data: teams, error: teamsError } = await supabase
      .from('teams')
      .select('id')
      .eq('league_id', leagueId);

    if (teamsError || !teams || teams.length === 0) {
      return new Map();
    }

    // Get all roster players from all teams
    const { data: lineups, error: lineupsError } = await supabase
      .from('team_lineups')
      .select('starters, bench')
      .eq('league_id', leagueId);

    if (lineupsError || !lineups) {
      return new Map();
    }

    // Collect all player IDs
    const allPlayerIds = new Set<number>();
    lineups.forEach(lineup => {
      const starters = (lineup.starters as any[]) || [];
      const bench = (lineup.bench as any[]) || [];
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

    // Get player positions to group by position
    const { data: players, error: playersError } = await supabase
      .from('player_directory')
      .select('player_id, position_code')
      .eq('season', 2025)
      .in('player_id', Array.from(allPlayerIds));

    if (playersError || !players) {
      return new Map();
    }

    // Group projections by position and calculate average
    const positionTotals = new Map<string, { total: number; count: number }>();
    
    players.forEach((player: any) => {
      const playerId = Number(player.player_id);
      const position = player.position_code || '';
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
    console.error('Error in getLeagueAverageProjections:', error);
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
