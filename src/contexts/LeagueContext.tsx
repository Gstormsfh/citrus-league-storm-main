import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { LeagueService, League } from '@/services/LeagueService';
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import { DEMO_LEAGUE_ID } from '@/services/DemoLeagueService';
import { MatchupService } from '@/services/MatchupService';
import { RosterCacheService } from '@/services/RosterCacheService';
import { PlayerService } from '@/services/PlayerService';

export type UserLeagueState = 'guest' | 'logged-in-no-league' | 'active-user';

/**
 * Check if a league ID is the demo league (read-only, isolated)
 */
export const isDemoLeague = (leagueId: string | null | undefined): boolean => {
  return leagueId === DEMO_LEAGUE_ID;
};

interface LeagueContextType {
  activeLeagueId: string | null;
  activeLeague: League | null;
  userLeagues: League[];
  setActiveLeagueId: (leagueId: string | null) => void;
  loading: boolean;
  isChangingLeague: boolean;
  error: string | null;
  refreshLeagues: () => Promise<void>;
  userLeagueState: UserLeagueState;
  demoLeagueId: string;
  isDemoLeague: (leagueId: string | null | undefined) => boolean;
}

// Default context value to prevent errors during initialization
const defaultContextValue: LeagueContextType = {
  activeLeagueId: null,
  activeLeague: null,
  userLeagues: [],
  setActiveLeagueId: () => {},
  loading: true,
  isChangingLeague: false,
  error: null,
  refreshLeagues: async () => {},
  userLeagueState: 'guest',
  demoLeagueId: DEMO_LEAGUE_ID,
  isDemoLeague,
};

const LeagueContext = createContext<LeagueContextType>(defaultContextValue);

export const useLeague = () => {
  const context = useContext(LeagueContext);
  // Context should always be defined now (has default value)
  return context;
};

interface LeagueProviderProps {
  children: ReactNode;
}

export const LeagueProvider: React.FC<LeagueProviderProps> = ({ children }) => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  
  const [activeLeagueId, setActiveLeagueIdState] = useState<string | null>(null);
  const [activeLeague, setActiveLeague] = useState<League | null>(null);
  const [userLeagues, setUserLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const [isChangingLeague, setIsChangingLeague] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Extract league_id from URL params if present
  const urlLeagueId = searchParams.get('league');

  // Load user's leagues
  const loadUserLeagues = async () => {
    if (!user) {
      setUserLeagues([]);
      setActiveLeagueIdState(null);
      setActiveLeague(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      const { leagues, error: leaguesError } = await LeagueService.getUserLeagues(user.id);
      
      if (leaguesError) {
        setError('Failed to load your leagues');
        setLoading(false);
        return;
      }

      // Exclude demo league from user's leagues (pillar of isolation)
      const filteredLeagues = (leagues || []).filter(l => l.id !== DEMO_LEAGUE_ID);
      setUserLeagues(filteredLeagues);

      // Determine active league:
      // 1. Use league_id from URL if present and valid
      // 2. Otherwise use first league
      // 3. Otherwise null
      let selectedLeagueId: string | null = null;
      
      if (urlLeagueId && leagues?.some(l => l.id === urlLeagueId)) {
        selectedLeagueId = urlLeagueId;
      } else if (leagues && leagues.length > 0) {
        selectedLeagueId = leagues[0].id;
        // Update URL if no league param but we have leagues
        if (!urlLeagueId) {
          const newParams = new URLSearchParams(searchParams);
          newParams.set('league', selectedLeagueId);
          setSearchParams(newParams, { replace: true });
        }
      }

      setActiveLeagueIdState(selectedLeagueId);
      
      // Load full league details
      if (selectedLeagueId) {
        const selectedLeague = leagues?.find(l => l.id === selectedLeagueId);
        setActiveLeague(selectedLeague || null);
      } else {
        setActiveLeague(null);
      }

      setLoading(false);
    } catch (err: unknown) {
      console.error('Error loading leagues:', err);
      setError('Failed to load leagues');
      setLoading(false);
    }
  };

  // Set active league and update URL
  const setActiveLeagueId = (leagueId: string | null) => {
    // Prevent duplicate switches to the same league
    if (leagueId === activeLeagueId) {
      return;
    }
    
    // Signal that league is changing (briefly, for UI feedback only)
    setIsChangingLeague(true);
    
    // Clear all caches to prevent data bleeding between leagues
    MatchupService.clearRosterCache();
    RosterCacheService.clearCache();
    PlayerService.clearCache();
    
    // Update state synchronously
    setActiveLeagueIdState(leagueId);
    
    if (leagueId) {
      const league = userLeagues.find(l => l.id === leagueId);
      setActiveLeague(league || null);
      
      // Update URL with new league (NO page reload - smooth transition)
      const newParams = new URLSearchParams(searchParams);
      newParams.set('league', leagueId);
      // Remove tab params to reset tabs on league switch
      newParams.delete('tab');
      
      // Use React Router navigation for smooth transition
      navigate(`${location.pathname}?${newParams.toString()}`, { replace: true });
    } else {
      setActiveLeague(null);
      
      // Remove league param from URL
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('league');
      newParams.delete('tab');
      
      const newUrl = newParams.toString() 
        ? `${location.pathname}?${newParams.toString()}`
        : location.pathname;
      navigate(newUrl, { replace: true });
    }
    
    // Reset immediately after state updates (no delay to prevent hooks issues)
    // Use requestAnimationFrame to ensure state updates are batched
    requestAnimationFrame(() => {
      setIsChangingLeague(false);
    });
  };

  // Refresh leagues list
  const refreshLeagues = async () => {
    await loadUserLeagues();
  };

  // Determine user league state
  // If user has ANY leagues, they're an active user (activeLeagueId is just for navigation)
  const userLeagueState: UserLeagueState = React.useMemo(() => {
    if (!user) {
      return 'guest';
    }
    if (userLeagues.length === 0) {
      return 'logged-in-no-league';
    }
    return 'active-user';
  }, [user, userLeagues.length]);

    // NOTE: Do NOT initialize demo league for guests - they can't write to database (401 error)
    // Demo league should be pre-initialized by an admin or created on first logged-in user access
    // Guests will use static fallback data instead
    // useEffect(() => {
    //   if (!user) {
    //     // Guest user - skip database initialization (causes 401 for guests)
    //     // Demo data will be loaded via static fallback in components
    //   }
    // }, [user]);

  // Load leagues on mount and when user changes
  useEffect(() => {
    loadUserLeagues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Update active league when URL param changes
  useEffect(() => {
    if (urlLeagueId && urlLeagueId !== activeLeagueId) {
      const league = userLeagues.find(l => l.id === urlLeagueId);
      if (league) {
        setActiveLeagueIdState(urlLeagueId);
        setActiveLeague(league);
      }
    }
  }, [urlLeagueId, userLeagues]);

  const value: LeagueContextType = {
    activeLeagueId,
    activeLeague,
    userLeagues,
    setActiveLeagueId,
    loading,
    isChangingLeague,
    error,
    refreshLeagues,
    userLeagueState,
    demoLeagueId: DEMO_LEAGUE_ID,
    isDemoLeague,
  };

  return <LeagueContext.Provider value={value}>{children}</LeagueContext.Provider>;
};

