/**
 * Readings the vision model would produce for a 4-team Yahoo keeper league,
 * shaped exactly as the record_league_pages tool returns them. Small on
 * purpose: every rule in assemble.ts is exercised by one of these pages.
 */
import type { ExtractedPage } from '../../import/screenshot/schema';

export const standings2023: ExtractedPage = {
  index: 0, platform: 'yahoo', kind: 'standings', season: 2023, leagueName: 'The Puck Stops Here', confidence: 'high', notes: null,
  standings: [
    { rank: 1, teamName: 'Dangle Dynasty 🏒', managerName: 'Alice', wins: 15, losses: 5, ties: 2, pointsFor: 1234.5, pointsAgainst: 980.25, isChampion: true, madePlayoffs: true },
    { rank: 2, teamName: 'Bench Bosses', managerName: 'Bob', wins: 12, losses: 8, ties: 2, pointsFor: 1100, pointsAgainst: 1010, madePlayoffs: true },
    { rank: 3, teamName: 'Crease Lightning', managerName: 'Cy', wins: 10, losses: 10, ties: 2, pointsFor: 1050, pointsAgainst: 1040, madePlayoffs: true },
    { rank: 4, teamName: 'Deke Squad', managerName: null, wins: 4, losses: 18, ties: 0, pointsFor: 800, pointsAgainst: 1200, madePlayoffs: false },
  ],
};

export const playoffs2023: ExtractedPage = {
  index: 1, platform: 'yahoo', kind: 'playoffs', season: 2023, leagueName: null, confidence: 'high', notes: null,
  playoffs: [
    { round: 'semifinal', week: 22, homeTeam: 'Dangle Dynasty 🏒', awayTeam: 'Crease Lightning', homeScore: 90, awayScore: 70, winner: 'home' },
    { round: 'semifinal', week: 22, homeTeam: 'Bench Bosses', awayTeam: 'Deke Squad', homeScore: 80, awayScore: 60, winner: 'home' },
    { round: 'final', week: 23, homeTeam: 'Dangle Dynasty 🏒', awayTeam: 'Bench Bosses', homeScore: 101.5, awayScore: 99, winner: 'home' },
    { round: 'third_place', week: 23, homeTeam: 'Crease Lightning', awayTeam: 'Deke Squad', homeScore: 50, awayScore: 55, winner: 'away' },
  ],
};

export const draft2023: ExtractedPage = {
  index: 2, platform: 'yahoo', kind: 'draft', season: 2023, leagueName: null, confidence: 'medium', notes: 'Round 3 was cut off at the bottom.',
  picks: [
    { overall: 1, round: 1, pickInRound: 1, teamName: 'Deke Squad', playerName: 'Connor McDavid', playerTeamAbbr: 'EDM', position: 'C', isKeeper: true, keeperCost: 'Round 1' },
    { overall: 2, round: 1, pickInRound: 2, teamName: 'Crease Lightning', playerName: 'Sebastian Aho', playerTeamAbbr: 'CAR', position: 'C', isKeeper: false },
    { overall: 3, round: 1, pickInRound: 3, teamName: 'Bench Bosses', playerName: 'Sebastian Aho', playerTeamAbbr: 'NYI', position: 'D', isKeeper: false },
    { overall: 4, round: 1, pickInRound: 4, teamName: 'Dangle Dynas...', playerName: 'Cale Makar', playerTeamAbbr: 'COL', position: 'D', isKeeper: false },
  ],
};

export const transactions2023: ExtractedPage = {
  index: 3, platform: 'yahoo', kind: 'transactions', season: 2023, leagueName: null, confidence: 'high', notes: null,
  transactions: [
    { date: '2024-01-15', type: 'trade', teamName: 'Bench Bosses', counterpartyTeamName: 'Deke Squad', playerName: 'Connor McDavid', playerTeamAbbr: 'EDM', position: 'C' },
    { date: '2024-01-15', type: 'trade', teamName: 'Deke Squad', counterpartyTeamName: 'Bench Bosses', playerName: null, pickSeason: 2024, pickRound: 1, pickOriginalTeamName: 'Bench Bosses' },
    { date: '2024-01-15', type: 'trade', teamName: 'Deke Squad', counterpartyTeamName: 'Bench Bosses', playerName: null, pickRound: 2 },
    { date: 'Nov 3', type: 'add', teamName: 'Crease Lightning', playerName: 'Some Rookie', playerTeamAbbr: 'TOR', position: 'LW', faabBid: 12 },
    { date: null, type: 'drop', teamName: 'Crease Lightning', playerName: null },
  ],
};

export const keepersPage: ExtractedPage = {
  index: 4, platform: 'yahoo', kind: 'keepers', season: null, leagueName: null, confidence: 'high', notes: null,
  keepers: [
    { teamName: 'Bench Bosses', playerName: 'Connor McDavid', playerTeamAbbr: 'EDM', position: 'C', round: 1, roundNext: 1, yearsKept: 2 },
    { teamName: 'Dangle Dynasty 🏒', playerName: 'Cale Makar', playerTeamAbbr: 'COL', position: 'D', round: 3, roundNext: 2, yearsKept: 1 },
  ],
};

