/**
 * The demo league's snake-draft simulation (LeagueService.initializeLeague)
 * must terminate on a realistic player pool. Desktop QA, 2026-09-18: three
 * of four loads of /trade-analyzer for a signed-in manager froze the tab
 * for good. The page runs the demo path before LeagueContext has said
 * which league is active, and the simulation's `while (true)` had no exit
 * once every team sat at 20 players: a roster that reaches the position
 * minimums lands on exactly 20, is then skipped for being "complete and
 * near max", never reaches the 21 the loop waits for, and the pool of a
 * thousand players never empties.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/api/leagues', () => ({ leagueApi: {} }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('@/services/LineupService', () => ({ LineupService: new Proxy({}, { get: () => vi.fn().mockResolvedValue(undefined) }) }));

import { LeagueService } from '../LeagueService';
import type { Player } from '../PlayerService';

function pool(n: number): Player[] {
  const positions = ['C', 'C', 'LW', 'LW', 'RW', 'RW', 'D', 'D', 'D', 'G'];
  return Array.from({ length: n }, (_, i) => ({
    id: String(100000 + i), full_name: `Player ${i}`, position: positions[i % positions.length],
    eligible_positions: [positions[i % positions.length]], team: 'EDM', jersey_number: null, status: null,
    headshot_url: null, last_updated: null, games_played: 82, goals: (n - i) % 50, assists: (n - i) % 70,
    points: n - i, plus_minus: 0, shots: 100, hits: 10, blocks: 10, xGoals: 10, wins: 20, losses: 10,
    ot_losses: 3, saves: 1500, goals_against_average: 2.5, save_percentage: 0.91, highDangerSavePct: 0,
    goalsSavedAboveExpected: 0,
  })) as unknown as Player[];
}

describe('LeagueService.initializeLeague (demo draft)', () => {
  it('terminates on a thousand-player pool and fills ten rosters', async () => {
    const players = pool(1100);
    const started = Date.now();
    await Promise.race([
      LeagueService.initializeLeague(players),
      new Promise((_, reject) => setTimeout(() => reject(new Error('initializeLeague did not finish in 5s')), 5000)),
    ]);
    expect(Date.now() - started).toBeLessThan(5000);
    const teams = await LeagueService.getAllTeamsWithRosters(players);
    expect(teams).toHaveLength(10);
    for (const t of teams) {
      expect(t.roster.length).toBeGreaterThanOrEqual(20);
      expect(t.roster.length).toBeLessThanOrEqual(21);
      expect(t.roster.filter((p) => p.position === 'G')).toHaveLength(3);
    }
  }, 10000);
});
