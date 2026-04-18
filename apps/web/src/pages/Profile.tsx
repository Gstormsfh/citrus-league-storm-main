import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import { useProfile, useUpdateProfile } from '@/hooks/useProfile';
import { supabase } from '@/integrations/supabase/client';
import { Link, useSearchParams } from 'react-router-dom';
import { accountApi } from '@/api/account';
import { leagueApi } from '@/api/leagues';
import { rosterApi } from '@/api/rosters';
import { UserAccountService } from '@/services/UserAccountService';
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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
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
  Loader2,
  Sun,
  Moon,
  Monitor,
  FileText,
  Download,
  ExternalLink,
  Trash2,
  Pencil
} from 'lucide-react';
import { logger } from '@/utils/logger';
import { DEFAULT_SCORING } from '@/utils/scoringUtils';

const Profile = () => {
  const { user, signOut } = useAuth();
  const { userLeagueState } = useLeague();
  const { data: profile } = useProfile();
  const updateProfile = useUpdateProfile();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isEditing, setIsEditing] = useState(false);

  // Active Tab State Management — support ?tab= URL param
  const tabFromUrl = searchParams.get('tab');
  const validTabs = ['overview', 'stats', 'achievements', 'settings'];
  const [activeTab, setActiveTab] = useState(
    tabFromUrl && validTabs.includes(tabFromUrl) ? tabFromUrl : 'overview'
  );

  // Sync tab state with URL
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    if (tab === 'overview') {
      searchParams.delete('tab');
    } else {
      searchParams.set('tab', tab);
    }
    setSearchParams(searchParams, { replace: true });
  };

  // Display name editing state
  const [isEditingDisplayName, setIsEditingDisplayName] = useState(false);
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [savingDisplayName, setSavingDisplayName] = useState(false);

  // Avatar upload state
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    // Validate file type and size (max 2MB)
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Invalid file', description: 'Please select an image file.', variant: 'destructive' });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Avatar must be under 2MB.', variant: 'destructive' });
      return;
    }

    setUploadingAvatar(true);
    try {
      const ext = file.name.split('.').pop() || 'png';
      const filePath = `${user.id}/avatar.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      // Append cache-bust param so the browser loads the new image
      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;

      await updateProfile.mutateAsync({ avatar_url: publicUrl });

      toast({ title: 'Avatar updated', description: 'Your profile picture has been saved.' });
    } catch (err) {
      logger.error('Avatar upload failed:', err);
      toast({ title: 'Upload failed', description: 'Could not upload avatar. Please try again.', variant: 'destructive' });
    } finally {
      setUploadingAvatar(false);
      // Reset input so the same file can be re-selected
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  // Settings state (merged from old Settings page)
  const [changePasswordLoading, setChangePasswordLoading] = useState(false);
  const [deleteAccountLoading, setDeleteAccountLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>(() => {
    return (localStorage.getItem('citrus-theme') as 'light' | 'dark' | 'system') || 'light';
  });
  
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
  
  // Theme effect
  useEffect(() => {
    const root = document.documentElement;
    localStorage.setItem('citrus-theme', theme);

    const applyTheme = (prefersDark?: boolean) => {
      if (theme === 'dark') {
        root.classList.add('dark');
      } else if (theme === 'system') {
        const dark = prefersDark ?? window.matchMedia('(prefers-color-scheme: dark)').matches;
        root.classList.toggle('dark', dark);
      } else {
        root.classList.remove('dark');
      }
    };

    applyTheme();

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches);
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [theme]);

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
      setDisplayNameInput(profile.display_name || '');
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
        const { data: leagueData } = await leagueApi.getLeague(selectedSettingsLeagueId) as { data: any };

        if (!leagueData) throw new Error('League not found');
        setSelectedLeagueData(leagueData);

        // Load teams for this league
        try {
          const { data: teamsData } = await leagueApi.getTeams(selectedSettingsLeagueId) as { data: any[] };
          setSelectedLeagueTeams(teamsData || []);
        } catch {
          // Non-fatal: teams may fail to load
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
          setCommScoringSettings(DEFAULT_SCORING);
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
        try {
          const { data: playerIds } = await rosterApi.getPlayerIds(selectedSettingsLeagueId, team.id);
          counts[team.id] = Array.isArray(playerIds) ? playerIds.length : 0;
        } catch {
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
      const syncResponse = await rosterApi.syncRosters(selectedSettingsLeagueId);
      const syncResult = syncResponse.data;

      if (!syncResult) {
        toast({
          title: 'Error',
          description: 'Failed to sync rosters',
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

  // User stats — fetched from API
  const [userStats, setUserStats] = useState({
    totalSeasons: 0,
    championships: 0,
    playoffAppearances: 0,
    overallRecord: '—',
    currentRank: null as number | null,
    bestFinish: null as string | null,
    totalPoints: 0,
    avgPointsPerGame: 0,
    wins: 0,
    losses: 0,
    ties: 0,
    statsLoaded: false,
  });

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    accountApi.getStats()
      .then((resp) => {
        if (cancelled || !resp.data) return;
        const s = resp.data;
        const record = s.ties > 0
          ? `${s.wins}-${s.losses}-${s.ties}`
          : `${s.wins}-${s.losses}`;
        const totalMatchups = s.wins + s.losses + s.ties;
        setUserStats((prev) => ({
          ...prev,
          totalSeasons: s.totalSeasons,
          wins: s.wins,
          losses: s.losses,
          ties: s.ties,
          totalPoints: s.totalPoints,
          overallRecord: record,
          avgPointsPerGame: totalMatchups > 0
            ? Math.round((s.totalPoints / totalMatchups) * 10) / 10
            : 0,
          statsLoaded: true,
        }));
      })
      .catch((err) => {
        logger.error('Failed to fetch user stats', err);
        if (!cancelled) {
          setUserStats((prev) => ({ ...prev, statsLoaded: true }));
        }
      });
    return () => { cancelled = true; };
  }, [user]);

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

  // Get display name — prefer custom display_name, then first/last, then username
  const getDisplayName = () => {
    if (profile?.display_name) {
      return profile.display_name;
    }
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

      await updateProfile.mutateAsync(updateData);

      toast({
        title: "Profile updated",
        description: "Your profile information has been saved successfully.",
        variant: "default"
      });

      setIsEditing(false);
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

      await updateProfile.mutateAsync(updateData);

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

  // Display name save handler
  const handleSaveDisplayName = async () => {
    if (!user || !profile) return;
    const trimmed = displayNameInput.trim();
    if (!trimmed) {
      toast({ title: 'Error', description: 'Display name cannot be empty.', variant: 'destructive' });
      return;
    }
    setSavingDisplayName(true);
    try {
      await updateProfile.mutateAsync({ display_name: trimmed });
      setIsEditingDisplayName(false);
      toast({ title: 'Display name updated', description: `Your display name is now "${trimmed}".` });
    } catch (error: unknown) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update display name.',
        variant: 'destructive',
      });
    } finally {
      setSavingDisplayName(false);
    }
  };

  // Real password change handler (from old Settings page)
  const handleChangePasswordReal = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsMessage(null);

    if (newPassword.length < 8) {
      setSettingsMessage({ type: 'error', text: 'Password must be at least 8 characters' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setSettingsMessage({ type: 'error', text: 'Passwords do not match' });
      return;
    }

    setChangePasswordLoading(true);
    try {
      const result = await UserAccountService.changePassword(newPassword);
      if (!result.success) throw new Error(result.error);
      setSettingsMessage({ type: 'success', text: 'Password updated successfully!' });
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: unknown) {
      logger.error('Password change error:', error);
      setSettingsMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to update password',
      });
    } finally {
      setChangePasswordLoading(false);
    }
  };

  const handleExportData = async () => {
    setExportLoading(true);
    setSettingsMessage(null);
    try {
      const result = await UserAccountService.exportUserData();
      if (!result.success || !result.data) throw new Error(result.error || 'Export failed');

      const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `citrus-fantasy-data-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setSettingsMessage({ type: 'success', text: 'Your data has been exported successfully.' });
    } catch (error: unknown) {
      logger.error('Data export error:', error);
      setSettingsMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to export data. Please try again.',
      });
    } finally {
      setExportLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmation !== 'DELETE') {
      setSettingsMessage({ type: 'error', text: 'Please type DELETE to confirm' });
      return;
    }
    setDeleteAccountLoading(true);
    setSettingsMessage(null);
    try {
      const result = await UserAccountService.deleteAccount();
      if (!result.success) throw new Error(result.error || 'Deletion failed');
      await signOut();
    } catch (error: unknown) {
      logger.error('Account deletion error:', error);
      setSettingsMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to delete account. Please contact support.',
      });
      setDeleteAccountLoading(false);
    }
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
        <main className="pt-16 lg:pt-24 pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-16">
          <div className="container mx-auto px-3 sm:px-4">
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
      <main className="pt-16 lg:pt-24 pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-16">
        <div className="container mx-auto px-3 sm:px-4">
          <div className="max-w-6xl mx-auto">
            <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6 lg:space-y-8">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 lg:gap-4">
                <div className="flex items-center gap-3 lg:gap-4 animated-element">
                  <div className="relative group">
                    <Avatar className="h-16 w-16 lg:h-24 lg:w-24 border-4 border-primary/20">
                      <AvatarImage src={profile?.avatar_url || ''} alt={getDisplayName()} />
                      <AvatarFallback className="text-2xl font-bold bg-primary/10 text-primary">
                        {getInitials()}
                      </AvatarFallback>
                    </Avatar>
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleAvatarUpload}
                    />
                    <div
                      className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      onClick={() => avatarInputRef.current?.click()}
                    >
                      {uploadingAvatar ? (
                        <Loader2 className="h-6 w-6 text-white animate-spin" />
                      ) : (
                        <Camera className="h-6 w-6 text-white" />
                      )}
                    </div>
                  </div>
                  <div>
                    {isEditingDisplayName ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={displayNameInput}
                          onChange={(e) => setDisplayNameInput(e.target.value)}
                          className="text-xl font-bold h-10 w-64"
                          placeholder="Your display name"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveDisplayName();
                            if (e.key === 'Escape') { setIsEditingDisplayName(false); setDisplayNameInput(profile?.display_name || ''); }
                          }}
                        />
                        <Button size="sm" onClick={handleSaveDisplayName} disabled={savingDisplayName}>
                          {savingDisplayName ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setIsEditingDisplayName(false); setDisplayNameInput(profile?.display_name || ''); }}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 group">
                        <h1 className="text-xl lg:text-3xl font-bold">{getDisplayName()}</h1>
                        <button
                          onClick={() => { setDisplayNameInput(profile?.display_name || getDisplayName()); setIsEditingDisplayName(true); }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-accent"
                          title="Edit display name"
                        >
                          <Pencil className="h-4 w-4 text-muted-foreground" />
                        </button>
                      </div>
                    )}
                    <p className="text-xs lg:text-sm text-muted-foreground flex items-center gap-2 mt-1">
                      <Users className="h-3.5 w-3.5 lg:h-4 lg:w-4 flex-shrink-0" />
                      <span className="truncate">{formData.teamName || 'No team yet'} • Since {getMemberSince()}</span>
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
                      <Calendar className="h-8 w-8 mx-auto mb-2 text-yellow-500" />
                      <div className="text-2xl font-bold">{userStats.totalSeasons}</div>
                      <div className="text-sm text-muted-foreground">Leagues</div>
                    </CardContent>
                  </Card>
                  <Card className="animated-element">
                    <CardContent className="p-6 text-center">
                      <Target className="h-8 w-8 mx-auto mb-2 text-blue-500" />
                      <div className="text-2xl font-bold">{userStats.overallRecord}</div>
                      <div className="text-sm text-muted-foreground">W-L Record</div>
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
                      <div className="text-2xl font-bold">{userStats.avgPointsPerGame || '—'}</div>
                      <div className="text-sm text-muted-foreground">Avg Pts/Week</div>
                    </CardContent>
                  </Card>
                </div>

                <Card className="animated-element">
                  <CardHeader>
                    <CardTitle>Performance History</CardTitle>
                    <CardDescription>Your matchup results across all leagues</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {userStats.statsLoaded && userStats.totalSeasons > 0 ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-3 gap-4 text-center">
                          <div className="p-4 rounded-lg bg-green-500/10">
                            <div className="text-2xl font-bold text-green-600">{userStats.wins}</div>
                            <div className="text-xs text-muted-foreground">Wins</div>
                          </div>
                          <div className="p-4 rounded-lg bg-red-500/10">
                            <div className="text-2xl font-bold text-red-600">{userStats.losses}</div>
                            <div className="text-xs text-muted-foreground">Losses</div>
                          </div>
                          <div className="p-4 rounded-lg bg-gray-500/10">
                            <div className="text-2xl font-bold text-gray-600">{userStats.ties}</div>
                            <div className="text-xs text-muted-foreground">Ties</div>
                          </div>
                        </div>
                        {(userStats.wins + userStats.losses + userStats.ties) > 0 && (
                          <div className="flex items-center gap-2 pt-2">
                            <div className="text-xs text-muted-foreground">Win Rate</div>
                            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full bg-green-500 rounded-full transition-all"
                                style={{ width: `${Math.round((userStats.wins / (userStats.wins + userStats.losses + userStats.ties)) * 100)}%` }}
                              />
                            </div>
                            <div className="text-xs font-medium">
                              {Math.round((userStats.wins / (userStats.wins + userStats.losses + userStats.ties)) * 100)}%
                            </div>
                          </div>
                        )}
                      </div>
                    ) : userStats.statsLoaded ? (
                      <div className="text-center py-12">
                        <TrendingUp className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                        <h3 className="text-lg font-semibold mb-2">No Performance History</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                          {userLeagueState === 'active-user'
                            ? 'Complete a matchup week to see your performance history here.'
                            : 'Join a league and complete a season to see your performance history here.'}
                        </p>
                        {userLeagueState !== 'active-user' && (
                          <Button asChild>
                            <Link to="/create-league">Create or Join a League</Link>
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-8">
                        <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">Loading stats...</p>
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
                        {userLeagueState === 'active-user'
                          ? 'Keep competing to earn achievements!'
                          : 'Join a league and start competing to earn achievements!'}
                      </p>
                      {userLeagueState !== 'active-user' && (
                        <Button asChild>
                          <Link to="/create-league">Create or Join a League</Link>
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="settings" className="space-y-6">
                {settingsMessage && (
                  <div className={`p-3 rounded-lg text-sm ${settingsMessage.type === 'success' ? 'bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'}`}>
                    {settingsMessage.text}
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Display Name & Account Info */}
                  <Card className="animated-element lg:col-span-2">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <User className="h-5 w-5" />
                        Account Information
                      </CardTitle>
                      <CardDescription>Your identity and account details</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="settings-display-name">Display Name</Label>
                            <div className="flex gap-2">
                              <Input
                                id="settings-display-name"
                                value={displayNameInput}
                                onChange={(e) => setDisplayNameInput(e.target.value)}
                                placeholder="Choose a display name"
                              />
                              <Button
                                onClick={handleSaveDisplayName}
                                disabled={savingDisplayName || displayNameInput.trim() === (profile?.display_name || '')}
                                size="sm"
                                className="shrink-0"
                              >
                                {savingDisplayName ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                              </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">This is the name shown to other users across the platform.</p>
                          </div>
                          <div className="space-y-2">
                            <Label>Email Address</Label>
                            <div className="flex items-center gap-2 p-2 rounded-md bg-muted text-sm">
                              <Mail className="h-4 w-4 text-muted-foreground" />
                              {user?.email}
                            </div>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label className="flex items-center gap-2">
                              <Sun className="h-4 w-4" />
                              Appearance
                            </Label>
                            <div className="flex gap-2">
                              {([
                                { value: 'light' as const, label: 'Light', icon: Sun },
                                { value: 'dark' as const, label: 'Dark', icon: Moon },
                                { value: 'system' as const, label: 'System', icon: Monitor },
                              ]).map(({ value, label, icon: Icon }) => (
                                <Button
                                  key={value}
                                  variant={theme === value ? 'default' : 'outline'}
                                  onClick={() => setTheme(value)}
                                  className="flex-1"
                                  size="sm"
                                >
                                  <Icon className="mr-1.5 h-3.5 w-3.5" />
                                  {label}
                                </Button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Change Password */}
                  <Card className="animated-element">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Lock className="h-5 w-5" />
                        Change Password
                      </CardTitle>
                      <CardDescription>Update your account password</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <form onSubmit={handleChangePasswordReal} className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="settings-newPassword">New Password</Label>
                          <Input
                            id="settings-newPassword"
                            type="password"
                            placeholder="Min 8 characters"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            disabled={changePasswordLoading}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="settings-confirmPassword">Confirm New Password</Label>
                          <Input
                            id="settings-confirmPassword"
                            type="password"
                            placeholder="Confirm new password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            disabled={changePasswordLoading}
                          />
                        </div>
                        <Button
                          type="submit"
                          disabled={changePasswordLoading || !newPassword || !confirmPassword}
                          className="w-full"
                        >
                          {changePasswordLoading ? (
                            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Updating...</>
                          ) : (
                            'Update Password'
                          )}
                        </Button>
                      </form>
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

                  {/* Legal & Privacy */}
                  <Card className="animated-element">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <FileText className="h-5 w-5" />
                        Legal & Privacy
                      </CardTitle>
                      <CardDescription>Review our policies and terms</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <a
                        href="/privacy-policy.html"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between p-3 rounded-lg hover:bg-accent/50 transition-colors group"
                      >
                        <span className="font-medium group-hover:text-primary">Privacy Policy</span>
                        <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                      </a>
                      <Separator />
                      <a
                        href="/terms-of-service.html"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between p-3 rounded-lg hover:bg-accent/50 transition-colors group"
                      >
                        <span className="font-medium group-hover:text-primary">Terms of Service</span>
                        <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                      </a>
                    </CardContent>
                  </Card>

                  {/* Data Export */}
                  <Card className="animated-element">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Download className="h-5 w-5" />
                        Your Data
                      </CardTitle>
                      <CardDescription>Export a copy of all your data</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground mb-4">
                        Download a JSON file containing all your account data, including your profile, teams, leagues, transactions, and draft history.
                      </p>
                      <Button variant="outline" onClick={handleExportData} disabled={exportLoading} className="w-full">
                        {exportLoading ? (
                          <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Exporting...</>
                        ) : (
                          <><Download className="mr-2 h-4 w-4" />Export My Data</>
                        )}
                      </Button>
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
                              Free Plan
                              <span className="bg-muted text-muted-foreground text-xs px-2 py-0.5 rounded-full">Premium Coming Soon</span>
                            </h3>
                            <p className="text-sm text-muted-foreground">All features are free during the beta period</p>
                          </div>
                        </div>
                      </div>

                      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="flex items-start gap-2 text-sm">
                          <Check className="h-4 w-4 text-primary mt-0.5" />
                          <span>Advanced Stats <span className="text-xs text-muted-foreground">(Free during Beta)</span></span>
                        </div>
                        <div className="flex items-start gap-2 text-sm">
                          <Check className="h-4 w-4 text-primary mt-0.5" />
                          <span>Ad-free Experience <span className="text-xs text-muted-foreground">(Free during Beta)</span></span>
                        </div>
                        <div className="flex items-start gap-2 text-sm">
                          <Check className="h-4 w-4 text-primary mt-0.5" />
                          <span>Priority Support <span className="text-xs text-muted-foreground">(Free during Beta)</span></span>
                        </div>
                        <div className="flex items-start gap-2 text-sm">
                          <Check className="h-4 w-4 text-primary mt-0.5" />
                          <span>Trade Analyzer <span className="text-xs text-muted-foreground">(Free during Beta)</span></span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Delete Account */}
                  <Card className="animated-element lg:col-span-2 border-destructive/20 bg-destructive/5">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-destructive">
                        <Trash2 className="h-5 w-5" />
                        Delete Account
                      </CardTitle>
                      <CardDescription className="text-destructive/80">
                        Permanently delete your account and all associated data
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="bg-background p-4 rounded-lg border border-destructive/20">
                        <h4 className="font-semibold text-destructive mb-2">This action cannot be undone</h4>
                        <ul className="text-sm text-destructive/80 space-y-1 ml-4 list-disc">
                          <li>Your account and authentication credentials will be permanently deleted</li>
                          <li>All your fantasy teams and league data will be removed</li>
                          <li>If you're a league commissioner, your leagues may be orphaned</li>
                          <li>Your draft history and transactions will be anonymized</li>
                        </ul>
                      </div>

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive" className="w-full">
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete My Account
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                            <AlertDialogDescription className="space-y-4">
                              <p>
                                This will permanently delete your account and all associated data.
                                This action cannot be undone.
                              </p>
                              <div>
                                <Label htmlFor="deleteConfirmation" className="text-sm font-medium">
                                  Type <span className="font-bold text-destructive">DELETE</span> to confirm:
                                </Label>
                                <Input
                                  id="deleteConfirmation"
                                  value={deleteConfirmation}
                                  onChange={(e) => setDeleteConfirmation(e.target.value)}
                                  placeholder="DELETE"
                                  className="mt-2"
                                />
                              </div>
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel onClick={() => setDeleteConfirmation('')}>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={handleDeleteAccount}
                              disabled={deleteConfirmation !== 'DELETE' || deleteAccountLoading}
                              className="bg-destructive hover:bg-destructive/90"
                            >
                              {deleteAccountLoading ? (
                                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Deleting...</>
                              ) : (
                                'Delete Account'
                              )}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </CardContent>
                  </Card>

                  <div className="lg:col-span-2 text-center text-sm text-muted-foreground">
                    <p>Need help? Contact us at <a href="mailto:CitrusFantasySports@Gmail.com" className="text-primary hover:underline">CitrusFantasySports@Gmail.com</a></p>
                  </div>
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
