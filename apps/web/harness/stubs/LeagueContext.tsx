/** Harness stub for @/contexts/LeagueContext. */
import type { ReactNode } from 'react';

export const isDemoLeague = () => false;

export const LeagueProvider = ({ children }: { children: ReactNode }) => <>{children}</>;

const LEAGUE = {
  userLeagueState: 'active-user' as const,
  activeLeagueId: 'harness-league',
  // The Press Box header reads `activeLeague` for the name and the crest
  // (2026-09-04). Without it the header rendered an empty title and a "?"
  // disc, which reads as a broken component rather than a thin fixture.
  activeLeague: {
    id: 'harness-league',
    name: 'Finalsz',
    settings: { crestTeam: 'EDM' },
  },
  activeLeagueFormat: { leagueType: 'fantasy', scoringFormat: 'h2h-points' },
  leagues: [{ id: 'harness-league', name: 'Harness League' }],
  isChangingLeague: false,
  leagueContextLoading: false,
  setActiveLeagueId: () => {},
  refreshLeagues: async () => {},
};

export const useLeague = () => LEAGUE;
