import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  HockeyFooter,
  CupIcon,
  CrossedSticksIcon,
  PuckIcon,
  ScoreboardIcon,
  XGModelIcon,
  SlateIcon,
  DraftIcon,
  ShiftIcon,
  MaskIcon,
  RangeIcon,
  MascotPortrait,
} from '@/components/citrus2';
import { StormyLoading } from '@/components/citrus2/StormyLoading';
import { useAuth } from '@/contexts/AuthContext';
import { useProfile } from '@/hooks/useProfile';
import { LeagueService, League, Team } from '@/services/LeagueService';
import { WaiverService } from '@/services/WaiverService';
import { leagueApi } from '@/api/leagues';
import { rosterApi } from '@/api/rosters';
import Navbar from '@/components/Navbar';
import { LeagueTimelineCard } from '@/components/dashboard/LeagueTimelineCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Trophy, Users, Calendar, Settings, Play, Copy, CheckCircle, Clock, Shield, RefreshCw, UserPlus, Crown, Mail, ArrowLeftRight, Layers } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import LeagueNotifications from '@/components/matchup/LeagueNotifications';
import { TradeService } from '@/services/TradeService';
import { extractFormatSettings, AVAILABLE_CATEGORIES, DEFAULT_ROSTER_SLOTS, type LeagueSettings } from '@/types/leagueTypes';
import { logger } from '@/utils/logger';

