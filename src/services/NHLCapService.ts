// src/services/NHLCapService.ts
// Service to fetch NHL rosters and merge with salary/contract data

import {
  TeamCapData,
  PlayerContract,
  NHL_TEAMS,
  SALARY_CAP_2025_26,
  getPositionGroup,
  type NHLTeamInfo,
} from '@/types/captracker';

// Dynamically import contract data to enable code splitting
let contractDataCache: Record<string, PlayerContract[]> | null = null;

async function getContractData(): Promise<Record<string, PlayerContract[]>> {
  if (contractDataCache) return contractDataCache;
  const module = await import('@/data/nhlContracts');
  contractDataCache = module.NHL_CONTRACT_DATA;
  return contractDataCache;
}

interface NHLApiPlayer {
  id: number;
  firstName: { default: string };
  lastName: { default: string };
  sweaterNumber: number;
  positionCode: string;
  shootsCatches: string;
  heightInInches: number;
  weightInPounds: number;
  birthDate: string;
  headshot: string;
}

interface NHLRosterResponse {
  forwards: NHLApiPlayer[];
  defensemen: NHLApiPlayer[];
  goalies: NHLApiPlayer[];
}

// Fetch the live roster from NHL API
async function fetchNHLRoster(teamAbbrev: string): Promise<NHLApiPlayer[]> {
  // Utah uses UTA in the NHL API
  const apiAbbrev = teamAbbrev === 'ARI' ? 'UTA' : teamAbbrev;

  try {
    const response = await fetch(
      `https://api-web.nhle.com/v1/roster/${apiAbbrev}/20252026`
    );
    if (!response.ok) {
      // Fallback to current roster
      const fallback = await fetch(
        `https://api-web.nhle.com/v1/roster/${apiAbbrev}/current`
      );
      if (!fallback.ok) return [];
      const data: NHLRosterResponse = await fallback.json();
      return [...data.forwards, ...data.defensemen, ...data.goalies];
    }
    const data: NHLRosterResponse = await response.json();
    return [...data.forwards, ...data.defensemen, ...data.goalies];
  } catch {
    return [];
  }
}

