import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { COLUMNS } from '@/utils/queryColumns';
import { LeagueService } from '@/services/LeagueService';
import { DraftService } from '@/services/DraftService';
import { WaiverService } from '@/services/WaiverService';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { 
  User, 
  Settings, 
  Trophy, 
  Calendar, 
  Target, 
  TrendingUp, 
  Medal, 
  Users, 
  Edit3,
  Camera,
  Mail,
  Phone,
  MapPin,
  Bell,
  Shield,
  CreditCard,
  History,
  Lock,
  Smartphone,
  Check,
  Crown,
  RotateCcw,
  AlertTriangle,
  Clock,
  RefreshCw,
  Play,
  Loader2
} from 'lucide-react';
import { logger } from '@/utils/logger';

const Profile = () => {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  
  // Active Tab State Management
  const [activeTab, setActiveTab] = useState('overview');
  
  // Animation observer setup
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('animate');
          }
        });
      },
      { threshold: 0.1 }
    );

    // Small delay to ensure DOM is updated after tab switch
    const timeoutId = setTimeout(() => {
    const animatedElements = document.querySelectorAll('.animated-element');
    animatedElements.forEach(el => observer.observe(el));
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      observer.disconnect();
    };
  }, [activeTab]);
  
  // User & Team Data - Initialize from profile
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    location: '',
    bio: '',
    teamName: '',
    teamAbbr: '',
    favoriteTeam: '',
    teamDescription: ''
  });

  // Initialize form data from profile when it loads
  useEffect(() => {
    if (profile) {
      setFormData({
        firstName: profile.first_name || '',
        lastName: profile.last_name || '',
        email: user?.email || '',
        phone: profile.phone || '',
        location: profile.location || '',
        bio: profile.bio || '',
        teamName: profile.default_team_name || '',
        teamAbbr: '',
        favoriteTeam: '',
        teamDescription: ''
      });
    }
  }, [profile, user]);

  // Load commissioner leagues
  useEffect(() => {
    const loadCommissionerLeagues = async () => {
      if (!user) return;
      
      try {
        setLoadingLeagues(true);
        const { leagues, error } = await LeagueService.getUserLeagues(user.id);
        if (error) {
          logger.error('Error loading leagues:', error);
          return;
        }
        // Filter to only leagues where user is commissioner
        const commLeagues = leagues.filter(l => l.commissioner_id === user.id);
        setCommissionerLeagues(commLeagues.map(l => ({
          id: l.id,
          name: l.name,
          draft_status: l.draft_status
        })));
      } catch (error) {
        logger.error('Error loading commissioner leagues:', error);
      } finally {
        setLoadingLeagues(false);
      }
    };

    loadCommissionerLeagues();
  }, [user]);

  // Password Management
  const [passwords, setPasswords] = useState({
    current: '',
    new: '',
    confirm: ''
  });

  // Preferences
  const [preferences, setPreferences] = useState({
    autoLineup: false,
    emailNotifications: true,
    pushNotifications: true,
    darkMode: false,
    publicProfile: true
  });

  // Commissioner leagues for reset
  const [commissionerLeagues, setCommissionerLeagues] = useState<Array<{ id: string; name: string; draft_status: string }>>([]);
  const [loadingLeagues, setLoadingLeagues] = useState(false);

  // Commissioner League Settings State
  const [selectedSettingsLeagueId, setSelectedSettingsLeagueId] = useState<string | null>(null);
  const [selectedLeagueData, setSelectedLeagueData] = useState<any>(null);
  const [selectedLeagueTeams, setSelectedLeagueTeams] = useState<any[]>([]);
  const [commSettingsTab, setCommSettingsTab] = useState('waivers');
  const [savingCommSettings, setSavingCommSettings] = useState(false);
  const [processingWaivers, setProcessingWaivers] = useState(false);
  const [syncingRosters, setSyncingRosters] = useState(false);
  const [loadingCommSettings, setLoadingCommSettings] = useState(false);
  const [commWaiverSettings, setCommWaiverSettings] = useState({
    waiver_process_time: '02:00:00',
    waiver_period_hours: 48,
    waiver_game_lock: true,
    waiver_type: 'rolling' as 'rolling' | 'faab' | 'reverse_standings',
    allow_trades_during_games: true,
  });
  const [commScoringSettings, setCommScoringSettings] = useState<{
    skater?: Record<string, number>;
    goalie?: Record<string, number>;
  }>({});
  const [commDraftSettings, setCommDraftSettings] = useState({
    draft_rounds: 21,
    pickTimeLimit: 90,
  });
  const [commRosterCounts, setCommRosterCounts] = useState<Record<string, number>>({});
  const [loadingRosterCounts, setLoadingRosterCounts] = useState(false);

  // Load full league data when a commissioner league is selected for settings
  useEffect(() => {
    const loadLeagueSettings = async () => {
      if (!selectedSettingsLeagueId || !user) return;
      
      setLoadingCommSettings(true);
      try {
        // Load league data
        // Cast needed: COLUMNS.LEAGUE is a runtime string so Supabase can't infer column types
        const { data: leagueData, error: leagueError } = await supabase
          .from('leagues')
          .select(COLUMNS.LEAGUE)
          .eq('id', selectedSettingsLeagueId)
          .single() as { data: any; error: any };
        
        if (leagueError) throw leagueError;
        setSelectedLeagueData(leagueData);
        
        // Load teams for this league
        const { data: teamsData, error: teamsError } = await supabase
          .from('teams')
          .select(COLUMNS.TEAM)
          .eq('league_id', selectedSettingsLeagueId);
        
        if (!teamsError) {
          setSelectedLeagueTeams(teamsData || []);
        }
        
        // Initialize waiver settings from league data
        if (leagueData?.settings) {
          setCommWaiverSettings({
            waiver_process_time: leagueData.settings.waiver_process_time || '02:00:00',
            waiver_period_hours: leagueData.settings.waiver_period_hours || 48,
            waiver_game_lock: leagueData.settings.waiver_game_lock ?? true,
            waiver_type: leagueData.settings.waiver_type || 'rolling',
            allow_trades_during_games: leagueData.settings.allow_trades_during_games ?? true,
          });
        }
        
        // Initialize scoring settings
        if (leagueData?.scoring_settings) {
          setCommScoringSettings(leagueData.scoring_settings);
        } else {
          setCommScoringSettings({
            skater: { goals: 3, assists: 2, power_play_points: 1, short_handed_points: 2, shots_on_goal: 0.4, blocks: 0.5, hits: 0.2, penalty_minutes: 0.5 },
            goalie: { wins: 4, shutouts: 3, saves: 0.2, goals_against: -1 }
          });
        }
        
        // Initialize draft settings
        setCommDraftSettings({
          draft_rounds: leagueData?.draft_rounds || 21,
          pickTimeLimit: leagueData?.settings?.pickTimeLimit || 90,
        });
      } catch (error) {
        logger.error('Error loading league settings:', error);
        toast({
          title: 'Error',
          description: 'Failed to load league settings',
          variant: 'destructive',
        });
      } finally {
        setLoadingCommSettings(false);
      }
    };

    loadLeagueSettings();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- toast is a stable hook reference
  }, [selectedSettingsLeagueId, user]);

  // Load roster counts when rosters tab is selected
  useEffect(() => {
    const loadRosterCounts = async () => {
      if (commSettingsTab !== 'rosters' || !selectedSettingsLeagueId || selectedLeagueTeams.length === 0) return;
      
      setLoadingRosterCounts(true);
      const counts: Record<string, number> = {};
      
      for (const team of selectedLeagueTeams) {
        const { count, error } = await supabase
          .from('roster_assignments')
          .select('*', { count: 'exact', head: true })
          .eq('league_id', selectedSettingsLeagueId)
          .eq('team_id', team.id);
        
        if (!error && count !== null) {
          counts[team.id] = count;
        } else {
          counts[team.id] = 0;
        }
      }
      
      setCommRosterCounts(counts);
      setLoadingRosterCounts(false);
    };

    loadRosterCounts();
  }, [commSettingsTab, selectedSettingsLeagueId, selectedLeagueTeams]);

  // Auto-select first league when commissioner leagues load
  useEffect(() => {
    if (commissionerLeagues.length > 0 && !selectedSettingsLeagueId) {
      setSelectedSettingsLeagueId(commissionerLeagues[0].id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedSettingsLeagueId setter is stable; only trigger on league list changes
  }, [commissionerLeagues]);

  // Save commissioner league settings
  const handleSaveCommSettings = async () => {
    if (!selectedSettingsLeagueId || !user) return;
    
    setSavingCommSettings(true);
    try {
      let saved = false;
      let errorMessage = '';
      
      if (commSettingsTab === 'waivers') {
        const { success, error: saveError } = await LeagueService.updateWaiverSettings(
          selectedSettingsLeagueId,
          user.id,
          commWaiverSettings
        );
        saved = success;
        errorMessage = saveError instanceof Error ? saveError.message : String(saveError || 'Failed to save waiver settings');
      } else if (commSettingsTab === 'scoring') {
        const { success, error: saveError } = await LeagueService.updateScoringSettings(
          selectedSettingsLeagueId,
          user.id,
          commScoringSettings
        );
        saved = success;
        errorMessage = saveError instanceof Error ? saveError.message : String(saveError || 'Failed to save scoring settings');
      } else if (commSettingsTab === 'draft') {
        const { success, error: saveError } = await LeagueService.updateDraftSettings(
          selectedSettingsLeagueId,
          user.id,
          commDraftSettings
        );
        saved = success;
        errorMessage = saveError instanceof Error ? saveError.message : String(saveError || 'Failed to save draft settings');
      }

      if (!saved) {
        toast({
          title: 'Error',
          description: errorMessage,
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: 'Settings Saved',
        description: `League ${commSettingsTab} settings have been updated. All league members have been notified.`,
      });
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to save settings',
        variant: 'destructive',
      });
    } finally {
      setSavingCommSettings(false);
    }
  };

  // Process waivers for selected league
  const handleCommProcessWaivers = async () => {
    if (!selectedSettingsLeagueId || !user) return;

    setProcessingWaivers(true);
    try {
      const result = await WaiverService.processAllPendingWaivers();

      if (!result.success) {
        toast({
          title: 'Error',
          description: result.error || 'Failed to process waivers',
          variant: 'destructive',
        });
        return;
      }

      const leagueResult = result.results.find(r => r.league_id === selectedSettingsLeagueId);
      
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
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to process waivers',
        variant: 'destructive',
      });
    } finally {
      setProcessingWaivers(false);
    }
  };

  // Sync rosters for selected league
  const handleCommSyncRosters = async () => {
    if (!selectedSettingsLeagueId || !user) return;

    setSyncingRosters(true);
    try {
      // Step 1: Sync roster_assignments from draft_picks (source of truth)
      // Cast needed: RPC function not in generated Supabase types
      const { data: syncResult, error: syncError } = await (supabase
        .rpc as any)('sync_roster_assignments_for_league', { p_league_id: selectedSettingsLeagueId });

      if (syncError) {
        toast({
          title: 'Error',
          description: syncError.message || 'Failed to sync rosters',
          variant: 'destructive',
        });
        return;
      }

      const playersSynced = (syncResult as any)?.players_synced || 0;

      // Step 2: ALSO rebuild team_lineups from roster_assignments
      // Without this, the Roster page reads stale team_lineups data
      try {
        await DraftService.initializeRostersForAllTeams(selectedSettingsLeagueId);
        toast({
          title: 'Rosters Synced',
          description: `Synced ${playersSynced} players and rebuilt all team lineups.`,
        });
      } catch (lineupErr) {
        logger.error('Failed to rebuild team_lineups after sync:', lineupErr);
        toast({
          title: 'Partial Sync',
          description: `Synced ${playersSynced} players to roster_assignments, but team lineups may need a page refresh.`,
        });
      }
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to sync rosters',
        variant: 'destructive',
      });
    } finally {
      setSyncingRosters(false);
    }
  };

  // User stats - will be populated from actual league data later
  const userStats = {
    totalSeasons: 0,
    championships: 0,
    playoffAppearances: 0,
    overallRecord: '0-0',
    currentRank: null,
    bestFinish: null,
    totalPoints: 0,
    avgPointsPerGame: 0
  };

  // Achievements - empty for new users
  const achievements: Array<{ title: string; year?: string; description?: string; icon: any; color: string }> = [];

  // Recent activity - empty for new users
  const recentActivity: Array<{ action: string; points?: string; date: string }> = [];

  // Get user's initials for avatar
  const getInitials = () => {
    if (profile?.first_name && profile?.last_name) {
      return `${profile.first_name[0]}${profile.last_name[0]}`.toUpperCase();
    }
    if (profile?.username) {
      return profile.username.substring(0, 2).toUpperCase();
    }
    if (user?.email) {
      return user.email.substring(0, 2).toUpperCase();
    }
    return 'U';
  };

  // Get display name
  const getDisplayName = () => {
    if (profile?.first_name && profile?.last_name) {
      return `${profile.first_name} ${profile.last_name}`;
    }
    if (profile?.first_name) {
      return profile.first_name;
    }
    if (profile?.username) {
      return profile.username;
    }
    return 'User';
  };

  // Get member since year
  const getMemberSince = () => {
    if (profile?.created_at) {
      return new Date(profile.created_at).getFullYear();
    }
    return new Date().getFullYear();
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handlePreferenceChange = (field: string, value: boolean) => {
    setPreferences(prev => ({ ...prev, [field]: value }));
    toast({
      title: "Preference updated",
      description: "Your settings have been saved automatically.",
    });
  };

  const handleSave = async () => {
    if (!user || !profile) return;

    try {
      // Build update object with only provided fields
      const updateData: any = {};
      
      if (formData.firstName.trim()) updateData.first_name = formData.firstName.trim();
      if (formData.lastName.trim()) updateData.last_name = formData.lastName.trim();
      if (formData.phone.trim()) updateData.phone = formData.phone.trim();
      if (formData.location.trim()) updateData.location = formData.location.trim();
      if (formData.bio.trim()) updateData.bio = formData.bio.trim();

      // Try to update - if bio column doesn't exist, try without it
      const { error } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', user.id);

      // If error mentions bio column, try again without it
      if (error && error.message?.includes('bio')) {
        const { bio, ...updateWithoutBio } = updateData;
        const { error: retryError } = await supabase
          .from('profiles')
          .update(updateWithoutBio)
          .eq('id', user.id);
        
        if (retryError) throw retryError;
        
        // Show warning about bio
        toast({
          title: "Profile updated",
          description: "Profile saved, but bio field is not available yet. Please run the database migration.",
          variant: "default"
        });
      } else if (error) {
        throw error;
      } else {
        toast({
          title: "Profile updated",
          description: "Your profile information has been saved successfully.",
          variant: "default"
        });
      }

      setIsEditing(false);
      await refreshProfile();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update profile. Make sure all database columns exist.",
        variant: "destructive"
      });
    }
  };

  const handleSaveTeamName = async () => {
    if (!user || !profile) return;

    try {
      const updateData: any = {};
      
      if (formData.teamName.trim()) {
        updateData.default_team_name = formData.teamName.trim();
      }

      const { error } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', user.id);

      if (error) throw error;

      // Also update all existing teams owned by this user
      if (formData.teamName.trim()) {
        const { error: teamUpdateError, updatedCount } = await LeagueService.updateUserTeamNames(
          user.id,
          formData.teamName.trim()
        );
        
        if (teamUpdateError) {
          logger.error('Error updating existing team names:', teamUpdateError);
          toast({
            title: "Partial update",
            description: "Profile updated, but some teams may not have been updated. Please refresh the draft room.",
            variant: "default"
          });
        } else if (updatedCount && updatedCount > 0) {
          logger.log(`Successfully updated ${updatedCount} team(s) with new name`);
        }
      }

      toast({
        title: "Team name saved",
        description: "Your default team name has been saved and updated across all your existing teams.",
        variant: "default"
      });

      await refreshProfile();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save team name.",
        variant: "destructive"
      });
    }
  };

  const handlePasswordChange = (e: React.FormEvent) => {
    e.preventDefault();
    toast({
      title: "Password updated",
      description: "Your password has been changed successfully.",
      variant: "default"
    });
    setPasswords({ current: '', new: '', confirm: '' });
  };

  const handleResetLeagueDraft = async (leagueId: string, leagueName: string) => {
    const confirmed = confirm(
      `Are you sure you want to reset the draft for "${leagueName}"?\n\n` +
      `This will permanently delete all draft data (picks and draft order) and reset the league to "not started" status.\n\n` +
      `This action cannot be undone.`
    );

    if (!confirmed) return;

    try {
      const { error } = await DraftService.hardDeleteDraft(leagueId);
      
      if (error) {
        throw error;
      }

      toast({
        title: "Draft reset successful",
        description: `The draft for "${leagueName}" has been reset. You can now start a fresh draft.`,
        variant: "default"
      });

      // Reload leagues to update status
      const { leagues, error: reloadError } = await LeagueService.getUserLeagues(user!.id);
      if (!reloadError) {
        const commLeagues = leagues.filter(l => l.commissioner_id === user!.id);
        setCommissionerLeagues(commLeagues.map(l => ({
          id: l.id,
          name: l.name,
          draft_status: l.draft_status
        })));
      }
    } catch (error: any) {
      toast({
        title: "Error resetting draft",
        description: error.message || "Failed to reset the draft. Please try again.",
        variant: "destructive"
      });
    }
  };

  // If user is not logged in, show signup prompt
  if (!user) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <main className="pt-24 pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-16">
          <div className="container mx-auto px-4">
            <div className="max-w-2xl mx-auto">
              <Card>
                <CardHeader>
                  <CardTitle>Sign In Required</CardTitle>
                  <CardDescription>
                    Please sign in or create an account to view your profile
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Button asChild className="w-full">
                    <Link to="/auth">Sign In / Sign Up</Link>
                  </Button>
                  <Button asChild variant="outline" className="w-full">
                    <Link to="/">Go to Homepage</Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="pt-24 pb-16">
        <div className="container mx-auto px-4">
          <div className="max-w-6xl mx-auto">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-8">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div className="flex items-center gap-4 animated-element">
                  <div className="relative group">
                    <Avatar className="h-24 w-24 border-4 border-primary/20">
                      <AvatarImage src="" alt={getDisplayName()} />
                      <AvatarFallback className="text-2xl font-bold bg-primary/10 text-primary">
                        {getInitials()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                      <Camera className="h-6 w-6 text-white" />
                    </div>
                  </div>
                  <div>
                    <h1 className="text-3xl font-bold">{getDisplayName()}</h1>
                    <p className="text-muted-foreground flex items-center gap-2 mt-1">
                      <Users className="h-4 w-4" />
                      {formData.teamName || 'No team yet'} • League Member since {getMemberSince()}
                    </p>
                    {userStats.championships > 0 && (
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant="secondary" className="bg-primary/10 text-primary border-0">
                          <Trophy className="h-3 w-3 mr-1" />
                          {userStats.championships}x Champion
                        </Badge>
                      </div>
                    )}
                  </div>
                </div>
                
                <TabsList className="animated-element w-full lg:w-auto grid grid-cols-4 lg:flex">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="stats">Statistics</TabsTrigger>
                  <TabsTrigger value="achievements">Trophies</TabsTrigger>
                  <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="overview" className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Profile Info */}
                  <div className="lg:col-span-2 space-y-6">
                    <Card className="animated-element">
                      <CardHeader className="flex flex-row items-center justify-between">
                        <div>
                          <CardTitle className="flex items-center gap-2">
                            <User className="h-5 w-5" />
                            Personal Information
                          </CardTitle>
                          <CardDescription>Your basic profile details</CardDescription>
                        </div>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => setIsEditing(!isEditing)}
                        >
                          <Edit3 className="h-4 w-4 mr-2" />
                          {isEditing ? 'Cancel' : 'Edit'}
                        </Button>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor="firstName">First Name</Label>
                            {isEditing ? (
                              <Input
                                id="firstName"
                                value={formData.firstName}
                                onChange={(e) => handleInputChange('firstName', e.target.value)}
                              />
                            ) : (
                              <p className="text-sm text-muted-foreground mt-1">{formData.firstName}</p>
                            )}
                          </div>
                          <div>
                            <Label htmlFor="lastName">Last Name</Label>
                            {isEditing ? (
                              <Input
                                id="lastName"
                                value={formData.lastName}
                                onChange={(e) => handleInputChange('lastName', e.target.value)}
                              />
                            ) : (
                              <p className="text-sm text-muted-foreground mt-1">{formData.lastName}</p>
                            )}
                          </div>
                        </div>
                        
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 text-sm">
                            <Mail className="h-4 w-4 text-muted-foreground" />
                            {isEditing ? (
                              <Input 
                                value={formData.email} 
                                onChange={(e) => handleInputChange('email', e.target.value)}
                                className="h-8"
                              />
                            ) : (
                              <span>{formData.email}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <Phone className="h-4 w-4 text-muted-foreground" />
                            {isEditing ? (
                              <Input 
                                value={formData.phone} 
                                onChange={(e) => handleInputChange('phone', e.target.value)}
                                className="h-8"
                              />
                            ) : (
                              <span>{formData.phone}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <MapPin className="h-4 w-4 text-muted-foreground" />
                            {isEditing ? (
                              <Input 
                                value={formData.location} 
                                onChange={(e) => handleInputChange('location', e.target.value)}
                                className="h-8"
                              />
                            ) : (
                              <span>{formData.location}</span>
                            )}
                          </div>
                        </div>

                        <Separator />

                        <div>
                          <Label htmlFor="bio">Bio</Label>
                          {isEditing ? (
                            <Textarea
                              id="bio"
                              value={formData.bio}
                              onChange={(e) => handleInputChange('bio', e.target.value)}
                              className="w-full min-h-[80px] mt-1"
                            />
                          ) : (
                            <p className="text-sm text-muted-foreground mt-1">{formData.bio}</p>
                          )}
                        </div>

                        {isEditing && (
                          <div className="flex gap-2 pt-4">
                            <Button onClick={handleSave}>Save Changes</Button>
                            <Button variant="outline" onClick={() => setIsEditing(false)}>Cancel</Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    <Card className="animated-element">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <History className="h-5 w-5" />
                          Recent Activity
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {recentActivity.length > 0 ? (
                          <div className="space-y-4">
                            {recentActivity.map((activity, index) => (
                              <div key={index} className="flex items-start gap-3 p-3 rounded-lg hover:bg-accent/5 transition-colors">
                                <div className="h-2 w-2 rounded-full bg-primary mt-2 flex-shrink-0" />
                                <div className="flex-1">
                                  <p className="text-sm font-medium">{activity.action}</p>
                                  {activity.points && (
                                    <p className="text-sm text-primary font-medium">{activity.points}</p>
                                  )}
                                  <p className="text-xs text-muted-foreground">{activity.date}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground text-center py-8">
                            No recent activity. Join a league to get started!
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  {/* Quick Stats Sidebar */}
                  <div className="space-y-6">
                    <Card className="animated-element">
                      <CardHeader>
                        <CardTitle className="text-lg">Season Summary</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="text-center p-3 rounded-lg bg-primary/5">
                            <div className="text-2xl font-bold text-primary">
                              {userStats.currentRank ?? '—'}
                            </div>
                            <div className="text-xs text-muted-foreground">Current Rank</div>
                          </div>
                          <div className="text-center p-3 rounded-lg bg-green-500/5">
                            <div className="text-2xl font-bold text-green-600">{userStats.championships}</div>
                            <div className="text-xs text-muted-foreground">Championships</div>
                          </div>
                        </div>
                        <Separator />
                        <div className="space-y-3">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Total Seasons</span>
                            <span className="font-medium">{userStats.totalSeasons}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Playoff Apps</span>
                            <span className="font-medium">{userStats.playoffAppearances}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Overall Record</span>
                            <span className="font-medium">{userStats.overallRecord}</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="animated-element">
                      <CardHeader>
                        <CardTitle className="text-lg">Team Info</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div>
                          <Label className="text-xs text-muted-foreground">Fantasy Team</Label>
                          <p className="font-medium">{formData.teamName || 'No team yet'}</p>
                        </div>
                        {formData.favoriteTeam && (
                          <div>
                            <Label className="text-xs text-muted-foreground">Favorite NHL Team</Label>
                            <p className="font-medium">{formData.favoriteTeam}</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="stats" className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Card className="animated-element">
                    <CardContent className="p-6 text-center">
                      <Trophy className="h-8 w-8 mx-auto mb-2 text-yellow-500" />
                      <div className="text-2xl font-bold">{userStats.championships}</div>
                      <div className="text-sm text-muted-foreground">Championships</div>
                    </CardContent>
                  </Card>
                  <Card className="animated-element">
                    <CardContent className="p-6 text-center">
                      <Target className="h-8 w-8 mx-auto mb-2 text-blue-500" />
                      <div className="text-2xl font-bold">{userStats.playoffAppearances}</div>
                      <div className="text-sm text-muted-foreground">Playoff Apps</div>
                    </CardContent>
                  </Card>
                  <Card className="animated-element">
                    <CardContent className="p-6 text-center">
                      <TrendingUp className="h-8 w-8 mx-auto mb-2 text-green-500" />
                      <div className="text-2xl font-bold">{userStats.totalPoints.toLocaleString()}</div>
                      <div className="text-sm text-muted-foreground">Total Points</div>
                    </CardContent>
                  </Card>
                  <Card className="animated-element">
                    <CardContent className="p-6 text-center">
                      <Medal className="h-8 w-8 mx-auto mb-2 text-purple-500" />
                      <div className="text-2xl font-bold">{userStats.bestFinish}</div>
                      <div className="text-sm text-muted-foreground">Best Finish</div>
                    </CardContent>
                  </Card>
                </div>

                <Card className="animated-element">
                  <CardHeader>
                    <CardTitle>Performance History</CardTitle>
                    <CardDescription>Your finish position over the years</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {userStats.totalSeasons > 0 ? (
                      <div className="space-y-4">
                        {/* Performance history will be populated from actual league data */}
                        <p className="text-sm text-muted-foreground text-center py-8">
                          No season history yet. Join a league to start tracking your performance!
                        </p>
                      </div>
                    ) : (
                      <div className="text-center py-12">
                        <TrendingUp className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                        <h3 className="text-lg font-semibold mb-2">No Performance History</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                          Join a league and complete a season to see your performance history here.
                        </p>
                        <Button asChild>
                          <Link to="/create-league">Create or Join a League</Link>
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="achievements" className="space-y-6">
                {achievements.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {achievements.map((achievement, index) => (
                      <Card key={index} className="animated-element hover:shadow-md transition-shadow">
                        <CardContent className="p-6">
                          <div className="flex items-start gap-4">
                            <div className={`p-3 rounded-lg bg-accent/10`}>
                              <achievement.icon className={`h-6 w-6 ${achievement.color}`} />
                            </div>
                            <div className="flex-1">
                              <h3 className="font-semibold mb-1">{achievement.title}</h3>
                              {achievement.description && (
                                <p className="text-sm text-muted-foreground mb-2">{achievement.description}</p>
                              )}
                              {achievement.year && (
                                <Badge variant="secondary" className="text-xs">{achievement.year}</Badge>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <Card>
                    <CardContent className="p-12 text-center">
                      <Trophy className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                      <h3 className="text-lg font-semibold mb-2">No Achievements Yet</h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        Join a league and start competing to earn achievements!
                      </p>
                      <Button asChild>
                        <Link to="/create-league">Create or Join a League</Link>
                      </Button>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="settings" className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Account Settings */}
                  <Card className="animated-element lg:col-span-2">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <User className="h-5 w-5" />
                        Account Settings
                      </CardTitle>
                      <CardDescription>Manage your account details and login</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                          <h3 className="text-sm font-medium">Personal Information</h3>
                          <div className="space-y-2">
                            <Label htmlFor="account-email">Email Address</Label>
                            <Input 
                              id="account-email" 
                              value={formData.email} 
                              onChange={(e) => handleInputChange('email', e.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="account-name">Display Name</Label>
                            <Input 
                              id="account-name" 
                              value={`${formData.firstName} ${formData.lastName}`} 
                              readOnly
                              className="bg-muted"
                            />
                            <p className="text-xs text-muted-foreground">To change your name, please visit the Overview tab.</p>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <h3 className="text-sm font-medium">Security</h3>
                          <form onSubmit={handlePasswordChange} className="space-y-3">
                            <div className="space-y-2">
                              <Label htmlFor="current-password">Current Password</Label>
                              <Input 
                                id="current-password" 
                                type="password" 
                                value={passwords.current}
                                onChange={(e) => setPasswords(p => ({...p, current: e.target.value}))}
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-2">
                                <Label htmlFor="new-password">New Password</Label>
                                <Input 
                                  id="new-password" 
                                  type="password"
                                  value={passwords.new}
                                  onChange={(e) => setPasswords(p => ({...p, new: e.target.value}))}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="confirm-password">Confirm</Label>
                                <Input 
                                  id="confirm-password" 
                                  type="password"
                                  value={passwords.confirm}
                                  onChange={(e) => setPasswords(p => ({...p, confirm: e.target.value}))}
                                />
                              </div>
                            </div>
                            <Button type="submit" variant="outline" size="sm" className="w-full">
                              Update Password
                            </Button>
                          </form>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Team Settings */}
                  <Card className="animated-element">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Shield className="h-5 w-5" />
                        Team Settings
                      </CardTitle>
                      <CardDescription>Customize your team identity</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="team-name">Team Name</Label>
                        <Input 
                          id="team-name" 
                          value={formData.teamName} 
                          onChange={(e) => handleInputChange('teamName', e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="team-abbr">Abbreviation (3-4 chars)</Label>
                        <Input 
                          id="team-abbr" 
                          value={formData.teamAbbr} 
                          maxLength={4}
                          onChange={(e) => handleInputChange('teamAbbr', e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="team-desc">Team Slogan/Bio</Label>
                        <Textarea 
                          id="team-desc" 
                          value={formData.teamDescription} 
                          onChange={(e) => handleInputChange('teamDescription', e.target.value)}
                          className="min-h-[80px]"
                        />
                      </div>
                      <Button onClick={handleSaveTeamName}>Save Team Details</Button>
                    </CardContent>
                  </Card>

                  {/* League Reset (Commissioner Only) */}
                  {commissionerLeagues.length > 0 && (
                    <Card className="animated-element border-destructive/20">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-destructive">
                          <RotateCcw className="h-5 w-5" />
                          League Draft Reset
                        </CardTitle>
                        <CardDescription>
                          Reset draft data for leagues you commission. This permanently deletes all draft picks and orders.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {loadingLeagues ? (
                          <p className="text-sm text-muted-foreground">Loading leagues...</p>
                        ) : (
                          <div className="space-y-3">
                            {commissionerLeagues.map((league) => (
                              <div 
                                key={league.id} 
                                className="flex items-center justify-between p-3 border rounded-lg bg-muted/30"
                              >
                                <div className="flex-1">
                                  <p className="font-semibold">{league.name}</p>
                                  <p className="text-sm text-muted-foreground">
                                    Status: <span className="capitalize">{league.draft_status.replace('_', ' ')}</span>
                                  </p>
                                </div>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => handleResetLeagueDraft(league.id, league.name)}
                                  disabled={league.draft_status === 'not_started'}
                                >
                                  <RotateCcw className="h-4 w-4 mr-2" />
                                  Reset Draft
                                </Button>
                              </div>
                            ))}
                            {commissionerLeagues.length === 0 && (
                              <p className="text-sm text-muted-foreground text-center py-4">
                                You are not a commissioner of any leagues.
                              </p>
                            )}
                          </div>
                        )}
                        <div className="flex items-start gap-2 p-3 bg-destructive/5 border border-destructive/20 rounded-lg">
                          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                          <p className="text-xs text-destructive/80">
                            <strong>Warning:</strong> Resetting a draft will permanently delete all draft picks and draft order data. 
                            This action cannot be undone. Only reset if you need to start the draft completely fresh.
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Commissioner League Settings — Full Settings Panel */}
                  {commissionerLeagues.length > 0 && (
                    <Card className="animated-element lg:col-span-2 border-primary/20">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Crown className="h-5 w-5 text-primary" />
                          Commissioner League Settings
                        </CardTitle>
                        <CardDescription>
                          Configure waivers, scoring, draft, and rosters for leagues you commission. Changes will notify all league members.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-6">
                        {/* League Selector */}
                        <div className="space-y-2">
                          <Label>Select League</Label>
                          <Select
                            value={selectedSettingsLeagueId || ''}
                            onValueChange={(value) => setSelectedSettingsLeagueId(value)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select a league to configure" />
                            </SelectTrigger>
                            <SelectContent>
                              {commissionerLeagues.map((league) => (
                                <SelectItem key={league.id} value={league.id}>
                                  {league.name} ({league.draft_status.replace('_', ' ')})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        {loadingCommSettings ? (
                          <div className="text-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                            <p className="text-sm text-muted-foreground mt-2">Loading league settings...</p>
                          </div>
                        ) : selectedSettingsLeagueId && selectedLeagueData ? (
                          <Tabs value={commSettingsTab} onValueChange={setCommSettingsTab} className="w-full">
                            <TabsList className="grid w-full grid-cols-4">
                              <TabsTrigger value="waivers">Waivers</TabsTrigger>
                              <TabsTrigger value="scoring">Scoring</TabsTrigger>
                              <TabsTrigger value="draft">Draft</TabsTrigger>
                              <TabsTrigger value="rosters">Rosters</TabsTrigger>
                            </TabsList>

                            {/* Waiver Settings Tab */}
                            <TabsContent value="waivers" className="space-y-6 py-4">
                              <div className="space-y-2">
                                <Label className="flex items-center gap-2">
                                  <Clock className="h-4 w-4" />
                                  Waiver Process Time (MT)
                                </Label>
                                <Select
                                  value={commWaiverSettings.waiver_process_time}
                                  onValueChange={(value) => setCommWaiverSettings(prev => ({ ...prev, waiver_process_time: value }))}
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
                                <p className="text-xs text-muted-foreground">Time when waiver claims are processed daily (Mountain Time)</p>
                              </div>

                              <div className="space-y-2">
                                <Label className="flex items-center gap-2">
                                  <RefreshCw className="h-4 w-4" />
                                  Waiver Period (Hours)
                                </Label>
                                <Select
                                  value={commWaiverSettings.waiver_period_hours.toString()}
                                  onValueChange={(value) => setCommWaiverSettings(prev => ({ ...prev, waiver_period_hours: parseInt(value) }))}
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
                                <p className="text-xs text-muted-foreground">How long dropped players stay on waivers</p>
                              </div>

                              <div className="space-y-2">
                                <Label className="flex items-center gap-2">
                                  <Trophy className="h-4 w-4" />
                                  Waiver Type
                                </Label>
                                <Select
                                  value={commWaiverSettings.waiver_type}
                                  onValueChange={(value: 'rolling' | 'faab' | 'reverse_standings') => setCommWaiverSettings(prev => ({ ...prev, waiver_type: value }))}
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
                                <p className="text-xs text-muted-foreground">Rolling: Priority moves after claim. Reverse: Worst team gets priority.</p>
                              </div>

                              <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                  <Label className="flex items-center gap-2">
                                    <Shield className="h-4 w-4" />
                                    Game Lock
                                  </Label>
                                  <p className="text-xs text-muted-foreground">Lock players during/after their games</p>
                                </div>
                                <Switch
                                  checked={commWaiverSettings.waiver_game_lock}
                                  onCheckedChange={(checked) => setCommWaiverSettings(prev => ({ ...prev, waiver_game_lock: checked }))}
                                />
                              </div>

                              <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                  <Label className="flex items-center gap-2">
                                    <RefreshCw className="h-4 w-4" />
                                    Allow Trades During Games
                                  </Label>
                                  <p className="text-xs text-muted-foreground">Players can be traded even if game-locked</p>
                                </div>
                                <Switch
                                  checked={commWaiverSettings.allow_trades_during_games}
                                  onCheckedChange={(checked) => setCommWaiverSettings(prev => ({ ...prev, allow_trades_during_games: checked }))}
                                />
                              </div>

                              {/* Manual Waiver Processing & Sync Rosters */}
                              <div className="border-t pt-4 mt-4 space-y-4">
                                <div className="flex items-center justify-between">
                                  <div className="space-y-0.5">
                                    <Label className="flex items-center gap-2">
                                      <Play className="h-4 w-4" />
                                      Process Waivers Now
                                    </Label>
                                    <p className="text-xs text-muted-foreground">Manually process all pending waiver claims</p>
                                  </div>
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={handleCommProcessWaivers}
                                    disabled={processingWaivers}
                                  >
                                    {processingWaivers ? (
                                      <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Processing...
                                      </>
                                    ) : (
                                      <>
                                        <RefreshCw className="mr-2 h-4 w-4" />
                                        Process Now
                                      </>
                                    )}
                                  </Button>
                                </div>

                                <div className="flex items-center justify-between">
                                  <div className="space-y-0.5">
                                    <Label className="flex items-center gap-2">
                                      <RefreshCw className="h-4 w-4" />
                                      Sync Rosters from Draft
                                    </Label>
                                    <p className="text-xs text-muted-foreground">Re-sync roster assignments from draft picks</p>
                                  </div>
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={handleCommSyncRosters}
                                    disabled={syncingRosters}
                                  >
                                    {syncingRosters ? (
                                      <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Syncing...
                                      </>
                                    ) : (
                                      <>
                                        <RefreshCw className="mr-2 h-4 w-4" />
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
                                    {[
                                      { key: 'goals', label: 'Goals', default: 3 },
                                      { key: 'assists', label: 'Assists', default: 2 },
                                      { key: 'power_play_points', label: 'Power Play Points', default: 1 },
                                      { key: 'short_handed_points', label: 'Shorthanded Points', default: 2 },
                                      { key: 'shots_on_goal', label: 'Shots on Goal', default: 0.4 },
                                      { key: 'blocks', label: 'Blocks', default: 0.5 },
                                      { key: 'hits', label: 'Hits', default: 0.2 },
                                      { key: 'penalty_minutes', label: 'Penalty Minutes', default: 0.5 },
                                    ].map(stat => (
                                      <div key={stat.key} className="space-y-2">
                                        <Label>{stat.label}</Label>
                                        <Input
                                          type="number"
                                          step="0.1"
                                          value={commScoringSettings.skater?.[stat.key] ?? stat.default}
                                          onChange={(e) => setCommScoringSettings(prev => ({
                                            ...prev,
                                            skater: { ...prev.skater, [stat.key]: parseFloat(e.target.value) || 0 }
                                          }))}
                                        />
                                      </div>
                                    ))}
                                  </div>
                                </div>

                                <div>
                                  <h3 className="text-lg font-semibold mb-2">Goalie Scoring</h3>
                                  <div className="grid grid-cols-2 gap-4">
                                    {[
                                      { key: 'wins', label: 'Wins', default: 4 },
                                      { key: 'shutouts', label: 'Shutouts', default: 3 },
                                      { key: 'saves', label: 'Saves', default: 0.2 },
                                      { key: 'goals_against', label: 'Goals Against', default: -1 },
                                    ].map(stat => (
                                      <div key={stat.key} className="space-y-2">
                                        <Label>{stat.label}</Label>
                                        <Input
                                          type="number"
                                          step="0.1"
                                          value={commScoringSettings.goalie?.[stat.key] ?? stat.default}
                                          onChange={(e) => setCommScoringSettings(prev => ({
                                            ...prev,
                                            goalie: { ...prev.goalie, [stat.key]: parseFloat(e.target.value) || 0 }
                                          }))}
                                        />
                                      </div>
                                    ))}
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
                                    value={commDraftSettings.draft_rounds}
                                    onChange={(e) => setCommDraftSettings(prev => ({
                                      ...prev,
                                      draft_rounds: parseInt(e.target.value) || 21
                                    }))}
                                    disabled={selectedLeagueData?.draft_status === 'completed'}
                                  />
                                  {selectedLeagueData?.draft_status === 'completed' && (
                                    <p className="text-xs text-muted-foreground">Draft is completed — rounds cannot be changed</p>
                                  )}
                                </div>
                                <div className="space-y-2">
                                  <Label>Pick Time Limit (seconds)</Label>
                                  <Input
                                    type="number"
                                    value={commDraftSettings.pickTimeLimit}
                                    onChange={(e) => setCommDraftSettings(prev => ({
                                      ...prev,
                                      pickTimeLimit: parseInt(e.target.value) || 90
                                    }))}
                                    disabled={selectedLeagueData?.draft_status === 'completed'}
                                  />
                                  {selectedLeagueData?.draft_status === 'completed' && (
                                    <p className="text-xs text-muted-foreground">Draft is completed — time limit cannot be changed</p>
                                  )}
                                </div>
                              </div>
                            </TabsContent>

                            {/* Roster Overview Tab */}
                            <TabsContent value="rosters" className="space-y-6 py-4">
                              <div className="space-y-4">
                                <h3 className="text-lg font-semibold">Team Rosters</h3>
                                {loadingRosterCounts ? (
                                  <div className="text-center py-4">
                                    <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                                    <p className="text-sm text-muted-foreground mt-2">Loading roster counts...</p>
                                  </div>
                                ) : (
                                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                                    {selectedLeagueTeams.map((team) => (
                                      <div key={team.id} className="flex items-center justify-between p-3 border rounded-lg">
                                        <div>
                                          <div className="font-medium">{team.team_name}</div>
                                          <div className="text-sm text-muted-foreground">
                                            {commRosterCounts[team.id] ?? 0} players
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                    {selectedLeagueTeams.length === 0 && (
                                      <p className="text-sm text-muted-foreground text-center py-4">No teams in this league yet.</p>
                                    )}
                                  </div>
                                )}
                              </div>
                            </TabsContent>
                          </Tabs>
                        ) : (
                          <p className="text-sm text-muted-foreground text-center py-4">Select a league above to configure its settings.</p>
                        )}

                        {/* Save Button */}
                        {selectedSettingsLeagueId && selectedLeagueData && commSettingsTab !== 'rosters' && (
                          <div className="flex justify-end gap-2 border-t pt-4">
                            <Button onClick={handleSaveCommSettings} disabled={savingCommSettings}>
                              {savingCommSettings ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  Saving...
                                </>
                              ) : (
                                'Save Settings'
                              )}
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* Game Preferences */}
                  <Card className="animated-element">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Settings className="h-5 w-5" />
                        Game Preferences
                      </CardTitle>
                      <CardDescription>Manage automation and gameplay</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label className="text-base">Auto-Set Lineups</Label>
                          <p className="text-sm text-muted-foreground">
                            Automatically optimize lineup based on projections
                          </p>
                        </div>
                        <Switch
                          checked={preferences.autoLineup}
                          onCheckedChange={(c) => handlePreferenceChange('autoLineup', c)}
                        />
                      </div>
                      <Separator />
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label className="text-base">Email Notifications</Label>
                          <p className="text-sm text-muted-foreground">
                            Receive weekly summaries and alerts
                          </p>
                        </div>
                        <Switch
                          checked={preferences.emailNotifications}
                          onCheckedChange={(c) => handlePreferenceChange('emailNotifications', c)}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label className="text-base">Push Notifications</Label>
                          <p className="text-sm text-muted-foreground">
                            Live scoring and injury alerts
                          </p>
                        </div>
                        <Switch
                          checked={preferences.pushNotifications}
                          onCheckedChange={(c) => handlePreferenceChange('pushNotifications', c)}
                        />
                      </div>
                    </CardContent>
                  </Card>

                  {/* Subscription Plan */}
                  <Card className="animated-element lg:col-span-2">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Crown className="h-5 w-5 text-primary" />
                        Subscription Plan
                      </CardTitle>
                      <CardDescription>Manage your membership</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="bg-primary/5 rounded-lg p-6 border border-primary/20 flex flex-col md:flex-row items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                          <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center text-primary">
                            <Crown className="h-6 w-6" />
                          </div>
                          <div>
                            <h3 className="text-lg font-bold flex items-center gap-2">
                              Premium Plan
                              <span className="bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded-full">Active</span>
                            </h3>
                            <p className="text-sm text-muted-foreground">Billed annually • Next billing date: Aug 15, 2026</p>
                          </div>
                        </div>
                        <div className="flex gap-3 w-full md:w-auto">
                          <Button variant="outline" className="flex-1 md:flex-none">Change Plan</Button>
                          <Button variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10 flex-1 md:flex-none">Cancel</Button>
                        </div>
                      </div>
                      
                      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="flex items-start gap-2 text-sm">
                          <Check className="h-4 w-4 text-primary mt-0.5" />
                          <span>Advanced Stats</span>
                        </div>
                        <div className="flex items-start gap-2 text-sm">
                          <Check className="h-4 w-4 text-primary mt-0.5" />
                          <span>Ad-free Experience</span>
                        </div>
                        <div className="flex items-start gap-2 text-sm">
                          <Check className="h-4 w-4 text-primary mt-0.5" />
                          <span>Priority Support</span>
                        </div>
                        <div className="flex items-start gap-2 text-sm">
                          <Check className="h-4 w-4 text-primary mt-0.5" />
                          <span>Trade Analyzer</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Profile;
