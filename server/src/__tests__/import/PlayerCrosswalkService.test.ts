import { describe, it, expect, vi, beforeEach } from 'vitest';
import { matchAgainstDirectory, PlayerCrosswalkService, type DirectoryRow } from '../../services/import/PlayerCrosswalkService';
import { createChain } from '../helpers';
import { FakeSupabase } from './fakeSupabase';

const dir: DirectoryRow[] = [
  { player_id: 8478402, full_name: 'Connor McDavid', team_abbrev: 'EDM', jersey_number: '97', position_code: 'C' },
  { player_id: 8478427, full_name: 'Sebastian Aho', team_abbrev: 'CAR', jersey_number: '20', position_code: 'C' },
  { player_id: 8480222, full_name: 'Sebastian Aho', team_abbrev: 'NYI', jersey_number: '25', position_code: 'D' },
  { player_id: 8482116, full_name: 'Emil Andrae', team_abbrev: 'PHI', jersey_number: '36', position_code: 'D' },
  { player_id: 8476468, full_name: 'J.T. Miller', team_abbrev: 'NYR', jersey_number: '8', position_code: 'C' },
];

describe('matchAgainstDirectory ladder', () => {
  it('exact: name + team + number', () => {
    const r = matchAgainstDirectory({ externalPlayerId: '3895074', name: 'Connor McDavid', teamAbbr: 'EDM', jerseyNumber: '97', position: 'C' }, dir);
    expect(r.nhlPlayerId).toBe(8478402);
    expect(r.matchMethod).toBe('exact_name_team_number');
    expect(r.confidence).toBe(0.98);
    expect(r.isAmbiguous).toBe(false);
  });

  it('name + team when the number is missing', () => {
    const r = matchAgainstDirectory({ externalPlayerId: 'x', name: 'Connor McDavid', teamAbbr: 'EDM', jerseyNumber: null, position: null }, dir);
    expect(r.matchMethod).toBe('name_team');
    expect(r.confidence).toBe(0.9);
  });

  it('name only when it is the only candidate', () => {
    const r = matchAgainstDirectory({ externalPlayerId: 'x', name: 'JT Miller', teamAbbr: null, jerseyNumber: null, position: null }, dir);
    expect(r.nhlPlayerId).toBe(8476468);
    expect(r.matchMethod).toBe('name_only');
    expect(r.confidence).toBe(0.7);
  });

  it('two Sebastian Ahos: team disambiguates', () => {
    const car = matchAgainstDirectory({ externalPlayerId: 'a', name: 'Sebastian Aho', teamAbbr: 'CAR', jerseyNumber: null, position: null }, dir);
    const nyi = matchAgainstDirectory({ externalPlayerId: 'b', name: 'Sebastian Aho', teamAbbr: 'NYI', jerseyNumber: null, position: null }, dir);
    expect(car.nhlPlayerId).toBe(8478427);
    expect(nyi.nhlPlayerId).toBe(8480222);
  });

  it('two Sebastian Ahos with no team: flagged ambiguous, never guessed', () => {
    const r = matchAgainstDirectory({ externalPlayerId: 'x', name: 'Sebastian Aho', teamAbbr: null, jerseyNumber: null, position: null }, dir);
    expect(r.nhlPlayerId).toBeNull();
    expect(r.isAmbiguous).toBe(true);
    expect(r.candidates.sort()).toEqual([8478427, 8480222].sort());
    expect(r.matchMethod).toBe('unmatched');
  });

  it('a corrupted first name does not match the real player', () => {
    const r = matchAgainstDirectory({ externalPlayerId: 'x', name: 'Simon Andrae', teamAbbr: 'PHI', jerseyNumber: '36', position: 'D' }, dir);
    expect(r.nhlPlayerId).toBeNull();
    expect(r.matchMethod).toBe('unmatched');
  });

  it('empty name never matches', () => {
    const r = matchAgainstDirectory({ externalPlayerId: '5', name: '', teamAbbr: 'EDM', jerseyNumber: '97', position: null }, dir);
    expect(r.matchMethod).toBe('unmatched');
  });

  it('wrong number with right team falls to name_team, not exact', () => {
    const r = matchAgainstDirectory({ externalPlayerId: 'x', name: 'Connor McDavid', teamAbbr: 'EDM', jerseyNumber: '11', position: null }, dir);
    expect(r.matchMethod).toBe('name_team');
  });
});

