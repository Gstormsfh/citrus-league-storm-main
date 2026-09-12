/** Canonical ROS totals already include remaining player exposure. Never scale again. */
export interface RosterRosStats {
  gamesPlayed?: number;
  goals?: number;
  assists?: number;
  points?: number;
  shots?: number;
  blockedShots?: number;
  plusMinus?: number;
  powerPlayPoints?: number;
  shortHandedPoints?: number;
  hits?: number;
  pim?: number;
  wins?: number;
  saves?: number;
  goalsAgainst?: number;
  shutouts?: number;
}

function finite(value: unknown): number | undefined {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return undefined;
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function rosterRosStats(row: Record<string, unknown>): RosterRosStats {
  const goals = finite(row.projected_goals);
  const assists = finite(row.projected_assists);
  return {
    gamesPlayed: finite(row.games_remaining), goals, assists,
    points: goals === undefined || assists === undefined ? undefined : goals + assists,
    shots: finite(row.projected_sog), blockedShots: finite(row.projected_blocks),
    plusMinus: finite(row.projected_plus_minus), powerPlayPoints: finite(row.projected_ppp),
    shortHandedPoints: finite(row.projected_shp), hits: finite(row.projected_hits),
    pim: finite(row.projected_pim), wins: finite(row.projected_wins_ros),
    saves: finite(row.projected_saves_ros), goalsAgainst: finite(row.projected_ga_ros),
    shutouts: finite(row.projected_shutouts_ros),
  };
}

export function indexRosterRosStats(rows: readonly Record<string, unknown>[]): Map<number, RosterRosStats> {
  const result = new Map<number, RosterRosStats>();
  for (const row of rows) {
    const id = finite(row.player_id);
    if (id !== undefined && Number.isSafeInteger(id) && id > 0) result.set(id, rosterRosStats(row));
  }
  return result;
}

/** Round only for display; unknown forecast values are not zero forecasts. */
export function formatRosCount(value: number | undefined): string {
  return value === undefined ? '—' : Math.round(value).toString();
}
