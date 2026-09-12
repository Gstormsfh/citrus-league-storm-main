import { describe, expect, it, vi } from 'vitest';
import type { DashboardIndexEntry } from '@citrus/shared';
vi.mock('../usePlayerDashboardIndex', () => ({ usePlayerDashboardIndex: vi.fn() }));
import { dashboardEntryToPreloadedPlayer } from '../usePreloadedPlayers';

describe('V2 measured production mapping', () => {
  it('preserves xG, time on ice and peripheral categories from the canonical dashboard reader', () => {
    const player = dashboardEntryToPreloadedPlayer({ id: 1, name: 'Player', position: 'LW', team: 'EDM',
      is_goalie: false, gp: 70, x_goals: 36.47, toi_seconds: 84000, pim: 50, shp: 3, ppp: 15,
      hits: 125, blocks: 35, actuals_season: 2025, proj_goals: 100 } as DashboardIndexEntry);
    expect(player).toMatchObject({ xGoals: 36.47, icetime_seconds: 84000, pim: 50,
      shp: 3, ppp: 15, hits: 125, blocks: 35, stats_season: 2025 });
  });
  it('retains a real measured zero xG rather than replacing it with projected production', () => {
    const player = dashboardEntryToPreloadedPlayer({ id: 1, name: 'Player', position: 'C', team: 'EDM',
      is_goalie: false, x_goals: 0, toi_seconds: 0, actuals_season: 2025, proj_goals: 100 } as DashboardIndexEntry);
    expect(player.xGoals).toBe(0);
    expect(player.icetime_seconds).toBe(0);
  });
});
