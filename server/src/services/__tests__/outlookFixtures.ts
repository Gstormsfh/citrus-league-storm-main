import type { DashboardIndexEntry } from '@citrus/shared';
export const outlookEntry = (overrides: Partial<DashboardIndexEntry> = {}): DashboardIndexEntry => ({
 id: 1000, name: 'Sample Forward', position: 'C', team: 'TOR', is_goalie: false,
 actuals_season: 2025, projection_season: 2026, gp: 80, goals: 30, assists: 60, points: 90, sog: 240,
 proj_gp: 80, proj_goals: 35, proj_assists: 80, proj_sog: 280, proj_ppp: 30, proj_hits: 30, proj_blocks: 30,
 as_of: '2026-09-12T00:00:00Z', ...overrides,
} as DashboardIndexEntry);
export const fromRos = (r: Record<string, any>) => outlookEntry({ id:r.player_id,name:r.player_name,position:r.position??'C',is_goalie:r.is_goalie,
 proj_gp:r.games_remaining,proj_goals:r.projected_goals,proj_assists:r.projected_assists,proj_sog:r.projected_sog,
 proj_ppp:r.projected_ppp,proj_hits:r.projected_hits,proj_blocks:r.projected_blocks,proj_wins:r.projected_wins_ros,proj_saves:r.projected_saves_ros });
