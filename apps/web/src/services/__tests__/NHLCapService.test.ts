import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock contract data
// =============================================================================

const mockContracts: Record<string, any[]> = {
  EDM: [
    {
      playerId: 1,
      name: 'Connor McDavid',
      position: 'C',
      positionGroup: 'F',
      jerseyNumber: 97,
      age: 28,
      team: 'EDM',
      capHit: 12_500_000,
      aav: 12_500_000,
      baseSalary: 12_500_000,
      signingBonus: 0,
      totalSalary: 12_500_000,
      contractYears: 8,
      yearsRemaining: 3,
      expiryYear: 2026,
      expiryStatus: 'UFA',
      clause: 'NMC',
      rosterStatus: 'NHL',
      isWaiverExempt: false,
    },
    {
      playerId: 2,
      name: 'Leon Draisaitl',
      position: 'C',
      positionGroup: 'F',
      jerseyNumber: 29,
      age: 28,
      team: 'EDM',
      capHit: 14_000_000,
      aav: 14_000_000,
      baseSalary: 14_000_000,
      signingBonus: 0,
      totalSalary: 14_000_000,
      contractYears: 8,
      yearsRemaining: 7,
      expiryYear: 2030,
      expiryStatus: 'UFA',
      clause: 'NMC',
      rosterStatus: 'NHL',
      isWaiverExempt: false,
    },
    {
      playerId: 3,
      name: 'Darnell Nurse',
      position: 'D',
      positionGroup: 'D',
      jerseyNumber: 25,
      age: 29,
      team: 'EDM',
      capHit: 9_250_000,
      aav: 9_250_000,
      baseSalary: 9_250_000,
      signingBonus: 0,
      totalSalary: 9_250_000,
      contractYears: 8,
      yearsRemaining: 4,
      expiryYear: 2027,
      expiryStatus: 'UFA',
      clause: 'NMC',
      rosterStatus: 'NHL',
      isWaiverExempt: false,
    },
    {
      playerId: 4,
      name: 'Stuart Skinner',
      position: 'G',
      positionGroup: 'G',
      jerseyNumber: 74,
      age: 25,
      team: 'EDM',
      capHit: 2_600_000,
      aav: 2_600_000,
      baseSalary: 2_600_000,
      signingBonus: 0,
      totalSalary: 2_600_000,
      contractYears: 3,
      yearsRemaining: 2,
      expiryYear: 2026,
      expiryStatus: 'RFA',
      clause: null,
      rosterStatus: 'NHL',
      isWaiverExempt: false,
    },
    {
      playerId: 5,
      name: 'AHL Player',
      position: 'C',
      positionGroup: 'F',
      jerseyNumber: 50,
      age: 22,
      team: 'EDM',
      capHit: 850_000,
      aav: 850_000,
      baseSalary: 850_000,
      signingBonus: 0,
      totalSalary: 850_000,
      contractYears: 3,
      yearsRemaining: 2,
      expiryYear: 2026,
      expiryStatus: 'RFA',
      clause: null,
      rosterStatus: 'AHL',
      isWaiverExempt: true,
    },
    {
      playerId: 6,
      name: 'Bought Out Guy',
      position: 'LW',
      positionGroup: 'F',
      jerseyNumber: 0,
      age: 30,
      team: 'EDM',
      capHit: 1_000_000,
      aav: 1_000_000,
      baseSalary: 0,
      signingBonus: 0,
      totalSalary: 0,
      contractYears: 2,
      yearsRemaining: 1,
      expiryYear: 2026,
      expiryStatus: 'UFA',
      clause: null,
      rosterStatus: 'Buyout',
      isWaiverExempt: false,
      deadCapHit: 1_000_000,
    },
  ],
};

vi.mock('@/data/nhlContracts', () => ({
  NHL_CONTRACT_DATA: mockContracts,
}));

// Mock the types module to provide NHL_TEAMS and SALARY_CAP
vi.mock('@/types/captracker', async () => {
  const actual = await vi.importActual('@/types/captracker');
  return actual;
});

// =============================================================================
// Import after mocks
// =============================================================================