const LeagueDashboard = () => {
  const { leagueId } = useParams<{ leagueId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [league, setLeague] = useState<League | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [userTeam, setUserTeam] = useState<Team | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Commissioner Settings State
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [processingWaivers, setProcessingWaivers] = useState(false);
  const [waiverSettings, setWaiverSettings] = useState({
    waiver_process_time: '02:00:00',
    waiver_period_hours: 48,
    waiver_game_lock: true,
    waiver_type: 'rolling' as 'rolling' | 'faab' | 'reverse_standings',
    allow_trades_during_games: true,
    weeklyAddLimit: 0,
    seasonAddLimit: 0,
  });
  
  // Scoring settings state
  const [scoringSettings, setScoringSettings] = useState<{
    skater?: Record<string, number>;
    goalie?: Record<string, number>;
  }>({});
  
  // Draft settings state
  const [draftSettings, setDraftSettings] = useState({
    draft_rounds: 21,
    pickTimeLimit: 90,
  });
  
  // Roster counts state (for roster overview tab)
  const [rosterCounts, setRosterCounts] = useState<Record<string, number>>({});
  const [loadingRosterCounts, setLoadingRosterCounts] = useState(false);
  
  // Trade review settings state
  const [tradeSettings, setTradeSettings] = useState({
    trade_review_type: 'none' as 'none' | 'commissioner' | 'league_vote',
    trade_review_period_hours: 48,
    trade_veto_threshold: 0.5,
  });

  // Keeper/Dynasty settings state
  const [keeperSettings, setKeeperSettings] = useState({
    keeperEnabled: false,
    keeperCount: 0,
    keeperPenalty: 'none' as 'none' | 'round-cost' | 'round-escalation',
    dynastyMode: false,
  });

  // Category settings state
  const [categorySettings, setCategorySettings] = useState<string[]>([]);

  // Roster slot settings state
  const [rosterSlotSettings, setRosterSlotSettings] = useState<Record<string, number>>({});

  // Playoff settings state
  const [playoffSettings, setPlayoffSettings] = useState({
    playoffTeams: 6 as number,
    playoffWeeks: 3 as number,
  });

  // Active settings tab
  const [activeSettingsTab, setActiveSettingsTab] = useState('waivers');

  const loadLeagueData = useCallback(async () => {
    if (!leagueId || !user) return;

    try {
      setLoading(true);
      setError(null);

      // Load league (with membership validation)
      const { league: leagueData, error: leagueError } = await LeagueService.getLeague(leagueId, user.id);
      if (leagueError) {
        // Check if it's an access denied error
        if ((leagueError as Error).message?.includes('Access denied') || (leagueError as Error).message?.includes('not a member')) {
          navigate('/gm-office');
          toast({
            title: "Wrong League",
            description: "This one's not on your list — check the invite link or pick one from GM Office.",
            variant: "destructive"
          });
          return;
        }
        throw leagueError;
      }
      if (!leagueData) throw new Error('League not found');

      // Guard: redirect pool leagues to their proper pages
      const leagueTypeFromSettings = (leagueData.settings as LeagueSettings)?.leagueType;
      if (leagueTypeFromSettings && leagueTypeFromSettings !== 'fantasy') {
        const poolRoutes: Record<string, string> = {
          'pickem': '/pool/pickem',
          'survivor': '/pool/survivor',
          'confidence-pool': '/pool/confidence',
        };
        const poolRoute = poolRoutes[leagueTypeFromSettings as string];
        if (poolRoute) {
          navigate(`${poolRoute}?league=${leagueId}`);
          return;
        }
      }

      setLeague(leagueData);

      // Update waiver settings from league data (including transaction limits from JSONB)
      const leagueSettings = (leagueData.settings as LeagueSettings) || {};
      setWaiverSettings({
        waiver_process_time: leagueData.waiver_process_time || '02:00:00',
        waiver_period_hours: leagueData.waiver_period_hours || 48,
        waiver_game_lock: leagueData.waiver_game_lock ?? true,
        waiver_type: leagueData.waiver_type || 'rolling',
        allow_trades_during_games: leagueData.allow_trades_during_games ?? true,
        weeklyAddLimit: (leagueSettings.weeklyAddLimit as number) ?? 0,
        seasonAddLimit: (leagueSettings.seasonAddLimit as number) ?? 0,
      });
      
      // Update scoring settings from league data
      if (leagueData.scoring_settings) {
        setScoringSettings(leagueData.scoring_settings);
      }
      
      // Update draft settings from league data
      setDraftSettings({
        draft_rounds: leagueData.draft_rounds || 21,
        pickTimeLimit: (leagueData.settings as LeagueSettings)?.pickTimeLimit as number || 90,
      });

      // Update trade review settings
      const fmt = extractFormatSettings((leagueData.settings as LeagueSettings) || {});
      setTradeSettings({
        trade_review_type: (fmt.tradeReviewType || 'none') as 'none' | 'commissioner' | 'league_vote',
        trade_review_period_hours: fmt.tradeReviewPeriodHours || 48,
        trade_veto_threshold: fmt.tradeVetoThreshold || 0.5,
      });

      // Update keeper/dynasty settings
      setKeeperSettings({
        keeperEnabled: fmt.keeperEnabled || false,
        keeperCount: fmt.keeperCount || 0,
        keeperPenalty: (fmt.keeperPenalty || 'none') as 'none' | 'round-cost' | 'round-escalation',
        dynastyMode: fmt.dynastyMode || false,
      });

      // Update category settings
      if (fmt.categories && fmt.categories.length > 0) {
        setCategorySettings(fmt.categories);
      }

      // Update playoff settings
      setPlayoffSettings({
        playoffTeams: (fmt.playoffTeams as number) ?? 6,
        playoffWeeks: (fmt.playoffWeeks as number) ?? 3,
      });

      // Update roster slot settings
      if (fmt.rosterSlots) {
        setRosterSlotSettings(fmt.rosterSlots);
      } else {
        // Set defaults from DEFAULT_ROSTER_SLOTS
        const defaults: Record<string, number> = {};
        DEFAULT_ROSTER_SLOTS.forEach(s => { defaults[s.slot] = s.count; });
        setRosterSlotSettings(defaults);
      }

      // Load teams
      const { teams: teamsData, error: teamsError } = await LeagueService.getLeagueTeams(leagueId);
      if (teamsError) {
        logger.error('Error loading teams:', teamsError);
        throw teamsError;
      }
      setTeams(teamsData || []);

      // Load user's team
      const { team: userTeamData } = await LeagueService.getUserTeam(leagueId, user.id);
      setUserTeam(userTeamData);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't load the league — refresh to try again.");
    } finally {
      setLoading(false);
    }
  }, [leagueId, user, navigate, toast]);

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }
    if (!leagueId) {
      setError('Invalid league ID');
      setLoading(false);
      return;
    }
    loadLeagueData();
  }, [leagueId, user, navigate, loadLeagueData]);

  // Reload data when page becomes visible again (user navigates back)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && leagueId && user) {
        loadLeagueData();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [leagueId, user, loadLeagueData]);

  const handleSimulateFill = async () => {
    if (!leagueId) {
      logger.error('handleSimulateFill: No leagueId');
      return;
    }

    // Prevent multiple simultaneous calls
    if (simulating) {
      return;
    }

    setSimulating(true);
    
    try {
      const { error: simError } = await LeagueService.simulateLeagueFill(leagueId, 12);
      
      if (simError) {
        logger.error('handleSimulateFill: Error from simulateLeagueFill:', simError);
        const errorMessage = (simError as Error).message || JSON.stringify(simError) || 'Failed to simulate teams';
        toast({
          title: 'Error Creating Teams',
          description: errorMessage,
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: 'Teams Created',
        description: 'Simulated teams have been added to the league.',
      });

      // Wait a moment for the database to update and ensure consistency
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Reload teams - try a few times in case of eventual consistency
      let teamsData;
      let reloadError;
      let retries = 3;
      
      while (retries > 0) {
        const result = await LeagueService.getLeagueTeams(leagueId);
        teamsData = result.teams;
        reloadError = result.error;
        
        if (!reloadError && teamsData && teamsData.length > 0) {
          break; // Successfully loaded teams
        }
        
        retries--;
        if (retries > 0) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      if (reloadError) {
        logger.error('handleSimulateFill: Error reloading teams:', reloadError);
        toast({
          title: 'Warning',
          description: 'Teams were created but could not be reloaded. Please refresh the page.',
          variant: 'destructive',
        });
      } else {
        setTeams(teamsData || []);
        
        if (teamsData && teamsData.length > 0) {
          toast({
            title: 'League Updated',
            description: `${teamsData.length} teams are now in the league.`,
          });
        }
      }
    } catch (err: unknown) {
      logger.error('handleSimulateFill: Exception:', err);
      toast({
        title: "Simulation Didn't Take",
        description: err instanceof Error ? err.message : "Couldn't simulate the teams — try again in a moment.",
        variant: 'destructive',
      });
    } finally {
      setSimulating(false);
    }
  };

  const copyJoinCode = () => {
    if (!league?.join_code) return;
    navigator.clipboard.writeText(league.join_code);
    toast({
      title: 'Copied!',
      description: 'Join code copied to clipboard',
    });
  };

  // Load roster counts when rosters tab is opened
  useEffect(() => {
    if (activeSettingsTab === 'rosters' && leagueId && teams.length > 0) {
      const loadRosterCounts = async () => {
        setLoadingRosterCounts(true);
        const counts: Record<string, number> = {};
        
        for (const team of teams) {
          try {
            const response = await rosterApi.getPlayerIds(leagueId, team.id);
            const playerIds = (response.data || []) as unknown[];
            counts[team.id] = playerIds.length;
          } catch {
            counts[team.id] = 0;
          }
        }
        
        setRosterCounts(counts);
        setLoadingRosterCounts(false);
      };
      
      loadRosterCounts();
    }
  }, [activeSettingsTab, leagueId, teams]);
  
  const handleSaveSettings = async () => {
    if (!leagueId || !user) return;
    
    setSavingSettings(true);
    try {
      let saved = false;
      let errorMessage = '';
      
      // Save based on active tab
      if (activeSettingsTab === 'waivers') {
        // Save column-level waiver settings
        const { waiver_process_time, waiver_period_hours, waiver_game_lock, waiver_type, allow_trades_during_games } = waiverSettings;
        const { success, error: saveError } = await LeagueService.updateWaiverSettings(
          leagueId,
          user.id,
          { waiver_process_time, waiver_period_hours, waiver_game_lock, waiver_type, allow_trades_during_games }
        );
        saved = success;
        errorMessage = (saveError as Error)?.message || 'Failed to save waiver settings';

        // Also persist transaction limits into JSONB settings column
        if (saved) {
          const { weeklyAddLimit = 0, seasonAddLimit = 0 } = waiverSettings;
          const leagueResponse = await leagueApi.getLeague(leagueId);
          const currentLeague = leagueResponse.data as Record<string, unknown> | undefined;
          if (currentLeague) {
            const currentSettings = (currentLeague.settings as LeagueSettings) || {};
            await leagueApi.updateSettings(leagueId, {
              settings: { ...currentSettings, weeklyAddLimit, seasonAddLimit },
            });
          }
        }
      } else if (activeSettingsTab === 'scoring') {
        const { success, error: saveError } = await LeagueService.updateScoringSettings(
          leagueId,
          user.id,
          scoringSettings
        );
        saved = success;
        errorMessage = (saveError as Error)?.message || 'Failed to save scoring settings';
      } else if (activeSettingsTab === 'draft') {
        const { success, error: saveError } = await LeagueService.updateDraftSettings(
          leagueId,
          user.id,
          draftSettings
        );
        saved = success;
        errorMessage = (saveError as Error)?.message || 'Failed to save draft settings';
      } else if (activeSettingsTab === 'trades') {
        const { success, error: tradeErr } = await TradeService.updateTradeReviewSettings(
          leagueId,
          user.id,
          tradeSettings
        );
        saved = success;
        errorMessage = tradeErr || 'Failed to save trade settings';
      } else if (activeSettingsTab === 'keeper') {
        const { success, error: keeperErr } = await LeagueService.updateKeeperSettings(
          leagueId,
          user.id,
          keeperSettings
        );
        saved = success;
        errorMessage = (keeperErr as Error)?.message || 'Failed to save keeper settings';
      } else if (activeSettingsTab === 'categories') {
        const { success, error: catErr } = await LeagueService.updateCategorySettings(
          leagueId,
          user.id,
          categorySettings
        );
        saved = success;
        errorMessage = (catErr as Error)?.message || 'Failed to save category settings';
      } else if (activeSettingsTab === 'rosterslots') {
        const { success, error: slotErr } = await LeagueService.updateRosterSlotSettings(
          leagueId,
          user.id,
          rosterSlotSettings
        );
        saved = success;
        errorMessage = (slotErr as Error)?.message || 'Failed to save roster slot settings';
      } else if (activeSettingsTab === 'playoffs') {
        // Save playoff settings into the JSONB settings column
        const leagueResponse = await leagueApi.getLeague(leagueId);
        const currentLeague = leagueResponse.data as Record<string, unknown> | undefined;
        if (currentLeague) {
          const currentSettings = (currentLeague.settings as LeagueSettings) || {};
          const { error: playoffErr } = await leagueApi.updateSettings(leagueId, {
            settings: {
              ...currentSettings,
              playoffTeams: playoffSettings.playoffTeams,
              playoffWeeks: playoffSettings.playoffWeeks,
            },
          });
          saved = !playoffErr;
          errorMessage = playoffErr || 'Failed to save playoff settings';
        } else {
          saved = false;
          errorMessage = 'Could not load current league settings';
        }
      }

      if (!saved) {
        toast({
          title: "Settings Didn't Stick",
          description: errorMessage,
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: 'Settings Saved',
        description: `League ${activeSettingsTab} settings have been updated. All league members have been notified.`,
      });
      setSettingsOpen(false);
      
      // Reload league data to reflect changes
      loadLeagueData();
    } catch (err: unknown) {
      toast({
        title: "Settings Didn't Stick",
        description: err instanceof Error ? err.message : "Couldn't save the settings — try again in a moment.",
        variant: 'destructive',
      });
    } finally {
      setSavingSettings(false);
    }
  };

  // Determine if user is commissioner (needs to be before handler functions that use it)
  const isCommissioner = league?.commissioner_id === user?.id;

  // Process waivers manually (commissioner only)
  const handleProcessWaivers = async () => {
    if (!leagueId || !user || !isCommissioner) return;

    setProcessingWaivers(true);
    try {
      const result = await WaiverService.processAllPendingWaivers();

      if (!result.success) {
        toast({
          title: "Waivers Didn't Process",
          description: result.error || "Couldn't process the waiver run — retrying might help.",
          variant: 'destructive',
        });
        return;
      }

      // Find results for this league
      const leagueResult = result.results.find(r => r.league_id === leagueId);
      
      if (leagueResult && leagueResult.total_processed > 0) {
        toast({
          title: 'Waivers Processed',
          description: `Processed ${leagueResult.total_processed} claims: ${leagueResult.successful} successful, ${leagueResult.failed} failed`,
        });
      } else {
        toast({
          title: 'No Pending Claims',
          description: 'There are no pending waiver claims to process.',
        });
      }
    } catch (err: unknown) {
      toast({
        title: "Waivers Didn't Process",
        description: err instanceof Error ? err.message : "Couldn't process the waiver run — retrying might help.",
        variant: 'destructive',
      });
    } finally {
      setProcessingWaivers(false);
    }
  };

  // Sync rosters from draft picks (commissioner only) - safety net for roster sync issues
  const [syncingRosters, setSyncingRosters] = useState(false);
  const handleSyncRosters = async () => {
    if (!leagueId || !user || !isCommissioner) return;

    setSyncingRosters(true);
    try {
      // Step 1: Sync roster_assignments from draft_picks
      const syncResponse = await rosterApi.syncRosters(leagueId);
      const syncResult = syncResponse.data;

      if (!syncResult) {
        toast({
          title: "Roster Sync Didn't Take",
          description: "Couldn't sync the rosters — try again in a moment.",
          variant: 'destructive',
        });
        return;
      }

      const playersSynced = (syncResult as any)?.players_synced || 0;

      // Step 2: Also rebuild team_lineups from roster_assignments
      try {
        const { DraftService } = await import('@/services/DraftService');
        await DraftService.initializeRostersForAllTeams(leagueId);
        toast({
          title: 'Rosters Synced',
          description: `Synced ${playersSynced} players and rebuilt all team lineups.`,
        });
      } catch (lineupErr) {
        logger.error('Failed to rebuild team_lineups:', lineupErr);
        toast({
          title: 'Partial Sync',
          description: `Synced ${playersSynced} players. Team lineups may need a page refresh.`,
        });
      }
      
      // Reload league data to reflect changes
      loadLeagueData();
    } catch (err: unknown) {
      toast({
        title: "Roster Sync Didn't Take",
        description: err instanceof Error ? err.message : "Couldn't sync the rosters — try again in a moment.",
        variant: 'destructive',
      });
    } finally {
      setSyncingRosters(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0F1F15]">
        <StormyLoading message="Loading your league…" />
      </div>
    );
  }

  if (error || !league) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center p-4">
          <Card className="w-full max-w-md bg-[#1A2A20] border-0 ring-1 ring-red-400/40 rounded-2xl shadow-[0_24px_60px_-16px_rgba(248,113,113,0.2)]">
            <CardHeader>
              <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-red-300 font-bold mb-1.5">
                ✦ League not found
              </div>
              <CardTitle className="font-calistoga text-2xl text-pastel-cream">Something went sideways.</CardTitle>
              <CardDescription className="text-white/55">{error || 'We couldn’t find that league.'}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => navigate('/')}
                className="bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft font-bold shadow-[0_8px_24px_-8px_rgba(255,168,87,0.5)]"
              >
                Go Home
              </Button>
            </CardContent>
          </Card>
        </main>
        <HockeyFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0F1F15] text-pastel-cream flex flex-col">
      <div className="hidden lg:block"><Navbar /></div>
      <div className="lg:hidden sticky top-0 z-40 bg-[#0F1F15]/95 backdrop-blur-xl border-b border-white/10 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-center h-12 px-4">
          <h1 className="text-lg font-bold text-pastel-cream">League</h1>
        </div>
      </div>
      <main className="w-full lg:pt-24 lg:pb-8 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        <div className="w-full m-0 p-0">
          <div className="flex flex-col lg:grid lg:grid-cols-[200px_1fr_260px] xl:grid-cols-[220px_1fr_280px] lg:gap-4 xl:gap-6 lg:px-4 xl:px-6 lg:mx-0 lg:w-screen lg:relative lg:left-1/2 lg:-translate-x-1/2">
            <div className="min-w-0 px-2 lg:px-6 order-1 lg:order-2">

              {/* Header */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4 gap-3">
              <div className="min-w-0">
                <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-1.5 flex items-center gap-2">
                  <CupIcon className="w-3.5 h-3.5" strokeWidth={2} aria-hidden="true" />
                  ✦ League HQ
                </div>
                <h1 className="font-calistoga text-3xl sm:text-4xl text-pastel-cream leading-none mb-3 truncate">{league.name}</h1>
                <div className="flex items-center gap-2 flex-wrap">
                  {(() => {
                    const status = league.draft_status;
                    const cls = status === 'completed'
                      ? 'bg-pastel-sage/20 ring-1 ring-pastel-sage/40 text-pastel-sage-soft'
                      : status === 'in_progress'
                      ? 'bg-pastel-orange/20 ring-1 ring-pastel-orange/40 text-pastel-orange-soft'
                      : 'bg-white/10 ring-1 ring-white/20 text-white/70';
                    return (
                      <Badge className={`${cls} border-0 text-[10px] font-jbmono uppercase tracking-[0.18em] font-bold`}>
                        {status === 'not_started' && 'Not Started'}
                        {status === 'in_progress' && 'Draft Live'}
                        {status === 'completed' && 'Draft Complete'}
                      </Badge>
                    );
                  })()}
                  {isCommissioner && (
                    <Badge className="bg-pastel-orange/20 ring-1 ring-pastel-orange/40 text-pastel-orange-soft border-0 flex items-center gap-1 text-[10px] font-jbmono uppercase tracking-[0.18em] font-bold">
                      <Crown className="h-3 w-3" aria-hidden="true" />
                      Commissioner
                    </Badge>
                  )}
                </div>
              </div>
              {isCommissioner && (
                <div className="flex gap-2">
                  <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
                    <DialogTrigger asChild>
                      <Button
                        variant="outline"
                        className="bg-transparent border border-pastel-cream/30 text-pastel-cream hover:bg-white/5 hover:border-pastel-cream/50 font-bold shrink-0"
                      >
                        <Settings className="mr-2 h-4 w-4" aria-hidden="true" />
                        League Settings
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto bg-[#1A2A20] border-0 ring-1 ring-pastel-orange/30 text-pastel-cream">
                      <DialogHeader>
                        <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-1">
                          ✦ Commissioner
                        </div>
                        <DialogTitle className="flex items-center gap-2 font-calistoga text-pastel-cream">
                          <Settings className="h-5 w-5 text-pastel-orange" aria-hidden="true" />
                          League Settings
                        </DialogTitle>
                        <DialogDescription className="text-white/55">
                          Configure all league settings. Changes will notify all league members.
                        </DialogDescription>
                      </DialogHeader>
                      
                      <Tabs value={activeSettingsTab} onValueChange={setActiveSettingsTab} className="w-full">
                        <div className="overflow-x-auto -mx-2 px-2">
                          <TabsList className="inline-flex w-auto min-w-full bg-[#0F1F15] ring-1 ring-white/10 p-1 rounded-xl">
                            {(['waivers','scoring','draft','trades','rosterslots','playoffs','rosters'] as const).map((tab) => (
                              <TabsTrigger
                                key={tab}
                                value={tab}
                                className="text-white/55 hover:text-pastel-cream font-bold data-[state=active]:bg-pastel-orange data-[state=active]:text-[#581E00] data-[state=active]:shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)]"
                              >
                                {tab === 'rosterslots' ? 'Roster Slots' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                              </TabsTrigger>
                            ))}
                          </TabsList>
                        </div>
                        
                        {/* Waiver Settings Tab */}
                        <TabsContent value="waivers" className="space-y-6 py-4">
                        {/* Waiver Process Time */}
                        <div className="space-y-2">
                          <Label className="flex items-center gap-2">
                            <Clock className="h-4 w-4" aria-hidden="true" />
                            Waiver Process Time (MT)
                          </Label>
                          <Select 
                            value={waiverSettings.waiver_process_time}
                            onValueChange={(value) => setWaiverSettings(prev => ({ ...prev, waiver_process_time: value }))}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="00:00:00">12:00 AM (Midnight)</SelectItem>
                              <SelectItem value="02:00:00">2:00 AM (Default)</SelectItem>
                              <SelectItem value="03:00:00">3:00 AM</SelectItem>
                              <SelectItem value="06:00:00">6:00 AM</SelectItem>
                              <SelectItem value="09:00:00">9:00 AM</SelectItem>
                              <SelectItem value="12:00:00">12:00 PM (Noon)</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-white/55">
                            Time when waiver claims are processed daily
                          </p>
                        </div>

                        {/* Waiver Period */}
                        <div className="space-y-2">
                          <Label className="flex items-center gap-2">
                            <RefreshCw className="h-4 w-4" aria-hidden="true" />
                            Waiver Period (Hours)
                          </Label>
                          <Select 
                            value={waiverSettings.waiver_period_hours.toString()}
                            onValueChange={(value) => setWaiverSettings(prev => ({ ...prev, waiver_period_hours: parseInt(value) }))}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="24">24 hours (1 day)</SelectItem>
                              <SelectItem value="48">48 hours (2 days)</SelectItem>
                              <SelectItem value="72">72 hours (3 days)</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-white/55">
                            How long dropped players stay on waivers
                          </p>
                        </div>

                        {/* Waiver Type */}
                        <div className="space-y-2">
                          <Label className="flex items-center gap-2">
                            <Trophy className="h-4 w-4" aria-hidden="true" />
                            Waiver Type
                          </Label>
                          <Select 
                            value={waiverSettings.waiver_type}
                            onValueChange={(value: 'rolling' | 'faab' | 'reverse_standings') => setWaiverSettings(prev => ({ ...prev, waiver_type: value }))}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="rolling">Rolling Priority</SelectItem>
                              <SelectItem value="reverse_standings">Reverse Standings</SelectItem>
                              <SelectItem value="faab">FAAB (Bidding)</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-white/55">
                            Rolling: Priority moves after claim. Reverse: Worst team gets priority.
                          </p>
                        </div>

                        {/* Game Lock */}
                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label className="flex items-center gap-2">
                              <Shield className="h-4 w-4" aria-hidden="true" />
                              Game Lock
                            </Label>
                            <p className="text-xs text-white/55">
                              Lock players during/after their games
                            </p>
                          </div>
                          <Switch
                            checked={waiverSettings.waiver_game_lock}
                            onCheckedChange={(checked) => setWaiverSettings(prev => ({ ...prev, waiver_game_lock: checked }))}
                          />
                        </div>

                        {/* Allow Trades During Games */}
                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label className="flex items-center gap-2">
                              <RefreshCw className="h-4 w-4" aria-hidden="true" />
                              Allow Trades During Games
                            </Label>
                            <p className="text-xs text-white/55">
                              Players can be traded even if game-locked
                            </p>
                          </div>
                          <Switch
                            checked={waiverSettings.allow_trades_during_games}
                            onCheckedChange={(checked) => setWaiverSettings(prev => ({ ...prev, allow_trades_during_games: checked }))}
                          />
                        </div>

                        {/* Transaction Limits - ESPN/Yahoo/Sleeper industry standard */}
                        <div className="space-y-2">
                          <Label className="flex items-center gap-2">
                            <Layers className="h-4 w-4" aria-hidden="true" />
                            Max Adds Per Week
                          </Label>
                          <Select
                            value={waiverSettings.weeklyAddLimit?.toString() || '0'}
                            onValueChange={(value) => setWaiverSettings(prev => ({ ...prev, weeklyAddLimit: parseInt(value) }))}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">Unlimited (Default)</SelectItem>
                              <SelectItem value="2">2 per week</SelectItem>
                              <SelectItem value="3">3 per week</SelectItem>
                              <SelectItem value="4">4 per week</SelectItem>
                              <SelectItem value="5">5 per week</SelectItem>
                              <SelectItem value="6">6 per week</SelectItem>
                              <SelectItem value="7">7 per week</SelectItem>
                              <SelectItem value="10">10 per week</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-white/55">
                            Limit how many free agent pickups a team can make each week. Resets every Monday.
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label className="flex items-center gap-2">
                            <Layers className="h-4 w-4" aria-hidden="true" />
                            Max Adds Per Season
                          </Label>
                          <Select
                            value={waiverSettings.seasonAddLimit?.toString() || '0'}
                            onValueChange={(value) => setWaiverSettings(prev => ({ ...prev, seasonAddLimit: parseInt(value) }))}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">Unlimited (Default)</SelectItem>
                              <SelectItem value="25">25 per season</SelectItem>
                              <SelectItem value="50">50 per season</SelectItem>
                              <SelectItem value="75">75 per season</SelectItem>
                              <SelectItem value="100">100 per season</SelectItem>
                              <SelectItem value="150">150 per season</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-white/55">
                            Limit total free agent pickups for the entire season.
                          </p>
                        </div>

                        {/* Manual Waiver Processing */}
                        <div className="border-t pt-4 mt-4 space-y-4">
                          <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                              <Label className="flex items-center gap-2">
                                <Play className="h-4 w-4" aria-hidden="true" />
                                Process Waivers Now
                              </Label>
                              <p className="text-xs text-white/55">
                                Manually process all pending waiver claims
                              </p>
                            </div>
                            <Button 
                              variant="secondary" 
                              size="sm"
                              onClick={handleProcessWaivers}
                              disabled={processingWaivers}
                            >
                              {processingWaivers ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                                  Processing...
                                </>
                              ) : (
                                <>
                                  <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                                  Process Now
                                </>
                              )}
                            </Button>
                          </div>
                          
                          {/* Sync Rosters Button */}
                          <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                              <Label className="flex items-center gap-2">
                                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                                Sync Rosters from Draft
                              </Label>
                              <p className="text-xs text-white/55">
                                Re-sync roster_assignments from draft_picks (safety net)
                              </p>
                            </div>
                            <Button 
                              variant="secondary" 
                              size="sm"
                              onClick={handleSyncRosters}
                              disabled={syncingRosters}
                            >
                              {syncingRosters ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                                  Syncing...
                                </>
                              ) : (
                                <>
                                  <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                                  Sync Now
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                        </TabsContent>
                        
                        {/* Scoring Settings Tab */}
                        <TabsContent value="scoring" className="space-y-6 py-4">
                          <div className="space-y-4">
                            <div>
                              <h3 className="text-lg font-semibold mb-2">Skater Scoring</h3>
                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <Label>Goals</Label>
                                  <Input
                                    type="number"
                                    step="0.1"
                                    value={scoringSettings.skater?.goals || 3}
                                    onChange={(e) => setScoringSettings(prev => ({
                                      ...prev,
                                      skater: { ...prev.skater, goals: parseFloat(e.target.value) || 0 }
                                    }))}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>Assists</Label>
                                  <Input
                                    type="number"
                                    step="0.1"
                                    value={scoringSettings.skater?.assists || 2}
                                    onChange={(e) => setScoringSettings(prev => ({
                                      ...prev,
                                      skater: { ...prev.skater, assists: parseFloat(e.target.value) || 0 }
                                    }))}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>Power Play Points</Label>
                                  <Input
                                    type="number"
                                    step="0.1"
                                    value={scoringSettings.skater?.power_play_points || 1}
                                    onChange={(e) => setScoringSettings(prev => ({
                                      ...prev,
                                      skater: { ...prev.skater, power_play_points: parseFloat(e.target.value) || 0 }
                                    }))}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>Shorthanded Points</Label>
                                  <Input
                                    type="number"
                                    step="0.1"
                                    value={scoringSettings.skater?.short_handed_points || 2}
                                    onChange={(e) => setScoringSettings(prev => ({
                                      ...prev,
                                      skater: { ...prev.skater, short_handed_points: parseFloat(e.target.value) || 0 }
                                    }))}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>Shots on Goal</Label>
                                  <Input
                                    type="number"
                                    step="0.1"
                                    value={scoringSettings.skater?.shots_on_goal || 0.4}
                                    onChange={(e) => setScoringSettings(prev => ({
                                      ...prev,
                                      skater: { ...prev.skater, shots_on_goal: parseFloat(e.target.value) || 0 }
                                    }))}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>Blocks</Label>
                                  <Input
                                    type="number"
                                    step="0.1"
                                    value={scoringSettings.skater?.blocks || 0.5}
                                    onChange={(e) => setScoringSettings(prev => ({
                                      ...prev,
                                      skater: { ...prev.skater, blocks: parseFloat(e.target.value) || 0 }
                                    }))}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>Hits</Label>
                                  <Input
                                    type="number"
                                    step="0.1"
                                    value={scoringSettings.skater?.hits || 0.2}
                                    onChange={(e) => setScoringSettings(prev => ({
                                      ...prev,
                                      skater: { ...prev.skater, hits: parseFloat(e.target.value) || 0 }
                                    }))}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>Penalty Minutes</Label>
                                  <Input
                                    type="number"
                                    step="0.1"
                                    value={scoringSettings.skater?.penalty_minutes || 0.5}
                                    onChange={(e) => setScoringSettings(prev => ({
                                      ...prev,
                                      skater: { ...prev.skater, penalty_minutes: parseFloat(e.target.value) || 0 }
                                    }))}
                                  />
                                </div>
                              </div>
                            </div>
                            
                            <div>
                              <h3 className="text-lg font-semibold mb-2">Goalie Scoring</h3>
                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <Label>Wins</Label>
                                  <Input
                                    type="number"
                                    step="0.1"
                                    value={scoringSettings.goalie?.wins || 4}
                                    onChange={(e) => setScoringSettings(prev => ({
                                      ...prev,
                                      goalie: { ...prev.goalie, wins: parseFloat(e.target.value) || 0 }
                                    }))}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>Shutouts</Label>
                                  <Input
                                    type="number"
                                    step="0.1"
                                    value={scoringSettings.goalie?.shutouts || 3}
                                    onChange={(e) => setScoringSettings(prev => ({
                                      ...prev,
                                      goalie: { ...prev.goalie, shutouts: parseFloat(e.target.value) || 0 }
                                    }))}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>Saves</Label>
                                  <Input
                                    type="number"
                                    step="0.1"
                                    value={scoringSettings.goalie?.saves || 0.2}
                                    onChange={(e) => setScoringSettings(prev => ({
                                      ...prev,
                                      goalie: { ...prev.goalie, saves: parseFloat(e.target.value) || 0 }
                                    }))}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>Goals Against</Label>
                                  <Input
                                    type="number"
                                    step="0.1"
                                    value={scoringSettings.goalie?.goals_against || -1}
                                    onChange={(e) => setScoringSettings(prev => ({
                                      ...prev,
                                      goalie: { ...prev.goalie, goals_against: parseFloat(e.target.value) || 0 }
                                    }))}
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        </TabsContent>
                        
                        {/* Draft Settings Tab */}
                        <TabsContent value="draft" className="space-y-6 py-4">
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <Label>Draft Rounds</Label>
                              <Input
                                type="number"
                                value={draftSettings.draft_rounds}
                                onChange={(e) => setDraftSettings(prev => ({
                                  ...prev,
                                  draft_rounds: parseInt(e.target.value) || 21
                                }))}
                                disabled={league?.draft_status === 'completed'}
                              />
                              {league?.draft_status === 'completed' && (
                                <p className="text-xs text-white/55">Draft is completed - rounds cannot be changed</p>
                              )}
                            </div>
                            
                            <div className="space-y-2">
                              <Label>Pick Time Limit (seconds)</Label>
                              <Input
                                type="number"
                                value={draftSettings.pickTimeLimit}
                                onChange={(e) => setDraftSettings(prev => ({
                                  ...prev,
                                  pickTimeLimit: parseInt(e.target.value) || 90
                                }))}
                                disabled={league?.draft_status === 'completed'}
                              />
                              {league?.draft_status === 'completed' && (
                                <p className="text-xs text-white/55">Draft is completed - time limit cannot be changed</p>
                              )}
                            </div>
                          </div>
                        </TabsContent>
                        
                        {/* Trade Review Settings Tab */}
                        <TabsContent value="trades" className="space-y-6 py-4">
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <Label className="flex items-center gap-2">
                                <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
                                Trade Review Type
                              </Label>
                              <Select
                                value={tradeSettings.trade_review_type}
                                onValueChange={(value: 'none' | 'commissioner' | 'league_vote') =>
                                  setTradeSettings(prev => ({ ...prev, trade_review_type: value }))
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">Instant (no review)</SelectItem>
                                  <SelectItem value="commissioner">Commissioner Approval</SelectItem>
                                  <SelectItem value="league_vote">League Vote</SelectItem>
                                </SelectContent>
                              </Select>
                              <p className="text-xs text-white/55">
                                {tradeSettings.trade_review_type === 'none' && 'Trades are executed immediately when accepted.'}
                                {tradeSettings.trade_review_type === 'commissioner' && 'Trades require commissioner approval before being processed.'}
                                {tradeSettings.trade_review_type === 'league_vote' && 'League members vote on trades during the review window.'}
                              </p>
                            </div>

                            {tradeSettings.trade_review_type === 'league_vote' && (
                              <>
                                <div className="space-y-2">
                                  <Label>Review Period (Hours)</Label>
                                  <Select
                                    value={tradeSettings.trade_review_period_hours.toString()}
                                    onValueChange={(value) =>
                                      setTradeSettings(prev => ({ ...prev, trade_review_period_hours: parseInt(value) }))
                                    }
                                  >
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="24">24 hours</SelectItem>
                                      <SelectItem value="48">48 hours</SelectItem>
                                      <SelectItem value="72">72 hours</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <p className="text-xs text-white/55">
                                    How long league members have to vote on trades
                                  </p>
                                </div>

                                <div className="space-y-2">
                                  <Label>Veto Threshold</Label>
                                  <Select
                                    value={tradeSettings.trade_veto_threshold.toString()}
                                    onValueChange={(value) =>
                                      setTradeSettings(prev => ({ ...prev, trade_veto_threshold: parseFloat(value) }))
                                    }
                                  >
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="0.25">25% (easy veto)</SelectItem>
                                      <SelectItem value="0.5">50% (majority)</SelectItem>
                                      <SelectItem value="0.67">67% (super-majority)</SelectItem>
                                      <SelectItem value="0.75">75% (strong consensus)</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <p className="text-xs text-white/55">
                                    Percentage of league members needed to veto a trade
                                  </p>
                                </div>
                              </>
                            )}
                          </div>
                        </TabsContent>

                        {/* Roster Slot Configuration Tab */}
                        <TabsContent value="rosterslots" className="space-y-6 py-4">
                          <div className="space-y-4">
                            <div>
                              <h3 className="text-lg font-semibold mb-1">Roster Slot Configuration</h3>
                              <p className="text-xs text-white/55 mb-4">
                                Customize the number of each position slot.
                                {league?.draft_status === 'completed' && ' Some changes may affect active rosters.'}
                              </p>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              {DEFAULT_ROSTER_SLOTS.map((slot) => (
                                <div key={slot.slot} className="space-y-1">
                                  <Label>{slot.label} ({slot.slot})</Label>
                                  <Input
                                    type="number"
                                    min={0}
                                    max={10}
                                    value={rosterSlotSettings[slot.slot] ?? slot.count}
                                    onChange={(e) =>
                                      setRosterSlotSettings(prev => ({
                                        ...prev,
                                        [slot.slot]: parseInt(e.target.value) || 0,
                                      }))
                                    }
                                    disabled={league?.draft_status === 'completed'}
                                  />
                                </div>
                              ))}
                            </div>
                            {league?.draft_status === 'completed' && (
                              <p className="text-xs text-amber-600">
                                Roster slots are locked after the draft is completed.
                              </p>
                            )}
                          </div>
                        </TabsContent>

                        {/* Playoffs Settings Tab */}
                        <TabsContent value="playoffs" className="space-y-6 py-4">
                          <div className="space-y-4">
                            <div>
                              <h3 className="text-lg font-semibold mb-1">Playoff Settings</h3>
                              <p className="text-xs text-white/55 mb-4">
                                Configure how many teams make the playoffs and the playoff duration.
                              </p>
                            </div>

                            <div className="space-y-2">
                              <Label>Playoff Teams</Label>
                              <Select
                                value={String(playoffSettings.playoffTeams)}
                                onValueChange={(val) => setPlayoffSettings(prev => ({ ...prev, playoffTeams: parseInt(val) }))}
                              >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="0">No Playoffs</SelectItem>
                                  <SelectItem value="4">4 Teams</SelectItem>
                                  <SelectItem value="6">6 Teams (default)</SelectItem>
                                  <SelectItem value="8">8 Teams</SelectItem>
                                </SelectContent>
                              </Select>
                              <p className="text-xs text-white/55">
                                {playoffSettings.playoffTeams === 0 && 'League champion determined by regular season standings.'}
                                {playoffSettings.playoffTeams === 4 && '4-team bracket: Semifinals → Championship (2 rounds).'}
                                {playoffSettings.playoffTeams === 6 && '6-team bracket: Wild Card → Semifinals → Championship (3 rounds). Top 2 seeds get first-round byes.'}
                                {playoffSettings.playoffTeams === 8 && '8-team bracket: Quarterfinals → Semifinals → Championship (3 rounds).'}
                              </p>
                            </div>

                            {playoffSettings.playoffTeams > 0 && (
                              <div className="space-y-2">
                                <Label>Playoff Weeks</Label>
                                <Select
                                  value={String(playoffSettings.playoffWeeks)}
                                  onValueChange={(val) => setPlayoffSettings(prev => ({ ...prev, playoffWeeks: parseInt(val) }))}
                                >
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="2">2 Weeks</SelectItem>
                                    <SelectItem value="3">3 Weeks (default)</SelectItem>
                                    <SelectItem value="4">4 Weeks</SelectItem>
                                  </SelectContent>
                                </Select>
                                <p className="text-xs text-white/55">
                                  Total weeks reserved for the playoff bracket. Regular season length adjusts automatically.
                                </p>
                              </div>
                            )}

                            {playoffSettings.playoffTeams > 0 && (
                              <div className="rounded-xl ring-1 ring-white/10 bg-white/5 p-4 space-y-2">
                                <h4 className="text-sm font-semibold">Bracket Preview</h4>
                                <div className="text-xs text-white/55 space-y-1">
                                  {playoffSettings.playoffTeams === 4 && (
                                    <>
                                      <p>Round 1 (Semifinals): #1 vs #4, #2 vs #3</p>
                                      <p>Round 2 (Championship): Winners meet for the title</p>
                                    </>
                                  )}
                                  {playoffSettings.playoffTeams === 6 && (
                                    <>
                                      <p>Round 1 (Wild Card): #3 vs #6, #4 vs #5</p>
                                      <p>Round 2 (Semifinals): #1 vs WC winner, #2 vs WC winner</p>
                                      <p>Round 3 (Championship): Winners meet for the title</p>
                                    </>
                                  )}
                                  {playoffSettings.playoffTeams === 8 && (
                                    <>
                                      <p>Round 1 (Quarterfinals): #1 vs #8, #4 vs #5, #2 vs #7, #3 vs #6</p>
                                      <p>Round 2 (Semifinals): QF winners face off</p>
                                      <p>Round 3 (Championship): Winners meet for the title</p>
                                    </>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </TabsContent>

                        {/* Roster Overview Tab */}
                        <TabsContent value="rosters" className="space-y-6 py-4">
                          <div className="space-y-4">
                            <h3 className="text-lg font-semibold">Team Rosters</h3>
                            {loadingRosterCounts ? (
                              <div className="text-center py-4">
                                <Loader2 className="h-4 w-4 animate-spin mx-auto" aria-hidden="true" />
                                <p className="text-sm text-white/55 mt-2">Loading roster counts...</p>
                              </div>
                            ) : (
                              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                                {teams.map((team) => (
                                  <div key={team.id} className="flex items-center justify-between p-3 border rounded-lg">
                                    <div>
                                      <div className="font-medium">{team.team_name}</div>
                                      <div className="text-sm text-white/55">
                                        {rosterCounts[team.id] ?? 0} players
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </TabsContent>
                      </Tabs>

                      {/* League Invite Code Section */}
                      <div className="border-t pt-4 mt-4">
                        <div className="space-y-3">
                          <div>
                            <Label className="text-sm font-semibold flex items-center gap-2">
                              <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                              League Invite Code
                            </Label>
                          </div>
                          
                          {/* Join Code Display - Compact */}
                          <div className="flex items-center gap-2">
                            <div className="flex-1 px-3 py-2 bg-white/5 ring-1 ring-white/10 rounded-md">
                              <div className="text-lg font-mono font-semibold text-center">{league.join_code || 'N/A'}</div>
                            </div>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-9 w-9"
                              onClick={() => {
                                if (league.join_code) {
                                  navigator.clipboard.writeText(league.join_code);
                                  toast({
                                    title: 'Copied!',
                                    description: 'Join code copied',
                                  });
                                }
                              }}
                            >
                              <Copy className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </div>

                          {/* Invite Actions - Compact Row */}
                          <div className="flex gap-2">
                            <Button
                              variant="default"
                              size="sm"
                              className="flex-1"
                              onClick={() => {
                                if (league.join_code) {
                                  const inviteLink = `${window.location.origin}/create-league?tab=join&code=${league.join_code}`;
                                  const subject = encodeURIComponent(`Join my fantasy league: ${league.name}`);
                                  const body = encodeURIComponent(`Hi!

I'd like to invite you to join my fantasy hockey league on Citrus League Storm:

League: ${league.name}
Join Code: ${league.join_code}

You can join in two ways:
1. Click this link: ${inviteLink}
2. Or enter the join code manually: ${league.join_code}

League Details:
- Teams: ${teams.length}/${league.settings?.teamsCount || 12} teams
- Draft Rounds: ${league.draft_rounds}

Looking forward to competing with you!

Best,
Your Commissioner`);
                                  window.location.href = `mailto:?subject=${subject}&body=${body}`;
                                }
                              }}
                            >
                              <Mail className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                              Email
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1"
                              onClick={() => {
                                if (league.join_code) {
                                  const inviteLink = `${window.location.origin}/create-league?tab=join&code=${league.join_code}`;
                                  navigator.clipboard.writeText(inviteLink);
                                  toast({
                                    title: 'Link Copied!',
                                    description: 'Invite link copied',
                                  });
                                }
                              }}
                            >
                              <Copy className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                              Link
                            </Button>
                          </div>
                        </div>
                      </div>

                      <DialogFooter>
                        <Button variant="outline" onClick={() => setSettingsOpen(false)}>
                          Cancel
                        </Button>
                        {activeSettingsTab !== 'rosters' && !(activeSettingsTab === 'rosterslots' && league?.draft_status === 'completed') && (
                          <Button onClick={handleSaveSettings} disabled={savingSettings}>
                            {savingSettings ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                                Saving...
                              </>
                            ) : (
                              'Save Settings'
                            )}
                          </Button>
                        )}
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              )}
            </div>
          </div>

          {/* League Info Cards — three core league shape stats with custom hockey icons */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <Card className="bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] relative overflow-hidden">
              <div aria-hidden="true" className="absolute -top-8 -right-8 w-32 h-32 bg-pastel-orange/10 rounded-full blur-3xl pointer-events-none" />
              <CardHeader className="pb-2 relative z-10">
                <CardTitle className="text-[10px] font-jbmono uppercase tracking-[0.32em] text-pastel-orange-soft font-bold flex items-center gap-2">
                  <CrossedSticksIcon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                  Teams
                </CardTitle>
              </CardHeader>
              <CardContent className="relative z-10">
                <div className="font-calistoga text-4xl md:text-5xl text-pastel-cream tabular-nums leading-none">
                  {teams.length}
                  <span className="text-white/40 mx-1.5 text-2xl md:text-3xl">/</span>
                  <span className="text-pastel-orange">{league.settings?.teamsCount || 12}</span>
                </div>
                <p className="text-xs text-white/55 mt-2">Filled · max {league.settings?.teamsCount || 12}</p>
                {/* Mini fill bar — actual visualization of how many slots are filled */}
                <div className="mt-3 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-pastel-orange to-pastel-orange-soft transition-all"
                    style={{ width: `${Math.min(100, (teams.length / (league.settings?.teamsCount || 12)) * 100)}%` }}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] relative overflow-hidden">
              <div aria-hidden="true" className="absolute -top-8 -right-8 w-32 h-32 bg-pastel-sage/10 rounded-full blur-3xl pointer-events-none" />
              <CardHeader className="pb-2 relative z-10">
                <CardTitle className="text-[10px] font-jbmono uppercase tracking-[0.32em] text-pastel-orange-soft font-bold flex items-center gap-2">
                  <ScoreboardIcon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                  Roster Size
                </CardTitle>
              </CardHeader>
              <CardContent className="relative z-10">
                <div className="font-calistoga text-4xl md:text-5xl text-pastel-cream tabular-nums leading-none">{league.roster_size}</div>
                <p className="text-xs text-white/55 mt-2">Players per team</p>
              </CardContent>
            </Card>

            <Card className="bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] relative overflow-hidden">
              <div aria-hidden="true" className="absolute -top-8 -right-8 w-32 h-32 bg-pastel-orange/10 rounded-full blur-3xl pointer-events-none" />
              <CardHeader className="pb-2 relative z-10">
                <CardTitle className="text-[10px] font-jbmono uppercase tracking-[0.32em] text-pastel-orange-soft font-bold flex items-center gap-2">
                  <DraftIcon className="h-3.5 w-3.5" strokeWidth={2} />
                  Draft Rounds
                </CardTitle>
              </CardHeader>
              <CardContent className="relative z-10">
                <div className="font-calistoga text-4xl md:text-5xl text-pastel-cream tabular-nums leading-none">{league.draft_rounds}</div>
                <p className="text-xs text-white/55 mt-2">Total draft rounds</p>
              </CardContent>
            </Card>
          </div>

          {/* Actions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            {/* Draft Room - visible to ALL league members based on draft status */}
            {league.draft_status !== 'completed' && (
              <Card className={
                league.draft_status === 'in_progress'
                  ? 'bg-[#1A2A20] border-0 ring-1 ring-pastel-orange/40 rounded-2xl shadow-[0_16px_40px_-12px_rgba(255,168,87,0.2)]'
                  : 'bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]'
              }>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 font-calistoga text-pastel-cream">
                    {league.draft_status === 'in_progress' ? (
                      <><Play className="h-5 w-5 text-pastel-orange" aria-hidden="true" /> Draft In Progress</>
                    ) : league.scheduled_draft_time ? (
                      <><Clock className="h-5 w-5 text-pastel-orange" aria-hidden="true" /> Draft Scheduled</>
                    ) : (
                      <><DraftIcon className="h-5 w-5 text-pastel-orange" strokeWidth={2} /> Draft Room</>
                    )}
                  </CardTitle>
                  <CardDescription className="text-white/55">
                    {(() => {
                      if (league.draft_status === 'in_progress') {
                        return 'The draft is live! Join the draft room to make your picks.';
                      }
                      if (league.scheduled_draft_time) {
                        const scheduledDate = new Date(league.scheduled_draft_time);
                        const now = new Date();
                        if (scheduledDate > now) {
                          return `Draft scheduled for ${scheduledDate.toLocaleDateString()} at ${scheduledDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                        }
                      }
                      if (isCommissioner) {
                        const maxTeams = league.settings?.teamsCount || 12;
                        return teams.length >= maxTeams
                          ? 'All teams are ready. Set up and start the draft.'
                          : `Need ${maxTeams - teams.length} more team${maxTeams - teams.length === 1 ? '' : 's'} to start the draft.`;
                      }
                      return 'The commissioner will start the draft when all teams are ready. Join the lobby to wait.';
                    })()}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    onClick={() => {
                      if (!leagueId) {
                        toast({
                          title: 'Missing League ID',
                          description: "Something's off with the URL — refresh the page and we'll pick it back up.",
                          variant: 'destructive',
                        });
                        return;
                      }
                      navigate(`/draft-room?league=${leagueId}`);
                    }}
                    className={`w-full font-bold ${
                      league.draft_status === 'in_progress'
                        ? 'bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft shadow-[0_8px_24px_-8px_rgba(255,168,87,0.5)]'
                        : 'bg-transparent border border-pastel-cream/30 text-pastel-cream hover:bg-white/5 hover:border-pastel-cream/50'
                    } disabled:opacity-50`}
                    disabled={!leagueId}
                  >
                    <Play className="mr-2 h-4 w-4" aria-hidden="true" />
                    {league.draft_status === 'in_progress'
                      ? 'Join Draft Room'
                      : isCommissioner
                        ? 'Go to Draft Room'
                        : 'Enter Draft Lobby'}
                  </Button>
                  {!isCommissioner && league.draft_status === 'not_started' && (
                    <p className="text-xs text-white/55 mt-2 text-center">
                      You'll be able to participate once the commissioner starts the draft
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {userTeam && (
              <Card className="bg-[#1A2A20] border-0 ring-1 ring-pastel-sage/30 rounded-2xl shadow-[0_16px_40px_-12px_rgba(166,211,160,0.15)] relative overflow-hidden">
                <div aria-hidden="true" className="absolute -top-10 -right-10 w-36 h-36 bg-pastel-sage/15 rounded-full blur-3xl pointer-events-none" />
                <CardHeader className="relative z-10">
                  <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-sage-soft font-bold mb-1">
                    ✦ Your Squad
                  </div>
                  <CardTitle className="font-calistoga text-pastel-cream truncate">{userTeam.team_name}</CardTitle>
                  <CardDescription className="text-white/55">Manage your roster, set lineups, scout the wire.</CardDescription>
                </CardHeader>
                <CardContent className="relative z-10">
                  <div className="space-y-2">
                    <Button
                      asChild
                      className="w-full bg-pastel-sage/20 ring-1 ring-pastel-sage/40 text-pastel-sage-soft hover:bg-pastel-sage/30 font-bold"
                    >
                      <Link to="/roster">
                        <ScoreboardIcon className="mr-2 h-4 w-4" strokeWidth={2} aria-hidden="true" /> View Roster
                      </Link>
                    </Button>
                    <Button
                      asChild
                      className="w-full bg-transparent border border-pastel-cream/30 text-pastel-cream hover:bg-white/5 hover:border-pastel-cream/50 font-bold"
                    >
                      <Link to="/gm-office">
                        <CupIcon className="mr-2 h-4 w-4" strokeWidth={2} aria-hidden="true" /> GM Office
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* T12 architect Entry 13 (2026-08-09): league timeline —
              Sleeper-gap 2 ("the league that convenes"). Read-only
              feed assembled from data already recorded (draft
              completion + transaction_ledger + matchup results). Pure
              function in @citrus/shared; card handles fetch + render. */}
          {leagueId && (
            <div className="mb-6">
              <LeagueTimelineCard
                leagueId={leagueId}
                draftStatus={league?.draft_status ?? null}
                draftCompletedAt={league?.updated_at ?? null}
                topPick={null}
              />
            </div>
          )}

          {/* Teams List */}
          <Card className="bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
            <CardHeader>
              <CardTitle className="font-calistoga text-pastel-cream flex items-center gap-2">
                <CrossedSticksIcon className="h-5 w-5 text-pastel-orange" strokeWidth={2} aria-hidden="true" />
                Teams
              </CardTitle>
              <CardDescription className="text-white/55">All teams in this league</CardDescription>
            </CardHeader>
            <CardContent>
              {teams.length === 0 ? (
                <div className="text-center py-10">
                  <PuckIcon className="w-10 h-10 mx-auto mb-3 text-pastel-orange/40" strokeWidth={2} aria-hidden="true" />
                  <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-2">
                    ✦ Empty rink
                  </div>
                  <p className="text-pastel-cream font-bold text-base">This league is still filling up.</p>
                  <p className="text-sm text-white/55 mt-2 max-w-xs mx-auto">Grab the join code from the Settings tab and send it to your league mates.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {teams.map((team) => {
                    const isMine = team.owner_id === user?.id;
                    return (
                      <div
                        key={team.id}
                        className={`flex items-center justify-between p-3 rounded-xl ring-1 ${
                          isMine
                            ? 'bg-pastel-sage/10 ring-pastel-sage/40'
                            : 'bg-white/5 ring-white/10 hover:bg-white/[0.07] transition-colors'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 font-jbmono uppercase tracking-[0.18em] ${
                            isMine
                              ? 'bg-pastel-sage/20 ring-1 ring-pastel-sage/40 text-pastel-sage-soft'
                              : 'bg-pastel-orange/15 ring-1 ring-pastel-orange/30 text-pastel-orange-soft'
                          }`}>
                            {(team.team_name || '?').slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-pastel-cream truncate">{team.team_name}</div>
                            {team.owner_id ? (
                              <div className="text-xs text-white/55">Owner: {isMine ? 'You' : 'User'}</div>
                            ) : (
                              <div className="text-xs text-white/55 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-300/60 inline-block" /> AI Team
                              </div>
                            )}
                          </div>
                        </div>
                        {isMine && (
                          <Badge className="bg-pastel-sage/20 ring-1 ring-pastel-sage/40 text-pastel-sage-soft border-0 text-[10px] font-jbmono uppercase tracking-[0.18em] font-bold">
                            Your Team
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
            </div>

            {/* Left Sidebar - At bottom on mobile, left on desktop */}
            <aside className="w-full lg:w-auto order-2 lg:order-1">
              <div className="lg:sticky lg:top-24 space-y-4 lg:space-y-4">
                <div className="bg-[#1A2A20] ring-1 ring-pastel-orange/30 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] overflow-hidden">
                  <MascotPortrait id="stormy" />
                  <div className="p-5">
                    <div className="font-jbmono text-[9px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-1">
                      ✦ Stormy says
                    </div>
                    <div className="font-calistoga text-xl text-pastel-cream mb-2">League pulse</div>
                    <p className="text-xs text-white/70 leading-relaxed">
                      <span className="font-bold text-pastel-cream tabular-nums">{teams.length}</span> of <span className="font-bold text-pastel-cream tabular-nums">{league.settings?.teamsCount || 12}</span> teams in.
                      {' '}
                      {league.draft_status === 'not_started' && 'Draft is on deck.'}
                      {league.draft_status === 'in_progress' && 'Draft is live — get in there.'}
                      {league.draft_status === 'completed' && 'Rosters set. Time to play.'}
                    </p>
                  </div>
                </div>
                <div className="bg-[#1A2A20] ring-1 ring-white/10 rounded-2xl p-4 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                  <div className="flex items-center gap-2 mb-2">
                    <RangeIcon className="w-4 h-4 text-pastel-orange" strokeWidth={2} aria-hidden="true" />
                    <div className="font-jbmono text-[9px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold">League quicklinks</div>
                  </div>
                  <div className="space-y-1.5">
                    <Link to="/standings" className="block text-xs text-white/70 hover:text-pastel-orange transition-colors flex items-center gap-2"><span className="text-pastel-orange/60">▸</span> Standings</Link>
                    <Link to="/matchup" className="block text-xs text-white/70 hover:text-pastel-orange transition-colors flex items-center gap-2"><span className="text-pastel-orange/60">▸</span> This week's matchup</Link>
                    <Link to="/team-analytics" className="block text-xs text-white/70 hover:text-pastel-orange transition-colors flex items-center gap-2"><span className="text-pastel-orange/60">▸</span> Team analytics</Link>
                  </div>
                </div>
              </div>
            </aside>

            {/* Right Sidebar - Notifications (hidden on mobile) */}
            {leagueId && (
              <aside className="hidden lg:block order-3">
                <div className="lg:sticky lg:top-24 h-[calc(100vh-7rem)] bg-[#1A2A20] ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] overflow-hidden">
                  <LeagueNotifications leagueId={leagueId} />
                </div>
              </aside>
            )}
          </div>
        </div>
      </main>
      <HockeyFooter />
    </div>
  );
};

export default LeagueDashboard;

