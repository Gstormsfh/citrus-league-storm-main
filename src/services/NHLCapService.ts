// src/services/NHLCapService.ts
// Service to provide NHL roster and salary/contract data
// All data is served from static in-house contract data — zero external API calls.

import {
  TeamCapData,
  PlayerContract,
  NHL_TEAMS,
  SALARY_CAP_2025_26,
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

// Main function: get full cap data for a team
export async function getTeamCapData(teamAbbrev: string): Promise<TeamCapData> {
  const teamInfo = NHL_TEAMS.find(
    (t) => t.abbrev === teamAbbrev
  ) as NHLTeamInfo;

  const allContracts = await getContractData();
  const players = (allContracts[teamAbbrev] || []).map((p, i) => ({
    ...p,
    playerId: p.playerId || i + 1,
  }));

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