export const pickOwnershipPage: ExtractedPage = {
  index: 5, platform: 'yahoo', kind: 'pick_ownership', season: null, leagueName: null, confidence: 'high', notes: null,
  pickOwnership: [
    { draftSeason: 2024, round: 1, originalTeamName: 'Bench Bosses', ownerTeamName: 'Deke Squad' },
    { draftSeason: 2024, round: 2, originalTeamName: 'Bench Bosses', ownerTeamName: 'Bench Bosses' },
    { draftSeason: 2025, round: 1, originalTeamName: 'Crease Lightning', ownerTeamName: 'Dangle Dynasty 🏒' },
  ],
};

export const settingsPage: ExtractedPage = {
  index: 6, platform: 'yahoo', kind: 'settings', season: null, leagueName: 'The Puck Stops Here', confidence: 'high', notes: null,
  settings: {
    scoringType: 'h2h_categories',
    categories: ['G', 'A', '+/-', 'PIM', 'PPP', 'SOG', 'HIT', 'W', 'GAA', 'SV%', 'Bananas'],
    rosterSlots: [{ slot: 'C', count: 2 }, { slot: 'LW', count: 2 }, { slot: 'RW', count: 2 }, { slot: 'D', count: 4 }, { slot: 'G', count: 2 }, { slot: 'BN', count: 4 }, { slot: 'IR+', count: 2 }],
    keeperCount: 3, keeperRule: 'Round drafted', draftType: 'Snake', usesFaab: true, regularSeasonWeeks: 21, playoffTeams: 4, playoffWeeks: 2, teamCount: 4,
  },
};

export const standings2022: ExtractedPage = {
  index: 7, platform: 'yahoo', kind: 'standings', season: 2022, leagueName: 'The Puck Stops Here', confidence: 'high', notes: null,
  standings: [
    { rank: 1, teamName: 'Bench Bosses', managerName: 'Bob', wins: 14, losses: 6, ties: 2, categoryRecord: '132-69-9' },
    { rank: 2, teamName: 'Old Dangle', managerName: 'Alice', wins: 13, losses: 7, ties: 2, categoryRecord: '120-80-10' },
    { rank: 3, teamName: 'Crease Lightning', managerName: 'Cy', wins: 8, losses: 12, ties: 2, categoryRecord: '90-110-10' },
    { rank: 4, teamName: 'Deke Squad', managerName: 'Dee', wins: 5, losses: 15, ties: 2, categoryRecord: '70-130-10' },
  ],
};

export const scoreboard2022: ExtractedPage = {
  index: 8, platform: 'yahoo', kind: 'scoreboard', season: 2022, leagueName: null, confidence: 'high', notes: null,
  scoreboard: {
    week: 5, isPlayoff: false,
    matchups: [
      { homeTeam: 'Bench Bosses', awayTeam: 'Old Dangle', homeCatWins: 6, homeCatLosses: 3, homeCatTies: 1 },
      { homeTeam: 'Crease Lightning', awayTeam: 'Deke Squad', homeCatWins: 4, homeCatLosses: 6, homeCatTies: 0 },
    ],
  },
};

/** Yahoo's League History page: one row per past season, several seasons on one screenshot. */
export const championsPage: ExtractedPage = {
  index: 10, platform: 'yahoo', kind: 'champions', season: null, leagueName: 'The Puck Stops Here', confidence: 'high', notes: null,
  champions: [
    { season: 2021, championTeam: 'Crease Lightning', championManager: 'Cy', runnerUpTeam: 'Old Dangle', runnerUpManager: 'Alice', note: '101.5 to 99' },
    { season: 2020, championTeam: 'Old Dangle', championManager: 'Alice', runnerUpTeam: null, runnerUpManager: null, note: null },
    { season: 2023, championTeam: 'Dangle Dynasty 🏒', championManager: 'Alice', runnerUpTeam: 'Bench Bosses', runnerUpManager: 'Bob', note: null },
  ],
};

/** The league's own awards, from a spreadsheet photo. */
export const awardsPage: ExtractedPage = {
  index: 11, platform: 'unknown', kind: 'awards', season: null, leagueName: null, confidence: 'medium', notes: 'Handwritten column for 2020.',
  awards: [
    { season: 2023, award: 'The Sacko', winnerTeam: 'Deke Squad', winnerManager: null, note: 'Last place, again' },
    { season: 2023, award: 'Golden Stick', winnerTeam: null, winnerManager: 'Bob', note: 'Most goals' },
    { season: 2021, award: 'The Sacko', winnerTeam: null, winnerManager: 'Dee', note: null },
    { season: null, award: 'Commissioner of the Decade', winnerTeam: null, winnerManager: 'Alice', note: null },
  ],
};

export const otherPage: ExtractedPage = { index: 9, platform: 'unknown', kind: 'other', season: null, leagueName: null, confidence: 'low', notes: 'A photo of a dog.' };

export const allPages: ExtractedPage[] = [standings2023, playoffs2023, draft2023, transactions2023, keepersPage, pickOwnershipPage, settingsPage, standings2022, scoreboard2022, otherPage];
