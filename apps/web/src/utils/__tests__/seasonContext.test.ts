import { afterEach, describe, expect, it, vi } from 'vitest';
import { actualsCohortLabel, actualsSeasonLabel, dataSeasonLabel } from '@citrus/shared';
import { servicePlayerToHockeyPlayer } from '../playerStatsHelper';
import { dashboardEntryToHockeyPlayer } from '@/components/players/playersBrowse';
import type { Player } from '@/services/PlayerService';
import type { DashboardIndexEntry } from '@citrus/shared';
vi.mock('@/services/PlayerService', () => ({ PlayerService: {} }));

afterEach(() => vi.useRealTimers());
describe('source season context across rollover', () => {
  it.each(['2026-09-12', '2026-10-30', '2027-09-12'])('keeps cached 2025 actuals dated under %s', date => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(date));
    expect(actualsSeasonLabel(2025)).toBe('2025-26 actuals');
    expect(dataSeasonLabel(2026)).toBe('2026-27');
  });
  it('keeps missing data distinct from a real zero-appearance season', () => {
    expect(actualsSeasonLabel(null)).toBe('Actuals (season unavailable)');
    expect(actualsSeasonLabel(undefined)).toBe('Actuals (season unavailable)');
    const zero = servicePlayerToHockeyPlayer({ id: '1', stats_season: 2025, position: 'G', games_played: 0 } as Player);
    expect(zero.statsSeason).toBe(2025);
    expect(zero.stats.gamesPlayed).toBe(0);
  });
  it('preserves independent actual and forecast years through both card adapters', () => {
    expect(servicePlayerToHockeyPlayer({ id: '1', stats_season: 2025 } as Player).statsSeason).toBe(2025);
    expect(dashboardEntryToHockeyPlayer({ id: 1, actuals_season: 2024, projection_season: 2026 } as DashboardIndexEntry).statsSeason).toBe(2024);
    expect(actualsCohortLabel([2024, 2025, 2025])).toBe('2024-25, 2025-26 actuals');
  });
});