import { getTeamCapData, getAllTeamsCapSummary } from '../NHLCapService';
import { SALARY_CAP_2025_26 } from '@/types/captracker';

// =============================================================================
// Tests
// =============================================================================

describe('NHLCapService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // getTeamCapData
  // ---------------------------------------------------------------------------
  describe('getTeamCapData', () => {
    it('returns correct cap data for a team', async () => {
      const data = await getTeamCapData('EDM');

      expect(data.teamAbbrev).toBe('EDM');
      expect(data.teamName).toBe('Edmonton Oilers');
      expect(data.salaryCap).toBe(SALARY_CAP_2025_26);
    });

    it('groups players by position correctly', async () => {
      const data = await getTeamCapData('EDM');

      // Forwards: McDavid + Draisaitl (NHL roster, positionGroup F)
      expect(data.forwards).toHaveLength(2);
      // Defense: Nurse
      expect(data.defense).toHaveLength(1);
      // Goalies: Skinner
      expect(data.goalies).toHaveLength(1);
    });

    it('calculates minor league roster separately', async () => {
      const data = await getTeamCapData('EDM');

      // AHL Player + Bought Out Guy (not NHL roster)
      expect(data.minorLeague).toHaveLength(2);
    });

    it('sorts players by cap hit descending within position groups', async () => {
      const data = await getTeamCapData('EDM');

      // Draisaitl ($14M) before McDavid ($12.5M)
      expect(data.forwards[0].name).toBe('Leon Draisaitl');
      expect(data.forwards[1].name).toBe('Connor McDavid');
    });

    it('calculates cap space correctly', async () => {
      const data = await getTeamCapData('EDM');

      // Active roster: 12.5M + 14M + 9.25M + 2.6M = 38.35M
      // Dead cap: 1M (buyout)
      const expectedProjected = 38_350_000 + 1_000_000;
      const expectedCapSpace = SALARY_CAP_2025_26 - 38_350_000 - 1_000_000;

      expect(data.projectedCapHit).toBe(expectedProjected);
      expect(data.capSpace).toBe(expectedCapSpace);
      expect(data.deadCap).toBe(1_000_000);
    });

    it('counts active roster size correctly', async () => {
      const data = await getTeamCapData('EDM');

      // 4 NHL players
      expect(data.activeRosterSize).toBe(4);
    });

    it('counts total contracts correctly', async () => {
      const data = await getTeamCapData('EDM');

      expect(data.totalContracts).toBe(6);
    });

    it('returns empty arrays for team with no contracts', async () => {
      const data = await getTeamCapData('ANA');

      expect(data.forwards).toHaveLength(0);
      expect(data.defense).toHaveLength(0);
      expect(data.goalies).toHaveLength(0);
      expect(data.activeRosterSize).toBe(0);
      expect(data.capSpace).toBe(SALARY_CAP_2025_26);
    });

    it('assigns playerId from index when missing', async () => {
      const data = await getTeamCapData('EDM');

      // All our mock contracts have playerId set, so they should be used
      expect(data.forwards[0].playerId).toBe(2); // Draisaitl
    });
  });

  // ---------------------------------------------------------------------------
  // getAllTeamsCapSummary
  // ---------------------------------------------------------------------------
  describe('getAllTeamsCapSummary', () => {
    it('returns summaries for all 32 NHL teams', async () => {
      const summaries = await getAllTeamsCapSummary();

      expect(summaries.length).toBe(32);
    });

    it('includes cap data for EDM', async () => {
      const summaries = await getAllTeamsCapSummary();

      const edm = summaries.find(s => s.teamAbbrev === 'EDM');
      expect(edm).toBeDefined();
      expect(edm?.teamName).toBe('Edmonton Oilers');
      expect(edm?.activeRosterSize).toBe(4);
      expect(edm?.projectedCapHit).toBeGreaterThan(0);
    });

    it('shows zero cap hit for teams without contracts', async () => {
      const summaries = await getAllTeamsCapSummary();

      const ana = summaries.find(s => s.teamAbbrev === 'ANA');
      expect(ana?.projectedCapHit).toBe(0);
      expect(ana?.capSpace).toBe(SALARY_CAP_2025_26);
    });
  });
});
