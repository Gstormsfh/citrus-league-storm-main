import React, { createContext, useContext, useState, useEffect, useRef, useMemo, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { LeagueService, League, getLeagueFormat } from '@/services/LeagueService';
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import { DEMO_LEAGUE_ID, DEMO_LEAGUE_ID_FOR_GUESTS } from '@/services/DemoLeagueService';
import { MatchupService } from '@/services/MatchupService';
import { RosterCacheService } from '@/services/RosterCacheService';
import { PlayerService } from '@/services/PlayerService';
import { DataCacheService } from '@/services/DataCacheService';
import { LeagueMembershipService } from '@/services/LeagueMembershipService';
import { playoffApi } from '@/api/playoffs';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { LeagueType, ScoringFormat, DraftType } from '@/types/leagueTypes';
import { logger } from '@/utils/logger';
import { reportBootStage } from '@/lib/bootStages';

export type UserLeagueState = 'guest' | 'logged-in-no-league' | 'active-user';

/**
 * Check if a league ID is the demo league (read-only, isolated)
 */
// eslint-disable-next-line react-refresh/only-export-components
export const isDemoLeague = (leagueId: string | null | undefined): boolean => {
  return leagueId === DEMO_LEAGUE_ID;
};

/** Active league's format info, derived from settings JSONB */
interface ActiveLeagueFormat {
  leagueType: LeagueType;
  scoringFormat: ScoringFormat;
  draftType: DraftType;
  positionType?: 'individual' | 'forward';
}

interface LeagueContextType {
  activeLeagueId: string | null;
  activeLeague: League | null;
  activeLeagueFormat: ActiveLeagueFormat;
  userLeagues: League[];
  setActiveLeagueId: (leagueId: string | null) => void;
  loading: boolean;
  isChangingLeague: boolean;
  error: string | null;
  refreshLeagues: () => Promise<void>;
  userLeagueState: UserLeagueState;
  /** True when a playoff bracket exists for the active league (controls nav visibility) */
  showPlayoffs: boolean;
  demoLeagueId: string;
  isDemoLeague: (leagueId: string | null | undefined) => boolean;
}

const DEFAULT_FORMAT: ActiveLeagueFormat = {
  leagueType: 'fantasy',
  scoringFormat: 'h2h-points',
  draftType: 'snake',
};

// Default context value to prevent errors during initialization
const defaultContextValue: LeagueContextType = {
  activeLeagueId: null,
  activeLeague: null,
  activeLeagueFormat: DEFAULT_FORMAT,
  userLeagues: [],
  setActiveLeagueId: () => {},
  loading: true,
  isChangingLeague: false,
  error: null,
  refreshLeagues: async () => {},
  userLeagueState: 'guest',
  showPlayoffs: false,
  demoLeagueId: DEMO_LEAGUE_ID,
  isDemoLeague,
};

const LeagueContext = createContext<LeagueContextType>(defaultContextValue);

// eslint-disable-next-line react-refresh/only-export-components
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
  const { toast } = useToast();
  
  const [activeLeagueId, setActiveLeagueIdState] = useState<string | null>(null);
  const [activeLeague, setActiveLeague] = useState<League | null>(null);
  const [userLeagues, setUserLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const [isChangingLeague, setIsChangingLeague] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPlayoffs, setShowPlayoffs] = useState(false);

  // The boot splash's second stage (PR3): the leagues are known, or failed.
  useEffect(() => {
    if (!loading) reportBootStage('league');
  }, [loading]);

  // Track the current active league in a ref so closures (TOKEN_REFRESHED
  // handler, loadUserLeagues) always see the user's latest in-session
  // selection — protects against token-refresh-triggered reloads stomping
  // the user's chosen league with the fallback "first league" value.
  const activeLeagueIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeLeagueIdRef.current = activeLeagueId;
  }, [activeLeagueId]);

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
        leagueLoadSucceeded.current = false;
        setError('Failed to load your leagues');
        setLoading(false);
        return;
      }

      // Exclude demo league from user's leagues (pillar of isolation)
      // Filter out demo league (guests only) - double check even though getUserLeagues excludes it
      const filteredLeagues = (leagues || []).filter(l => 
        l.id !== DEMO_LEAGUE_ID && l.id !== DEMO_LEAGUE_ID_FOR_GUESTS
      );
      setUserLeagues(filteredLeagues);

      // Determine active league:
      // 1. Use league_id from URL if present and valid
      // 2. Otherwise preserve the user's current in-session selection if still a member
      // 3. Otherwise use last-active league from localStorage if still a member
      // 4. Otherwise use first league
      // 5. Otherwise null
      let selectedLeagueId: string | null = null;
      const storageKey = `citrus:activeLeagueId:${user.id}`;
      const storedLeagueId = (() => {
        try { return localStorage.getItem(storageKey); } catch { return null; }
      })();
      const currentActiveLeagueId = activeLeagueIdRef.current;

      if (urlLeagueId && filteredLeagues.some(l => l.id === urlLeagueId)) {
        selectedLeagueId = urlLeagueId;
      } else if (
        currentActiveLeagueId &&
        filteredLeagues.some(l => l.id === currentActiveLeagueId)
      ) {
        // Preserve the user's in-session selection across any re-load
        // (e.g. token refresh) so we never silently flip leagues on them.
        selectedLeagueId = currentActiveLeagueId;
      } else if (storedLeagueId && filteredLeagues.some(l => l.id === storedLeagueId)) {
        selectedLeagueId = storedLeagueId;
        // Reflect restored league in URL so downstream effects see it
        const newParams = new URLSearchParams(searchParams);
        newParams.set('league', selectedLeagueId);
        setSearchParams(newParams, { replace: true });
      } else if (filteredLeagues.length > 0) {
        selectedLeagueId = filteredLeagues[0].id;
        // Update URL if no league param but we have leagues
        if (!urlLeagueId) {
          const newParams = new URLSearchParams(searchParams);
          newParams.set('league', selectedLeagueId);
          setSearchParams(newParams, { replace: true });
        }
      }

      setActiveLeagueIdState(selectedLeagueId);
      if (selectedLeagueId) {
        try { localStorage.setItem(storageKey, selectedLeagueId); } catch { /* ignore quota */ }
      }

      // Load full league details
      if (selectedLeagueId) {
        const selectedLeague = filteredLeagues.find(l => l.id === selectedLeagueId);
        setActiveLeague(selectedLeague || null);
      } else {
        setActiveLeague(null);
      }

      leagueLoadSucceeded.current = true;
      setLoading(false);
    } catch (err: unknown) {
      logger.error('Error loading leagues:', err);
      leagueLoadSucceeded.current = false;
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
    DataCacheService.clear();
    
    // Update state synchronously
    setActiveLeagueIdState(leagueId);
    if (user) {
      try {
        const storageKey = `citrus:activeLeagueId:${user.id}`;
        if (leagueId) localStorage.setItem(storageKey, leagueId);
        else localStorage.removeItem(storageKey);
      } catch { /* ignore */ }
    }

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

  // Track whether league load succeeded so TOKEN_REFRESHED can retry
  const leagueLoadSucceeded = useRef(false);

  // Load leagues on mount and when the signed-in user changes.
  // NOTE: Depend on user?.id (not the full user object) so that Supabase
  // TOKEN_REFRESHED events — which hand us a new user object with the same
  // uid — do NOT re-fire this effect. Re-firing on every token refresh was
  // causing loadUserLeagues to re-run every ~40-55 minutes and re-select a
  // league, which could silently flip the user off their chosen league.
  useEffect(() => {
    leagueLoadSucceeded.current = false;
    // 2026-08-18 launch audit: this used to force
    // `leagueLoadSucceeded.current = true` in .then(). loadUserLeagues
    // catches every error internally and therefore ALWAYS resolves — so
    // that line marked failed loads as successful and made the
    // TOKEN_REFRESHED retry below permanently dead code. The function
    // already sets the ref correctly on both paths (true on success,
    // false on either failure branch); trust it rather than overwriting.
    void loadUserLeagues();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadUserLeagues is not memoized; user?.id is the only meaningful trigger
  }, [user?.id]);

  // When Supabase finishes refreshing the token, retry ONLY if the initial
  // league load failed. This handler deliberately does not re-run on
  // successful refreshes — those should leave the user's active league alone.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'TOKEN_REFRESHED' && user && !leagueLoadSucceeded.current) {
        logger.info('[LeagueContext] Token refreshed, retrying league load');
        // Same fix as above — loadUserLeagues owns the ref on both paths.
        void loadUserLeagues();
      }
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Update active league when URL param changes (with membership validation)
  useEffect(() => {
    // Don't verify until leagues have finished loading
    if (urlLeagueId && urlLeagueId !== activeLeagueId && user && !loading) {
      const verifyAndSetLeague = async () => {
        // First check if league is in user's leagues array
        const league = userLeagues.find(l => l.id === urlLeagueId);
        
        if (!league) {
          // League not in user's leagues - verify membership directly (might be newly joined)
          try {
            const isMember = await LeagueMembershipService.verifyMembership(urlLeagueId, user.id);
            
            if (isMember) {
              // User is a member but league not in cache - refresh and set
              await loadUserLeagues();
              // After refresh, try to find the league again
              const refreshedLeagues = await LeagueService.getUserLeagues(user.id);
              const refreshedLeague = refreshedLeagues.leagues?.find(l => l.id === urlLeagueId);
              
              if (refreshedLeague) {
                setActiveLeagueIdState(urlLeagueId);
                setActiveLeague(refreshedLeague);
                return;
              }
            }
            
            // Not a member. Instead of slamming them with "Access Denied",
            // resolve the league's join_code and redirect to the join flow.
            // This used to read public.leagues directly, relying on an RLS policy
            // ("Authenticated users can read leagues by join code") that existed
            // only on staging — and which let ANY signed-in user read EVERY league
            // row and every join code. Production never had it, so this path always
            // fell through to "Access Denied" there. It now goes through
            // get_league_invite_by_id(), a SECURITY DEFINER lookup that resolves
            // exactly one league by an id the user already holds (it came from the
            // link they were sent) and returns only the invite fields, so there is
            // no way to enumerate leagues.
            // (The /api/leagues/:id server endpoint requires membership, which is
            // why we don't use it here.)
            logger.warn('[LeagueContext] User attempted to access league not in their list:', urlLeagueId);
            try {
              const { supabase } = await import('@/integrations/supabase/client');
              // The generated Database type declares no Functions, so every
              // .rpc() name types as `never`. Same locally-scoped cast the
              // draft queue uses (see DraftQueue.tsx) until types are regenerated.
              const inviteClient = supabase as unknown as {
                rpc: (
                  fn: 'get_league_invite_by_id',
                  args: { p_league_id: string },
                ) => Promise<{
                  data: Array<{
                    id: string;
                    name: string | null;
                    join_code: string | null;
                    settings: Record<string, unknown> | null;
                  }> | null;
                  error: { message?: string } | null;
                }>;
              };
              const { data: inviteRows } = await inviteClient
                .rpc('get_league_invite_by_id', { p_league_id: urlLeagueId });
              const leagueInfo = inviteRows?.[0];
              const joinCode = leagueInfo?.join_code;
              if (joinCode) {
                navigate(`/create-league?tab=join&code=${joinCode}`, { replace: true });
                toast({
                  title: "Almost there!",
                  description: `Hit "Join League" to join "${leagueInfo?.name || 'this league'}".`,
                });
                return;
              }
            } catch { /* fall through */ }
            // No safe league destination — send to a neutral page. For
            // playoff pool users we never dump them on GM Office (a
            // fantasy-only page). Homepage is the safest fallback.
            navigate('/');
            toast({
              title: "Access Denied",
              description: "You are not a member of this league.",
              variant: "destructive"
            });
            return;
          } catch (error) {
            logger.error('[LeagueContext] Error verifying membership:', error);
            navigate('/');
            toast({
              title: "Access Check Failed",
              description: "Couldn't verify your league access. Try again in a moment.",
              variant: "destructive"
            });
            return;
          }
        }

        // Explicitly verify membership (defense in depth). For users who
        // just joined, the read can lag behind the write — retry once
        // after a short delay before giving up.
        const verifyWithRetry = async (): Promise<boolean> => {
          try {
            const first = await LeagueMembershipService.verifyMembership(urlLeagueId, user.id);
            if (first) return true;
            await new Promise(r => setTimeout(r, 400));
            return await LeagueMembershipService.verifyMembership(urlLeagueId, user.id);
          } catch {
            return false;
          }
        };

        try {
          const isMember = await verifyWithRetry();

          if (isMember) {
            setActiveLeagueIdState(urlLeagueId);
            setActiveLeague(league);
          } else {
            logger.error('[LeagueContext] Membership verification failed for league:', urlLeagueId);
            // Route the user based on league type so pool users don't
            // land on the fantasy-only GM Office page.
            const leagueType = (league.settings as Record<string, unknown> | undefined)?.leagueType as string | undefined;
            const isPool = leagueType && leagueType !== 'fantasy';
            navigate(isPool ? '/' : '/gm-office');
            toast({
              title: "Access Denied",
              description: "You are not a member of this league.",
              variant: "destructive"
            });
          }
        } catch (error) {
          logger.error('[LeagueContext] Error verifying membership:', error);
          const leagueType = (league.settings as Record<string, unknown> | undefined)?.leagueType as string | undefined;
          const isPool = leagueType && leagueType !== 'fantasy';
          navigate(isPool ? '/' : '/gm-office');
          toast({
            title: "Access Check Failed",
            description: "Couldn't verify your league access. Try again in a moment.",
            variant: "destructive"
          });
        }
      };

      verifyAndSetLeague();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setActiveLeagueId/setIsChangingLeague are stable; verifyAndSetLeague is inline. Listed deps are the actual triggers for league verification.
  }, [urlLeagueId, userLeagues, user, activeLeagueId, loading, navigate, toast]);

  // Derive league format from active league (memoized to avoid unnecessary re-renders)
  const activeLeagueFormat: ActiveLeagueFormat = useMemo(() => {
    if (!activeLeague) return DEFAULT_FORMAT;
    return getLeagueFormat(activeLeague);
  }, [activeLeague]);

  // Check if a playoff bracket exists for the active league (gates Playoffs nav tab)
  useEffect(() => {
    // Reset immediately on every league switch so stale state from the previous
    // league doesn't leak the Playoffs tab into leagues that have no bracket.
    setShowPlayoffs(false);

    if (!activeLeagueId || !user) return;

    const playoffTeams = (activeLeague?.settings as Record<string, unknown>)?.playoffTeams;
    if (!playoffTeams || Number(playoffTeams) === 0) return;

    let cancelled = false;
    playoffApi.getBracket(activeLeagueId).then((res) => {
      if (cancelled) return;
      setShowPlayoffs(!!((res.data as Record<string, unknown>)?.bracket));
    }).catch(() => {
      if (!cancelled) setShowPlayoffs(false);
    });

    return () => { cancelled = true; };
  }, [activeLeagueId, activeLeague, user]);

  const value: LeagueContextType = {
    activeLeagueId,
    activeLeague,
    activeLeagueFormat,
    userLeagues,
    setActiveLeagueId,
    loading,
    isChangingLeague,
    error,
    refreshLeagues,
    userLeagueState,
    showPlayoffs,
    demoLeagueId: DEMO_LEAGUE_ID,
    isDemoLeague,
  };

  return <LeagueContext.Provider value={value}>{children}</LeagueContext.Provider>;
};