// Calculate age from birthDate string
function calculateAge(birthDate: string): number {
  const birth = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

// Merge NHL API data with contract data
function mergePlayerData(
  apiPlayers: NHLApiPlayer[],
  contracts: PlayerContract[],
  teamAbbrev: string
): PlayerContract[] {
  const contractMap = new Map<string, PlayerContract>();
  for (const c of contracts) {
    contractMap.set(c.name.toLowerCase(), c);
  }

  const merged: PlayerContract[] = [];
  const usedContractNames = new Set<string>();

  // First, match API players to contracts
  for (const apiPlayer of apiPlayers) {
    const fullName = `${apiPlayer.firstName.default} ${apiPlayer.lastName.default}`;
    const key = fullName.toLowerCase();
    const contract = contractMap.get(key);

    if (contract) {
      // Merge: prefer API data for headshot, jersey, position; contract data for financials
      merged.push({
        ...contract,
        headshot: apiPlayer.headshot || contract.headshot,
        jerseyNumber: apiPlayer.sweaterNumber || contract.jerseyNumber,
        position: apiPlayer.positionCode || contract.position,
        positionGroup: getPositionGroup(apiPlayer.positionCode || contract.position),
        age: calculateAge(apiPlayer.birthDate) || contract.age,
      });
      usedContractNames.add(key);
    } else {
      // API player without contract data - create a placeholder
      merged.push({
        playerId: apiPlayer.id,
        name: fullName,
        position: apiPlayer.positionCode,
        positionGroup: getPositionGroup(apiPlayer.positionCode),
        jerseyNumber: apiPlayer.sweaterNumber,
        age: calculateAge(apiPlayer.birthDate),
        team: teamAbbrev,
        headshot: apiPlayer.headshot,
        capHit: 900_000,
        aav: 900_000,
        baseSalary: 900_000,
        signingBonus: 0,
        totalSalary: 900_000,
        contractYears: 2,
        yearsRemaining: 1,
        expiryYear: 2026,
        expiryStatus: 'RFA',
        clause: null,
        rosterStatus: 'NHL',
        isWaiverExempt: true,
      });
    }
  }

  // Add any contract players not found in API (IR, LTIR, AHL, etc.)
  for (const contract of contracts) {
    if (!usedContractNames.has(contract.name.toLowerCase())) {
      merged.push(contract);
    }
  }

  return merged;
}

// Main function: get full cap data for a team
export async function getTeamCapData(teamAbbrev: string): Promise<TeamCapData> {
  const teamInfo = NHL_TEAMS.find(
    (t) => t.abbrev === teamAbbrev
  ) as NHLTeamInfo;

  const [apiPlayers, allContracts] = await Promise.all([
    fetchNHLRoster(teamAbbrev),
    getContractData(),
  ]);

  const teamContracts = allContracts[teamAbbrev] || [];
  const players = mergePlayerData(apiPlayers, teamContracts, teamAbbrev);

  // Sort by cap hit descending within each group
  const forwards = players
    .filter((p) => p.positionGroup === 'F' && p.rosterStatus === 'NHL')
    .sort((a, b) => b.capHit - a.capHit);

  const defense = players
    .filter((p) => p.positionGroup === 'D' && p.rosterStatus === 'NHL')
    .sort((a, b) => b.capHit - a.capHit);

  const goalies = players
    .filter((p) => p.positionGroup === 'G' && p.rosterStatus === 'NHL')
    .sort((a, b) => b.capHit - a.capHit);

  const minorLeague = players
    .filter((p) => p.rosterStatus !== 'NHL')
    .sort((a, b) => b.capHit - a.capHit);

  // Calculate cap totals
  const activeRoster = [...forwards, ...defense, ...goalies];
  const projectedCapHit = activeRoster.reduce((sum, p) => sum + p.capHit, 0);
  const deadCap = players
    .filter((p) => p.rosterStatus === 'Buyout' || p.rosterStatus === 'Retained')
    .reduce((sum, p) => sum + (p.deadCapHit || p.capHit), 0);
  const ltirUsed = players
    .filter((p) => p.rosterStatus === 'LTIR')
    .reduce((sum, p) => sum + p.capHit, 0);

  return {
    teamAbbrev,
    teamName: teamInfo?.fullName || teamAbbrev,
    conference: teamInfo?.conference || 'Eastern',
    division: teamInfo?.division || '',
    logoUrl: teamInfo?.logoUrl || '',
    salaryCap: SALARY_CAP_2025_26,
    projectedCapHit: projectedCapHit + deadCap,
    capSpace: SALARY_CAP_2025_26 - projectedCapHit - deadCap,
    deadCap,
    ltirUsed,
    activeRosterSize: activeRoster.length,
    totalContracts: players.length,
    forwards,
    defense,
    goalies,
    minorLeague,
  };
}

// Get all teams' cap summary (lighter data - just totals)
export async function getAllTeamsCapSummary(): Promise<
  Array<{
    teamAbbrev: string;
    teamName: string;
    logoUrl: string;
    projectedCapHit: number;
    capSpace: number;
    activeRosterSize: number;
  }>
> {
  const allContracts = await getContractData();

  return NHL_TEAMS.map((team) => {
    const contracts = allContracts[team.abbrev] || [];
    const nhlPlayers = contracts.filter((p) => p.rosterStatus === 'NHL');
    const projectedCapHit = nhlPlayers.reduce((sum, p) => sum + p.capHit, 0);

    return {
      teamAbbrev: team.abbrev,
      teamName: team.fullName,
      logoUrl: team.logoUrl,
      projectedCapHit,
      capSpace: SALARY_CAP_2025_26 - projectedCapHit,
      activeRosterSize: nhlPlayers.length,
    };
  });
}