describe('PlayerCrosswalkService', () => {
  let supabase: any;
  let service: PlayerCrosswalkService;

  beforeEach(() => {
    supabase = { from: vi.fn() };
    service = new PlayerCrosswalkService(supabase);
  });

  it('returns known ids without touching the directory', async () => {
    const known = createChain({ data: [{ external_player_id: '3895074', nhl_player_id: 8478402, match_method: 'manual', confidence: 1, is_ambiguous: false }], error: null });
    supabase.from.mockImplementation((t: string) => { if (t === 'external_player_ids') return known; throw new Error(`unexpected table ${t}`); });
    const res = await service.resolve('espn', [{ externalPlayerId: '3895074', name: 'Connor McDavid', teamAbbr: 'EDM', jerseyNumber: '97', position: 'C' }], 2025);
    expect(res.get('3895074')?.nhlPlayerId).toBe(8478402);
    expect(res.get('3895074')?.matchMethod).toBe('manual');
    expect(supabase.from).not.toHaveBeenCalledWith('player_directory');
  });

  it('matches unknown ids against the season directory and persists every outcome', async () => {
    const known = createChain({ data: [], error: null });
    const directory = createChain({ data: dir, error: null });
    const upsert = createChain({ data: null, error: null });
    supabase.from.mockImplementation((t: string) => {
      if (t === 'external_player_ids') return supabase.from.mock.calls.filter((c: string[]) => c[0] === 'external_player_ids').length <= 1 ? known : upsert;
      if (t === 'player_directory') return directory;
      throw new Error(`unexpected table ${t}`);
    });
    const res = await service.resolve('espn', [
      { externalPlayerId: '1', name: 'Connor McDavid', teamAbbr: 'EDM', jerseyNumber: '97', position: 'C' },
      { externalPlayerId: '2', name: 'Sebastian Aho', teamAbbr: null, jerseyNumber: null, position: null },
    ], 2025);
    expect(res.get('1')?.nhlPlayerId).toBe(8478402);
    expect(res.get('2')?.isAmbiguous).toBe(true);
    expect(upsert.upsert).toHaveBeenCalledTimes(1);
    const rows = upsert.upsert.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    expect(rows.find((r: any) => r.external_player_id === '2').is_ambiguous).toBe(true);
    expect(rows.find((r: any) => r.external_player_id === '2').nhl_player_id).toBeNull();
  });

  it('surfaces a directory read failure instead of silently matching nothing', async () => {
    supabase.from.mockImplementation((t: string) => {
      if (t === 'external_player_ids') return createChain({ data: [], error: null });
      return createChain({ data: null, error: { message: 'boom' } });
    });
    await expect(service.resolve('espn', [{ externalPlayerId: '1', name: 'X Y', teamAbbr: null, jerseyNumber: null, position: null }], 2025)).rejects.toThrow(/player_directory read failed/);
  });

  it('a season the directory does not carry falls back to the newest season it has', async () => {
    const fake = new FakeSupabase({
      player_directory: [
        { season: 2025, player_id: 8478402, full_name: 'Connor McDavid', team_abbrev: 'EDM', jersey_number: '97', position_code: 'C' },
        { season: 2025, player_id: 8471214, full_name: 'Alex Ovechkin', team_abbrev: 'WSH', jersey_number: '8', position_code: 'LW' },
      ],
    });
    const svc = new PlayerCrosswalkService(fake as any);
    const res = await svc.resolve('espn', [
      { externalPlayerId: '1', name: 'Connor McDavid', teamAbbr: 'EDM', jerseyNumber: '97', position: 'C' },
      { externalPlayerId: '2', name: 'Alex Ovechkin', teamAbbr: 'WSH', jerseyNumber: '8', position: 'LW' },
      { externalPlayerId: '3', name: 'Jarome Iginla', teamAbbr: 'CGY', jerseyNumber: '12', position: 'RW' }, // retired: not in the current directory
    ], 2015);
    expect(res.get('1')).toMatchObject({ nhlPlayerId: 8478402, matchMethod: 'exact_name_team_number' });
    expect(res.get('2')?.nhlPlayerId).toBe(8471214);
    expect(res.get('3')).toMatchObject({ nhlPlayerId: null, matchMethod: 'unmatched', isAmbiguous: false });
    // The unmatched row keeps the name so the commissioner can resolve it later.
    expect(fake.rows('external_player_ids').find((r) => r.external_player_id === '3')).toMatchObject({ external_name: 'Jarome Iginla', external_team_abbr: 'CGY', first_seen_season: 2015 });
  });

  it('a player who changed clubs since still matches on name alone', async () => {
    const fake = new FakeSupabase({
      player_directory: [{ season: 2025, player_id: 8477492, full_name: 'Nathan MacKinnon', team_abbrev: 'COL', jersey_number: '29', position_code: 'C' }],
    });
    const svc = new PlayerCrosswalkService(fake as any);
    const res = await svc.resolve('yahoo', [{ externalPlayerId: '6234', name: 'Nathan MacKinnon', teamAbbr: 'TOR', jerseyNumber: '29', position: 'C' }], 2016);
    expect(res.get('6234')).toMatchObject({ nhlPlayerId: 8477492, matchMethod: 'name_only', confidence: 0.7 });
  });

  it('reads the directory once per season per instance', async () => {
    const fake = new FakeSupabase({ player_directory: [{ season: 2025, player_id: 1, full_name: 'A B', team_abbrev: 'BOS', jersey_number: '1', position_code: 'C' }] });
    const svc = new PlayerCrosswalkService(fake as any);
    await svc.resolve('espn', [{ externalPlayerId: '1', name: 'A B', teamAbbr: null, jerseyNumber: null, position: null }], 2014);
    await svc.resolve('espn', [{ externalPlayerId: '2', name: 'C D', teamAbbr: null, jerseyNumber: null, position: null }], 2014);
    await svc.resolve('espn', [{ externalPlayerId: '3', name: 'E F', teamAbbr: null, jerseyNumber: null, position: null }], 2025);
    // 2014: season read (empty) + newest-season probe + 2025 read; 2014 again: cached; 2025: cached from the fallback.
    expect(fake.opsFor('player_directory', 'select')).toHaveLength(3);
  });

  it('manual resolution writes match_method manual with confidence 1', async () => {
    const chain = createChain({ data: null, error: null });
    supabase.from.mockReturnValue(chain);
    await service.resolveManually('yahoo', '6743', 8478402, 'user-1');
    expect(chain.upsert).toHaveBeenCalledWith(expect.objectContaining({ platform: 'yahoo', external_player_id: '6743', nhl_player_id: 8478402, match_method: 'manual', confidence: 1, resolved_by: 'user-1' }), expect.anything());
  });
});
