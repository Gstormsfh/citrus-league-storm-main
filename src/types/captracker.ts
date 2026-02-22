// src/types/captracker.ts
// Types for the Armchair GM / NHL Salary Cap Tracker feature

export type ContractStatus = 'UFA' | 'RFA' | 'ELC' | 'Signed' | '35+';

export type ClauseType = 'NMC' | 'M-NTC' | 'NTC' | null;

export type PositionGroup = 'F' | 'D' | 'G';

export interface PlayerContract {
  playerId: number;
  name: string;
  position: string;        // C, LW, RW, D, G
  positionGroup: PositionGroup;
  jerseyNumber: number;
  age: number;
  birthDate?: string;      // YYYY-MM-DD format, used to calculate age
  team: string;            // Team abbreviation (e.g. "TOR", "EDM")
  headshot?: string;

  // Contract details
  capHit: number;          // Annual cap hit in dollars
  aav: number;             // Average Annual Value
  baseSalary: number;      // Base salary for current season
  signingBonus: number;    // Signing bonus for current season
  totalSalary: number;     // baseSalary + signingBonus

  // Contract terms
  contractYears: number;   // Total years on contract
  yearsRemaining: number;  // Years left including this season
  expiryYear: number;      // Year contract expires (e.g. 2027)
  expiryStatus: ContractStatus; // What they become when contract ends

  // Clauses
  clause: ClauseType;

  // Status
  rosterStatus: 'NHL' | 'AHL' | 'IR' | 'LTIR' | 'Buyout' | 'Retained';
  isWaiverExempt: boolean;

  // Performance bonuses (for ELC and 35+ contracts)
  performanceBonuses?: number;

  // Dead cap (if bought out or retained)
  deadCapHit?: number;
}

export interface TeamCapData {
  teamAbbrev: string;
  teamName: string;
  conference: 'Eastern' | 'Western';
  division: string;
  logoUrl: string;

  // Cap summary
  salaryCap: number;       // $95,500,000 for 2025-26
  projectedCapHit: number; // Total of all active roster cap hits
  capSpace: number;        // salaryCap - projectedCapHit
  deadCap: number;         // Buyouts, retained salary
  ltirUsed: number;        // LTIR cap relief being used
  activeRosterSize: number;
  totalContracts: number;  // Out of 50 max

  // Roster grouped by position
  forwards: PlayerContract[];
  defense: PlayerContract[];
  goalies: PlayerContract[];

  // Buried/minor league contracts
  minorLeague?: PlayerContract[];
}

export interface NHLTeamInfo {
  abbrev: string;
  name: string;
  fullName: string;
  conference: 'Eastern' | 'Western';
  division: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string;
}

