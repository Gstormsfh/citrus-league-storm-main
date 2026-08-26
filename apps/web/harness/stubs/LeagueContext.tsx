/** Harness stub for @/contexts/LeagueContext. */
import type { ReactNode } from 'react';

export const isDemoLeague = () => false;

export const LeagueProvider = ({ children }: { children: ReactNode }) => <>{children}</>;

const LEAGUE = {
  userLeagueState: 'active-user' as const,
  activeLeagueId: 'harness-league',
  activeLeagueFormat: { leagueType: 'fantasy', scoringFormat: 'h2h-points' },
  leagues: [{ id: 'harness-league', name: 'Harness League' }],
  isChangingLeague: false,
  leagueContextLoading: false,
  setActiveLeagueId: () => {},
  refreshLeagues: async () => {},
};

export const useLeague = () => LEAGUE;
