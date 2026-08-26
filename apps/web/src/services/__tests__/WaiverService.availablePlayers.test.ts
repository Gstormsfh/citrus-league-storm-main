// WAIVER WIRE (2026-08-26) — reported as "Waivers tab looks uggggly as fuck".
//
// Two of the reasons it looked that way were not styling.
//
// 1. THE ROWS HAD NOTHING IN THEM. getAvailablePlayers received the full player
//    object from PlayerService — points, games played, wins, save percentage,
//    all already in memory — and mapped it down to six identity fields. The
//    page then rendered a list of names with no production, so a manager had to
//    leave the waiver wire to decide who to claim on the waiver wire.
//
// 2. IT WAS SORTED ALPHABETICALLY AND CUT AT 50. The wire opened on whoever was
//    early in the alphabet and hid everyone past the fiftieth. Nobody scans a
//    waiver wire by surname.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getAllPlayers = vi.fn();
const getLeagueWaivers = vi.fn();

vi.mock('../PlayerService', () => ({ PlayerService: { getAllPlayers: () => getAllPlayers() } }));
vi.mock('@/api/waivers', () => ({ waiverApi: { getLeagueWaivers: () => getLeagueWaivers() } }));
vi.mock('@/api/account', () => ({ accountApi: {} }));
vi.mock('@/api/client', () => ({ apiClient: {} }));
vi.mock('@/utils/logger', () => ({ logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { WaiverService } from '../WaiverService';

const skater = (name: string, points: number, gp = 60) => ({
  id: String(Math.abs(points) + name.length * 1000),
  full_name: name, position: 'C', team: 'COL', jersey_number: '29',
  points, goals: Math.round(points / 3), assists: points - Math.round(points / 3),
  games_played: gp, wins: null, losses: null, shutouts: null,
  save_percentage: null, goals_against_average: null,
});

const goalie = (name: string, wins: number) => ({
  id: String(9000 + wins), full_name: name, position: 'G', team: 'TBL', jersey_number: '88',
  points: 0, goals: 0, assists: 0,
  games_played: 75,        // games DRESSED
  goalie_gp: 58,           // games PLAYED — what a card must show
  wins, losses: 15, shutouts: 2, save_percentage: 0.912, goals_against_average: 2.31,
});

beforeEach(() => {
  vi.clearAllMocks();
  getLeagueWaivers.mockResolvedValue({ data: null });
});

describe('WaiverService.getAvailablePlayers', () => {
  it('carries production through instead of dropping it', async () => {
    getAllPlayers.mockResolvedValue([skater('Nathan MacKinnon', 92, 78)]);
    const [row] = await WaiverService.getAvailablePlayers('league-1');

    expect(row.full_name).toBe('Nathan MacKinnon');
    expect(row.points).toBe(92);
    expect(row.games_played).toBe(78);
    expect(row.goals).toBeGreaterThan(0);
    expect(row.assists).toBeGreaterThan(0);
  });

  it('carries the goalie line, and gives a goalie his appearances', async () => {
    // goalie_gp, not games_played: the latter counts nights dressed.
    getAllPlayers.mockResolvedValue([goalie('Andrei Vasilevskiy', 39)]);
    const [row] = await WaiverService.getAvailablePlayers('league-1');

    expect(row.is_goalie).toBe(true);
    expect(row.wins).toBe(39);
    expect(row.save_percentage).toBeCloseTo(0.912);
    expect(row.goals_against_average).toBeCloseTo(2.31);
    expect(row.games_played).toBe(58);
  });

  it('puts the best available first, not the alphabetically first', async () => {
    getAllPlayers.mockResolvedValue([
      skater('Aaron Anderson', 8),
      skater('Zach Zimmer', 91),
      skater('Mid Midson', 44),
    ]);
    const rows = await WaiverService.getAvailablePlayers('league-1');
    expect(rows.map((r: { full_name: string }) => r.full_name)).toEqual([
      'Zach Zimmer', 'Mid Midson', 'Aaron Anderson',
    ]);
  });

  it('ranks a goalie by wins, since his points are always zero', async () => {
    // Sorting goalies on `points` buries every one of them below every skater
    // who has ever recorded an assist.
    getAllPlayers.mockResolvedValue([skater('Fourth Liner', 12), goalie('Starting Goalie', 34)]);
    const rows = await WaiverService.getAvailablePlayers('league-1');
    expect(rows[0].full_name).toBe('Starting Goalie');
  });

  it('breaks ties by name so the order is stable', async () => {
    getAllPlayers.mockResolvedValue([skater('Bravo Player', 30), skater('Alpha Player', 30)]);
    const rows = await WaiverService.getAvailablePlayers('league-1');
    expect(rows.map((r: { full_name: string }) => r.full_name)).toEqual(['Alpha Player', 'Bravo Player']);
  });

  it('still filters out rostered players and honours the position filter', async () => {
    getAllPlayers.mockResolvedValue([
      skater('Rostered Guy', 80),
      skater('Available Guy', 70),
      goalie('Available Goalie', 20),
    ]);
    const rostered = String(Math.abs(80) + 'Rostered Guy'.length * 1000);
    getLeagueWaivers.mockResolvedValue({ data: { rosteredPlayerIds: [rostered] } });

    const all = await WaiverService.getAvailablePlayers('league-1');
    expect(all.map((r: { full_name: string }) => r.full_name)).not.toContain('Rostered Guy');

    const goalies = await WaiverService.getAvailablePlayers('league-1', 'G');
    expect(goalies).toHaveLength(1);
    expect(goalies[0].full_name).toBe('Available Goalie');
  });

  it('filters by search term', async () => {
    getAllPlayers.mockResolvedValue([skater('Connor McDavid', 100), skater('Cale Makar', 90)]);
    const rows = await WaiverService.getAvailablePlayers('league-1', undefined, 'makar');
    expect(rows).toHaveLength(1);
    expect(rows[0].full_name).toBe('Cale Makar');
  });
});