// All 32 NHL teams
export const NHL_TEAMS: NHLTeamInfo[] = [
  // Atlantic Division
  { abbrev: 'BOS', name: 'Bruins', fullName: 'Boston Bruins', conference: 'Eastern', division: 'Atlantic', primaryColor: '#FFB81C', secondaryColor: '#000000', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/BOS_light.svg' },
  { abbrev: 'BUF', name: 'Sabres', fullName: 'Buffalo Sabres', conference: 'Eastern', division: 'Atlantic', primaryColor: '#003087', secondaryColor: '#FFB81C', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/BUF_light.svg' },
  { abbrev: 'DET', name: 'Red Wings', fullName: 'Detroit Red Wings', conference: 'Eastern', division: 'Atlantic', primaryColor: '#CE1126', secondaryColor: '#FFFFFF', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/DET_light.svg' },
  { abbrev: 'FLA', name: 'Panthers', fullName: 'Florida Panthers', conference: 'Eastern', division: 'Atlantic', primaryColor: '#C8102E', secondaryColor: '#041E42', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/FLA_light.svg' },
  { abbrev: 'MTL', name: 'Canadiens', fullName: 'Montreal Canadiens', conference: 'Eastern', division: 'Atlantic', primaryColor: '#AF1E2D', secondaryColor: '#192168', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/MTL_light.svg' },
  { abbrev: 'OTT', name: 'Senators', fullName: 'Ottawa Senators', conference: 'Eastern', division: 'Atlantic', primaryColor: '#C52032', secondaryColor: '#000000', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/OTT_light.svg' },
  { abbrev: 'TBL', name: 'Lightning', fullName: 'Tampa Bay Lightning', conference: 'Eastern', division: 'Atlantic', primaryColor: '#002868', secondaryColor: '#FFFFFF', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/TBL_light.svg' },
  { abbrev: 'TOR', name: 'Maple Leafs', fullName: 'Toronto Maple Leafs', conference: 'Eastern', division: 'Atlantic', primaryColor: '#00205B', secondaryColor: '#FFFFFF', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/TOR_light.svg' },

  // Metropolitan Division
  { abbrev: 'CAR', name: 'Hurricanes', fullName: 'Carolina Hurricanes', conference: 'Eastern', division: 'Metropolitan', primaryColor: '#CC0000', secondaryColor: '#000000', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/CAR_light.svg' },
  { abbrev: 'CBJ', name: 'Blue Jackets', fullName: 'Columbus Blue Jackets', conference: 'Eastern', division: 'Metropolitan', primaryColor: '#002654', secondaryColor: '#CE1126', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/CBJ_light.svg' },
  { abbrev: 'NJD', name: 'Devils', fullName: 'New Jersey Devils', conference: 'Eastern', division: 'Metropolitan', primaryColor: '#CE1126', secondaryColor: '#000000', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/NJD_light.svg' },
  { abbrev: 'NYI', name: 'Islanders', fullName: 'New York Islanders', conference: 'Eastern', division: 'Metropolitan', primaryColor: '#00539B', secondaryColor: '#F47D30', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/NYI_light.svg' },
  { abbrev: 'NYR', name: 'Rangers', fullName: 'New York Rangers', conference: 'Eastern', division: 'Metropolitan', primaryColor: '#0038A8', secondaryColor: '#CE1126', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/NYR_light.svg' },
  { abbrev: 'PHI', name: 'Flyers', fullName: 'Philadelphia Flyers', conference: 'Eastern', division: 'Metropolitan', primaryColor: '#F74902', secondaryColor: '#000000', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/PHI_light.svg' },
  { abbrev: 'PIT', name: 'Penguins', fullName: 'Pittsburgh Penguins', conference: 'Eastern', division: 'Metropolitan', primaryColor: '#FFB81C', secondaryColor: '#000000', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/PIT_light.svg' },
  { abbrev: 'WSH', name: 'Capitals', fullName: 'Washington Capitals', conference: 'Eastern', division: 'Metropolitan', primaryColor: '#C8102E', secondaryColor: '#041E42', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/WSH_light.svg' },

  // Central Division
  { abbrev: 'ARI', name: 'Utah HC', fullName: 'Utah Hockey Club', conference: 'Western', division: 'Central', primaryColor: '#69B3E7', secondaryColor: '#000000', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/UTA_light.svg' },
  { abbrev: 'CHI', name: 'Blackhawks', fullName: 'Chicago Blackhawks', conference: 'Western', division: 'Central', primaryColor: '#CF0A2C', secondaryColor: '#000000', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/CHI_light.svg' },
  { abbrev: 'COL', name: 'Avalanche', fullName: 'Colorado Avalanche', conference: 'Western', division: 'Central', primaryColor: '#6F263D', secondaryColor: '#236192', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/COL_light.svg' },
  { abbrev: 'DAL', name: 'Stars', fullName: 'Dallas Stars', conference: 'Western', division: 'Central', primaryColor: '#006847', secondaryColor: '#8F8F8C', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/DAL_light.svg' },
  { abbrev: 'MIN', name: 'Wild', fullName: 'Minnesota Wild', conference: 'Western', division: 'Central', primaryColor: '#154734', secondaryColor: '#A6192E', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/MIN_light.svg' },
  { abbrev: 'NSH', name: 'Predators', fullName: 'Nashville Predators', conference: 'Western', division: 'Central', primaryColor: '#FFB81C', secondaryColor: '#041E42', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/NSH_light.svg' },
  { abbrev: 'STL', name: 'Blues', fullName: 'St. Louis Blues', conference: 'Western', division: 'Central', primaryColor: '#002F87', secondaryColor: '#FCB514', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/STL_light.svg' },
  { abbrev: 'WPG', name: 'Jets', fullName: 'Winnipeg Jets', conference: 'Western', division: 'Central', primaryColor: '#041E42', secondaryColor: '#004C97', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/WPG_light.svg' },

  // Pacific Division
  { abbrev: 'ANA', name: 'Ducks', fullName: 'Anaheim Ducks', conference: 'Western', division: 'Pacific', primaryColor: '#F47A38', secondaryColor: '#B9975B', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/ANA_light.svg' },
  { abbrev: 'CGY', name: 'Flames', fullName: 'Calgary Flames', conference: 'Western', division: 'Pacific', primaryColor: '#D2001C', secondaryColor: '#FAAF19', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/CGY_light.svg' },
  { abbrev: 'EDM', name: 'Oilers', fullName: 'Edmonton Oilers', conference: 'Western', division: 'Pacific', primaryColor: '#041E42', secondaryColor: '#FF4C00', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/EDM_light.svg' },
  { abbrev: 'LAK', name: 'Kings', fullName: 'Los Angeles Kings', conference: 'Western', division: 'Pacific', primaryColor: '#111111', secondaryColor: '#A2AAAD', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/LAK_light.svg' },
  { abbrev: 'SEA', name: 'Kraken', fullName: 'Seattle Kraken', conference: 'Western', division: 'Pacific', primaryColor: '#001628', secondaryColor: '#99D9D9', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/SEA_light.svg' },
  { abbrev: 'SJS', name: 'Sharks', fullName: 'San Jose Sharks', conference: 'Western', division: 'Pacific', primaryColor: '#006D75', secondaryColor: '#000000', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/SJS_light.svg' },
  { abbrev: 'VAN', name: 'Canucks', fullName: 'Vancouver Canucks', conference: 'Western', division: 'Pacific', primaryColor: '#00205B', secondaryColor: '#00843D', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/VAN_light.svg' },
  { abbrev: 'VGK', name: 'Golden Knights', fullName: 'Vegas Golden Knights', conference: 'Western', division: 'Pacific', primaryColor: '#B4975A', secondaryColor: '#333F42', logoUrl: 'https://assets.nhle.com/logos/nhl/svg/VGK_light.svg' },
];

// 2025-26 salary cap
export const SALARY_CAP_2025_26 = 95_500_000;
export const SALARY_FLOOR_2025_26 = 70_600_000;
export const MAX_CONTRACTS = 50;
export const MAX_ACTIVE_ROSTER = 23;

// Helper to format dollar amounts
export function formatCap(amount: number): string {
  if (amount >= 1_000_000) {
    const millions = amount / 1_000_000;
    return `$${millions.toFixed(millions % 1 === 0 ? 0 : 1)}M`;
  }
  if (amount >= 1_000) {
    return `$${(amount / 1_000).toFixed(0)}K`;
  }
  return `$${amount.toLocaleString()}`;
}

export function formatCapFull(amount: number): string {
  return `$${amount.toLocaleString()}`;
}

// Helper to get position group
export function getPositionGroup(position: string): PositionGroup {
  const pos = position?.toUpperCase();
  if (['G', 'GOALIE'].includes(pos)) return 'G';
  if (['D', 'DEFENCE', 'DEFENSE', 'LD', 'RD'].includes(pos)) return 'D';
  return 'F';
}

// Get team info by abbreviation
export function getTeamInfo(abbrev: string): NHLTeamInfo | undefined {
  // Handle Utah's special case (API uses UTA, we use ARI for historical reasons)
  if (abbrev === 'UTA') return NHL_TEAMS.find(t => t.abbrev === 'ARI');
  return NHL_TEAMS.find(t => t.abbrev === abbrev);
}
