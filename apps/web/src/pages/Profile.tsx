import { userMessage } from '@/lib/userMessage';
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import { useProfile, useUpdateProfile } from '@/hooks/useProfile';
import { supabase } from '@/integrations/supabase/client';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { HockeyFooter } from '@/components/citrus2';
import { accountApi } from '@/api/account';
import { leagueApi } from '@/api/leagues';
import { rosterApi } from '@/api/rosters';
import { UserAccountService, type ConsentStatus } from '@/services/UserAccountService';
import { CONSENT_CHANGED_EVENT } from '@/lib/consent';
import { LeagueService } from '@/services/LeagueService';
import { DraftService } from '@/services/DraftService';
import { WaiverService } from '@/services/WaiverService';
import Navbar from '@/components/Navbar';
import { PressBoxAppHeader } from '@/components/pressbox/AppHeader';
import { ProfilePhone, type ProfileTab } from '@/components/account/ProfilePhone';
import { useIsMobile } from '@/hooks/useIsMobile';
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
  Clock,
  RefreshCw,
  Play,
  Loader2,
  Moon,
  FileText,
  Download,
  ExternalLink,
  Trash2,
  Pencil,
  ShieldCheck,
  ShieldAlert
} from 'lucide-react';
import { DestructiveConsequence } from '@/components/confirm/DestructiveConsequence';
import { CONFIRM_SURFACE_RING } from '@/components/confirm/destructiveConfirm';
import { logger } from '@/utils/logger';
import { DEFAULT_SCORING } from '@/utils/scoringUtils';
import { SCORING_DEFAULTS } from '@citrus/shared';

// Commissioner scoring-form fields — labels and fallback defaults derive
// from the scoring source of truth (packages/shared/src/constants/
// scoringDefaults.json); no weight literal lives here. The form has never
// exposed plus/minus (the projection engine cannot model it — see
// SCORING_DEFAULTS.provenance.deviations), so it stays out of the grid.
const COMMISSIONER_SCORING_FIELDS = {
  skater: SCORING_DEFAULTS.stats
    .filter((stat) => stat.group === 'skater' && stat.key !== 'plus_minus')
    .map((stat) => ({ key: stat.key, label: stat.name, default: stat.points })),
  goalie: SCORING_DEFAULTS.stats
    .filter((stat) => stat.group === 'goalie')
    .map((stat) => ({ key: stat.key, label: stat.name, default: stat.points })),
};

/** 'privacy_policy' -> 'Privacy Policy'. Policy types come from the DB, so this
 *  formats whatever is there rather than switching on a fixed list. */
const prettyPolicy = (t: string) =>
  t.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());

const CONSENT_PRESENTATION: Record<
  ConsentStatus['status'],
  { label: string; tone: string; action: 'grant' | 'withdraw'; blurb: string }
> = {
  current:     { label: 'Active',        tone: 'text-emerald-300 ring-emerald-300/30',
                 action: 'withdraw', blurb: 'You have accepted the current version.' },
  outdated:    { label: 'Update needed', tone: 'text-amber-300 ring-amber-300/30',
                 action: 'grant',    blurb: 'This policy has changed since you accepted it.' },
  withdrawn:   { label: 'Withdrawn',     tone: 'text-white/60 ring-white/20',
                 action: 'grant',    blurb: 'You withdrew consent. You can grant it again at any time.' },
  never_given: { label: 'Not recorded',  tone: 'text-amber-300 ring-amber-300/30',
                 action: 'grant',    blurb: 'We have no consent on record for this policy.' },
};

const Profile = () => {
  const { user, signOut, resetPassword } = useAuth();
  const { userLeagueState } = useLeague();
  const { data: profile } = useProfile();
  const updateProfile = useUpdateProfile();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
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

    if (!file.type.startsWith('image/')) {
      toast({ title: 'Invalid file', description: 'Please select an image file.', variant: 'destructive' });
      return;
    }

    setUploadingAvatar(true);
    try {
      // Client-side compression + center-crop to square.
      // This brings a 10MB phone photo down to ~30-80KB — well under
      // any storage limit. Also handles the Instagram-style circle
      // display: crop to square here, CSS border-radius: 50% on
      // render. No cropping UI needed.
      const compressedBlob = await new Promise<Blob>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const TARGET = 400; // 400×400 square
          const canvas = document.createElement('canvas');
          canvas.width = TARGET;
          canvas.height = TARGET;
          const ctx = canvas.getContext('2d');
          if (!ctx) { reject(new Error('No canvas context')); return; }

          // Center-crop: take the largest centered square from the source
          const side = Math.min(img.width, img.height);
          const sx = (img.width - side) / 2;
          const sy = (img.height - side) / 2;
          ctx.drawImage(img, sx, sy, side, side, 0, 0, TARGET, TARGET);

          canvas.toBlob(
            (blob) => blob ? resolve(blob) : reject(new Error('Compression failed')),
            'image/jpeg',
            0.82 // quality — good balance between size and clarity
          );
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = URL.createObjectURL(file);
      });

      const filePath = `${user.id}/avatar.jpg`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, compressedBlob, {
          upsert: true,
          contentType: 'image/jpeg',
        });

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
  const [consentRows, setConsentRows] = useState<ConsentStatus[]>([]);
  const [consentLoading, setConsentLoading] = useState(true);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [consentBusy, setConsentBusy] = useState<string | null>(null);
  const [settingsMessage, setSettingsMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [sendingReset, setSendingReset] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');

  // HOW THIS ACCOUNT SIGNS IN (2026-09-05). Supabase lists every linked
  // identity; `email` means a password exists. A Google- or Apple-only
  // account has none, so the change-password form would only ever fail for
  // it -- that account gets the reset link instead, which is also how it
  // adds a password if it wants one.
  const signInProviders: string[] = Array.from(new Set(
    (user?.identities?.map((i) => i.provider) ?? user?.app_metadata?.providers ?? [])
      .filter((p): p is string => typeof p === 'string'),
  ));
  const hasPassword = signInProviders.includes('email');
  // 2026-08-24 click-sweep: the Light/Dark/System appearance toggle is gone.
  // The shipped design system is single-theme — the forest-dark palette lives
  // on the :root tokens. Adding `.dark` flipped every token to an unmaintained
  // legacy warm-brown palette (off-brand instant re-theme), "Light" visibly
  // did nothing, and "System" made two users see two different apps depending
  // on their OS. The cleanup effect below also scrubs any stored preference
  // and stray `.dark` class left behind for users who had toggled it.
  
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
  
  // Theme cleanup: remove the legacy `.dark` class / stored preference so
  // users who toggled the old switch come back to the real Citrus theme.
  useEffect(() => {
    document.documentElement.classList.remove('dark');
    try { localStorage.removeItem('citrus-theme'); } catch { /* private mode */ }
  }, []);

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

  /**
   * THE ONE NOTIFICATION SWITCH THAT IS REAL (2026-09-04). This was a
   * `preferences` state object with four keys (email, push, dark mode,
   * public profile) that `handlePreferenceChange` wrote to and then toasted
   * "saved automatically". Nothing was saved anywhere. The app sends exactly
   * one push -- "You're on the clock", from the draft engine -- and no email
   * at all (no mailer in the repo), so the switch that exists is the push
   * opt-in, stored on the profile and honoured by PushService.
   */
  const pushEnabled = profile?.push_notifications ?? true;

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
    waiver_type: 'rolling' as 'rolling' | 'reverse_draft_order' | 'faab' | 'reverse_standings',
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
          title: "Profile Hiccup",
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
      // PERF (2026-09-04): same fix as LeagueDashboard's rosters tab — one
      // request per team, awaited in series, for counts that share no data.
      const entries = await Promise.all(
        selectedLeagueTeams.map(async (team) => {
          try {
            const { data: playerIds } = await rosterApi.getPlayerIds(selectedSettingsLeagueId, team.id);
            return [team.id, Array.isArray(playerIds) ? playerIds.length : 0] as const;
          } catch {
            return [team.id, 0] as const;
          }
        }),
      );
      const counts: Record<string, number> = {};
      for (const [teamId, count] of entries) counts[teamId] = count;
      
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
          title: "Profile Hiccup",
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
        title: "Profile Hiccup",
        description: userMessage(err, "Couldn't save those settings. Try again in a moment."),
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
      const result = await WaiverService.processAllPendingWaivers(selectedSettingsLeagueId);

      if (!result.success) {
        toast({
          title: "Profile Hiccup",
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
        title: "Profile Hiccup",
        description: userMessage(err, "Couldn't process the waiver run. Try again in a moment."),
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
          title: "Profile Hiccup",
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
          description: `Synced ${playersSynced} players. Refresh the page if a lineup still looks stale.`,
        });
      }
    } catch (err: any) {
      toast({
        title: "Profile Hiccup",
        description: userMessage(err, "Couldn't sync the rosters. Try again in a moment."),
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
    overallRecord: '-',
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
    // SWEEP FIX (2026-08-16): display_name outranks username, and the
    // generated signup handle (user_<id>) must never drive initials —
    // it rendered "US" for everyone without a real name set.
    if (profile?.display_name) {
      return profile.display_name.substring(0, 2).toUpperCase();
    }
    if (profile?.username && !/^user_[0-9a-f]{6,}$/i.test(profile.username)) {
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

  const handlePushToggle = async (value: boolean) => {
    try {
      await updateProfile.mutateAsync({ push_notifications: value });
      toast({
        title: value ? 'On-the-clock alerts on' : 'On-the-clock alerts off',
        description: value ? "We'll push when a pick is yours." : 'No push when a pick is yours.',
      });
    } catch (error: unknown) {
      toast({
        title: 'Could not save that',
        description: userMessage(error, 'Try the switch again in a moment.'),
        variant: 'destructive',
      });
    }
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
        title: "Profile Hiccup",
        description: userMessage(error, "Couldn't save your profile. Try again in a moment."),
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
        title: "Profile Hiccup",
        description: userMessage(error, "Couldn't save that team name. Try again in a moment."),
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
      toast({ title: "Profile Hiccup", description: 'Display name cannot be empty.', variant: 'destructive' });
      return;
    }
    setSavingDisplayName(true);
    try {
      await updateProfile.mutateAsync({ display_name: trimmed });
      setIsEditingDisplayName(false);
      toast({ title: 'Display name updated', description: `Your display name is now "${trimmed}".` });
    } catch (error: unknown) {
      toast({
        title: "Profile Hiccup",
        description: userMessage(error, 'Failed to update display name.'),
        variant: 'destructive',
      });
    } finally {
      setSavingDisplayName(false);
    }
  };

  // Real password change handler (from old Settings page). The current
  // password is checked first for an account that has one (2026-09-05).
  const handleChangePasswordReal = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsMessage(null);

    if (hasPassword && !currentPassword) {
      setSettingsMessage({ type: 'error', text: 'Enter your current password first' });
      return;
    }
    if (newPassword.length < 8) {
      setSettingsMessage({ type: 'error', text: 'Password must be at least 8 characters' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setSettingsMessage({ type: 'error', text: 'Passwords do not match' });
      return;
    }
    if (hasPassword && newPassword === currentPassword) {
      setSettingsMessage({ type: 'error', text: 'The new password is the same as the current one' });
      return;
    }

    setChangePasswordLoading(true);
    try {
      const result = await UserAccountService.changePassword(
        newPassword,
        hasPassword && user?.email ? { email: user.email, currentPassword } : undefined,
      );
      if (!result.success && result.needsReauth && user?.email) {
        // Supabase wants a recent sign-in for this and the account has no
        // password to sign in with: the reset link is the same proof, by email.
        const { error: linkError } = await resetPassword(user.email);
        if (linkError) throw linkError;
        setSettingsMessage({ type: 'success', text: `For safety we emailed a link to ${user.email} to set it. It expires in an hour.` });
        setNewPassword('');
        setConfirmPassword('');
        return;
      }
      if (!result.success) throw new Error(result.error);
      setSettingsMessage({ type: 'success', text: 'Password updated successfully!' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: unknown) {
      logger.error('Password change error:', error);
      setSettingsMessage({
        type: 'error',
        text: userMessage(error, 'Failed to update password'),
      });
    } finally {
      setChangePasswordLoading(false);
    }
  };

  // FORGOT IT (2026-09-05): the same recovery email the sign-in screen
  // sends. It is the only path for a Google or Apple account that wants a
  // password, and the honest one for anyone who cannot type the current one.
  const handleSendResetLink = async () => {
    if (!user?.email || sendingReset) return;
    setSendingReset(true);
    setSettingsMessage(null);
    try {
      const { error } = await resetPassword(user.email);
      if (error) throw error;
      setSettingsMessage({ type: 'success', text: `Reset link sent to ${user.email}. It expires in an hour.` });
    } catch (error: unknown) {
      logger.error('Reset link error:', error);
      setSettingsMessage({ type: 'error', text: userMessage(error, 'Could not send the reset link. Try again.') });
    } finally {
      setSendingReset(false);
    }
  };

  // SIGN OUT (2026-09-05). The phone had no way out of an account: the
  // desktop's is in the Navbar the phone does not draw.
  const handleSignOut = async () => {
    await signOut();
    navigate('/auth', { replace: true });
  };

  // ── GDPR consent ──────────────────────────────────────────────────
  // The server side of this shipped without a caller, which meant a user could
  // neither see what they had agreed to nor withdraw it — Art. 7(3) requires
  // withdrawal to be as easy as granting.
  const loadConsent = async () => {
    setConsentLoading(true);
    setConsentError(null);
    const result = await UserAccountService.getConsentStatus();
    if (!result.success) {
      // Show the failure rather than an empty list: "no policies" and "we could
      // not read your policies" must not look identical.
      setConsentError(result.error || 'Could not load your consent status.');
      setConsentRows([]);
    } else {
      setConsentRows(result.data ?? []);
    }
    setConsentLoading(false);
  };

  useEffect(() => {
    if (!user) return;
    void loadConsent();
    // The terms gate records over this screen; its rows re-read on the event.
    const onChanged = () => void loadConsent();
    window.addEventListener(CONSENT_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CONSENT_CHANGED_EVENT, onChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const handleGrantConsent = async (row: ConsentStatus) => {
    setConsentBusy(row.policy_type);
    const result = await UserAccountService.grantConsent(row.policy_type, row.required_version);
    setConsentBusy(null);
    if (result.success) {
      toast({ title: 'Consent recorded', description: `${prettyPolicy(row.policy_type)} v${row.required_version}.` });
      await loadConsent();
    } else {
      toast({ title: 'Could not record consent', description: result.error, variant: 'destructive' });
    }
  };

  const handleWithdrawConsent = async (row: ConsentStatus) => {
    setConsentBusy(row.policy_type);
    const result = await UserAccountService.withdrawConsent(row.policy_type);
    setConsentBusy(null);
    if (result.success) {
      toast({
        title: 'Consent withdrawn',
        description: `${prettyPolicy(row.policy_type)}. Your grant date and withdrawal date are both kept as a record.`,
      });
      await loadConsent();
    } else {
      toast({ title: 'Could not withdraw consent', description: result.error, variant: 'destructive' });
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
        text: userMessage(error, 'Failed to export data. Please try again.'),
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
      navigate('/auth', { replace: true });
    } catch (error: unknown) {
      logger.error('Account deletion error:', error);
      setSettingsMessage({
        type: 'error',
        text: userMessage(error, 'Failed to delete account. Please contact support.'),
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
        description: userMessage(error, "Couldn't reset the draft. Try again in a moment."),
        variant: "destructive"
      });
    }
  };

  /**
   * PRESS BOX (2026-09-04, PR10p): the phone draws the account as the
   * settings screen's rows. The layers are gated on the viewport rather than
   * stacked, so one form owns each input and the page's tests see one set
   * of strings. Every handler is the page's own.
   */
  const isMobile = useIsMobile();

  // If user is not logged in, show signup prompt
  if (!user) {
    return (
      <div className="min-h-screen bg-pressbox-surface text-pastel-cream">
        {/* MOBILE CHROME (2026-09-01): Profile was the last core page on the
            old shell — global fixed Navbar + a hard pt-16. The fixed bar
            grows by env(safe-area-inset-top) on notched phones while pt-16
            doesn't, so in the native app the page's first ~50px rendered
            UNDERNEATH the translucent bar ("settings page appears to be
            desktop version"). Every other core page hides the Navbar below
            lg and renders its own sticky safe-area header (see
            LeagueDashboard); Profile now matches. */}
        <div className="hidden lg:block"><Navbar /></div>
        {/* PRESS BOX (2026-09-04): the app header in place of the 09-01 title
            bar and its hamburger, which opened the old menu sheet. The app
            nav is the way around; the header names the screen. */}
        <div className="lg:hidden pt-[env(safe-area-inset-top)]">
          <PressBoxAppHeader title="Account" logoSrc="/favicon.svg" />
        </div>
        {isMobile && (
          <div className="pb-type px-3.5 pt-6 pb-app-chrome text-center" data-testid="profile-phone-signed-out">
            <p className="font-plex font-semibold text-[9px] tracking-[0.14em] text-pressbox-orange-soft">SIGN IN REQUIRED</p>
            <h2 className="mt-2 font-condensed font-extrabold text-[24px] uppercase tracking-[0.02em] leading-none text-pressbox-text">Your account</h2>
            <p className="mt-2 font-barlow text-[13px] leading-[1.45] text-pressbox-text/60">Sign in or create an account to see your profile.</p>
            <Link to="/auth" className="mt-5 inline-flex w-full h-11 items-center justify-center rounded-[10px] bg-pressbox-orange text-pressbox-orange-ink font-condensed font-bold text-[15px] uppercase tracking-[0.06em]">
              Sign in or sign up
            </Link>
            <Link to="/" className="mt-2 inline-flex w-full h-11 items-center justify-center rounded-[10px] border border-white/[0.12] bg-white/[0.03] text-pressbox-text/80 font-condensed font-bold text-[15px] uppercase tracking-[0.06em]">
              Home
            </Link>
          </div>
        )}
        {!isMobile && <main className="w-full pt-6 lg:pt-24 pb-app-chrome lg:pb-16">
          <div className="container mx-auto px-3 sm:px-4">
            <div className="max-w-2xl mx-auto">
              <Card className="bg-[#1A2A20] border-0 ring-1 ring-pastel-orange/30 rounded-2xl shadow-[0_24px_60px_-16px_rgba(255,168,87,0.25)] relative overflow-hidden">
                <div aria-hidden="true" className="absolute top-0 right-0 w-64 h-64 bg-pastel-orange/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
                <CardHeader className="relative z-10">
                  <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-1.5">
                    ✦ Sign In Required
                  </div>
                  <CardTitle className="font-calistoga text-2xl text-pastel-cream">Welcome to your profile.</CardTitle>
                  <CardDescription className="text-white/55 mt-2">
                    Please sign in or create an account to view your profile.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 relative z-10">
                  <Button asChild className="w-full bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft font-bold shadow-[0_8px_24px_-8px_rgba(255,168,87,0.5)]">
                    <Link to="/auth">Sign In / Sign Up</Link>
                  </Button>
                  <Button asChild variant="outline" className="w-full bg-transparent border border-pastel-cream/30 text-pastel-cream hover:bg-white/5 hover:border-pastel-cream/50 font-bold">
                    <Link to="/">Go to Homepage</Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </main>}
        <HockeyFooter variant="app" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-pressbox-surface text-pastel-cream">
      {/* MOBILE CHROME (2026-09-01) — same pattern as the signed-out branch
          above and every other core page: Navbar is desktop-only, phones get
          the sticky safe-area header + bottom nav. */}
      <div className="hidden lg:block"><Navbar /></div>
      {/* PRESS BOX (2026-09-04): the app header in place of the 09-01 title
          bar and its hamburger, which opened the old menu sheet. The app
          nav is the way around; the header names the screen. */}
      <div className="lg:hidden pt-[env(safe-area-inset-top)]">
        <PressBoxAppHeader title="Account" logoSrc="/favicon.svg" />
      </div>
      {isMobile && (
        <ProfilePhone
          tab={activeTab as ProfileTab}
          onTabChange={handleTabChange}
          hero={{
            avatarUrl: profile?.avatar_url,
            initials: getInitials(),
            displayName: getDisplayName(),
            teamName: formData.teamName,
            since: getMemberSince(),
            championships: userStats.championships,
            uploading: uploadingAvatar,
            onAvatarInput: handleAvatarUpload,
          }}
          identity={{
            firstName: formData.firstName,
            lastName: formData.lastName,
            email: formData.email,
            phone: formData.phone,
            location: formData.location,
            bio: formData.bio,
            editing: isEditing,
            onEditing: setIsEditing,
            onChange: handleInputChange,
            onSave: handleSave,
          }}
          stats={userStats}
          activity={recentActivity}
          achievements={achievements}
          hasLeague={userLeagueState === 'active-user'}
          settings={{
            message: settingsMessage,
            displayName: displayNameInput,
            onDisplayName: setDisplayNameInput,
            canSaveDisplayName: displayNameInput.trim() !== (profile?.display_name || ''),
            savingDisplayName,
            onSaveDisplayName: handleSaveDisplayName,
            email: user.email ?? '',
            signInProviders,
            hasPassword,
            currentPassword,
            newPassword,
            confirmPassword,
            onCurrentPassword: setCurrentPassword,
            onNewPassword: setNewPassword,
            onConfirmPassword: setConfirmPassword,
            changingPassword: changePasswordLoading,
            onChangePassword: handleChangePasswordReal,
            sendingReset,
            onSendResetLink: () => void handleSendResetLink(),
            onSignOut: () => void handleSignOut(),
            team: {
              name: formData.teamName,
              abbr: formData.teamAbbr,
              slogan: formData.teamDescription,
              onChange: handleInputChange,
              onSave: handleSaveTeamName,
            },
            commissionerLeagues,
            loadingLeagues,
            onResetDraft: handleResetLeagueDraft,
            onOpenLeague: (id) => navigate(`/league/${id}?league=${id}`),
            consent: {
              rows: consentRows,
              loading: consentLoading,
              error: consentError,
              busy: consentBusy,
              onGrant: handleGrantConsent,
              onWithdraw: handleWithdrawConsent,
              onRetry: loadConsent,
            },
            pushEnabled,
            pushSaving: updateProfile.isPending,
            onPushToggle: (on) => void handlePushToggle(on),
            exporting: exportLoading,
            onExport: handleExportData,
            deleteConfirmation,
            onDeleteConfirmation: setDeleteConfirmation,
            deleting: deleteAccountLoading,
            onDelete: handleDeleteAccount,
          }}
        />
      )}
      {!isMobile && <main className="w-full pt-6 lg:pt-24 pb-app-chrome lg:pb-16">
        <div className="container mx-auto px-3 sm:px-4">
          <div className="max-w-6xl mx-auto">
            <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6 lg:space-y-8">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 lg:gap-4">
                <div className="flex items-center gap-3 lg:gap-4 animated-element">
                  <div className="relative group">
                    <Avatar className="h-16 w-16 lg:h-24 lg:w-24 ring-2 ring-pastel-orange/40">
                      <AvatarImage src={profile?.avatar_url || ''} alt={getDisplayName()} />
                      <AvatarFallback className="text-2xl font-bold bg-pastel-orange/20 text-pastel-orange-soft">
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
                      className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      onClick={() => avatarInputRef.current?.click()}
                    >
                      {uploadingAvatar ? (
                        <Loader2 className="h-6 w-6 text-pastel-cream animate-spin" />
                      ) : (
                        <Camera className="h-6 w-6 text-pastel-cream" />
                      )}
                    </div>
                  </div>
                  <div>
                    {isEditingDisplayName ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={displayNameInput}
                          onChange={(e) => setDisplayNameInput(e.target.value)}
                          className="text-xl font-bold h-10 w-64 bg-white/5 border-white/10 text-pastel-cream placeholder:text-white/55 focus-visible:ring-pastel-orange/40"
                          placeholder="Your display name"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveDisplayName();
                            if (e.key === 'Escape') { setIsEditingDisplayName(false); setDisplayNameInput(profile?.display_name || ''); }
                          }}
                        />
                        <Button size="sm" onClick={handleSaveDisplayName} disabled={savingDisplayName} className="bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft font-bold disabled:opacity-50">
                          {savingDisplayName ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setIsEditingDisplayName(false); setDisplayNameInput(profile?.display_name || ''); }} className="text-white/55 hover:text-pastel-cream hover:bg-white/5">
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 group">
                        <h1 className="font-calistoga text-2xl lg:text-4xl text-pastel-cream leading-none">{getDisplayName()}</h1>
                        <button
                          onClick={() => { setDisplayNameInput(profile?.display_name || getDisplayName()); setIsEditingDisplayName(true); }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-white/5"
                          title="Edit display name"
                        >
                          <Pencil className="h-4 w-4 text-white/55" />
                        </button>
                      </div>
                    )}
                    <p className="text-xs lg:text-sm text-white/55 flex items-center gap-2 mt-2">
                      <Users className="h-3.5 w-3.5 lg:h-4 lg:w-4 flex-shrink-0" />
                      <span className="truncate">{formData.teamName || 'No team yet'} · Since {getMemberSince()}</span>
                    </p>
                    {userStats.championships > 0 && (
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant="secondary" className="bg-pastel-orange/20 ring-1 ring-pastel-orange/40 text-pastel-orange-soft border-0 text-[10px] font-jbmono uppercase tracking-[0.18em] font-bold">
                          <Trophy className="h-3 w-3 mr-1" />
                          {userStats.championships}x Champion
                        </Badge>
                      </div>
                    )}
                  </div>
                </div>

                <TabsList className="animated-element w-full lg:w-auto grid grid-cols-4 lg:flex bg-[#1A2A20] ring-1 ring-white/10 p-1 rounded-xl">
                  <TabsTrigger value="overview" className="px-1.5 sm:px-3 text-xs sm:text-sm text-white/55 hover:text-pastel-cream font-bold data-[state=active]:bg-pastel-orange data-[state=active]:text-[#581E00] data-[state=active]:shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)]">Overview</TabsTrigger>
                  <TabsTrigger value="stats" className="px-1.5 sm:px-3 text-xs sm:text-sm text-white/55 hover:text-pastel-cream font-bold data-[state=active]:bg-pastel-orange data-[state=active]:text-[#581E00] data-[state=active]:shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)]">Statistics</TabsTrigger>
                  <TabsTrigger value="achievements" className="px-1.5 sm:px-3 text-xs sm:text-sm text-white/55 hover:text-pastel-cream font-bold data-[state=active]:bg-pastel-orange data-[state=active]:text-[#581E00] data-[state=active]:shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)]">Trophies</TabsTrigger>
                  <TabsTrigger value="settings" className="px-1.5 sm:px-3 text-xs sm:text-sm text-white/55 hover:text-pastel-cream font-bold data-[state=active]:bg-pastel-orange data-[state=active]:text-[#581E00] data-[state=active]:shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)]">Settings</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="overview" className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Profile Info */}
                  <div className="lg:col-span-2 space-y-6">
                    <Card className="animated-element bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                      <CardHeader className="flex flex-row items-center justify-between">
                        <div>
                          <CardTitle className="flex items-center gap-2 font-calistoga text-pastel-cream">
                            <User className="h-5 w-5 text-pastel-orange" />
                            Personal Information
                          </CardTitle>
                          <CardDescription className="text-white/55">Your basic profile details</CardDescription>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setIsEditing(!isEditing)}
                          className="bg-transparent border border-pastel-cream/30 text-pastel-cream hover:bg-white/5 hover:border-pastel-cream/50 font-bold"
                        >
                          <Edit3 className="h-4 w-4 mr-2" />
                          {isEditing ? 'Cancel' : 'Edit'}
                        </Button>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor="firstName" className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-pastel-orange-soft font-bold">First Name</Label>
                            {isEditing ? (
                              <Input
                                id="firstName"
                                value={formData.firstName}
                                onChange={(e) => handleInputChange('firstName', e.target.value)}
                                className="bg-white/5 border-white/10 text-pastel-cream placeholder:text-white/55 focus-visible:ring-pastel-orange/40 mt-1.5"
                              />
                            ) : (
                              <p className="text-sm text-white/70 mt-1.5">{formData.firstName || <span className="italic text-white/55">Not set</span>}</p>
                            )}
                          </div>
                          <div>
                            <Label htmlFor="lastName" className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-pastel-orange-soft font-bold">Last Name</Label>
                            {isEditing ? (
                              <Input
                                id="lastName"
                                value={formData.lastName}
                                onChange={(e) => handleInputChange('lastName', e.target.value)}
                                className="bg-white/5 border-white/10 text-pastel-cream placeholder:text-white/55 focus-visible:ring-pastel-orange/40 mt-1.5"
                              />
                            ) : (
                              <p className="text-sm text-white/70 mt-1.5">{formData.lastName || <span className="italic text-white/55">Not set</span>}</p>
                            )}
                          </div>
                        </div>

                        <div className="space-y-3">
                          {/* EMAIL IS READ-ONLY HERE (2026-09-04).
                              This rendered an editable Input in edit mode, and
                              the value went nowhere. The save handler builds
                              updateData from firstName/lastName/phone/location/
                              bio only, and PUT /api/account/profile filters the
                              body against an allowedFields list that has no
                              'email' in it either. So a user could retype their
                              address, press Save, get the success toast, and
                              watch it revert on the next load. That bites
                              OAuth users hardest: their account email is
                              whatever the provider handed over, so they are the
                              ones who go looking for this field.
                              Showing the truth beats accepting keystrokes and
                              discarding them. ProfileSetup.tsx already says the
                              same thing ("Email is set from your account").
                              Making it genuinely editable is a real change, not
                              a hotfix: supabase.auth.updateUser({ email }) sends
                              a confirmation to BOTH addresses and the account
                              keeps the old one until the new one is confirmed. */}
                          <div className="flex items-center gap-2 text-sm">
                            <Mail className="h-4 w-4 text-pastel-orange shrink-0" />
                            <span className="text-white/70">{formData.email || <span className="italic text-white/55">Not set</span>}</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <Phone className="h-4 w-4 text-pastel-orange shrink-0" />
                            {isEditing ? (
                              <Input
                                value={formData.phone}
                                onChange={(e) => handleInputChange('phone', e.target.value)}
                                className="h-8 bg-white/5 border-white/10 text-pastel-cream placeholder:text-white/55 focus-visible:ring-pastel-orange/40"
                              />
                            ) : (
                              <span className="text-white/70">{formData.phone || <span className="italic text-white/55">Not set</span>}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <MapPin className="h-4 w-4 text-pastel-orange shrink-0" />
                            {isEditing ? (
                              <Input
                                value={formData.location}
                                onChange={(e) => handleInputChange('location', e.target.value)}
                                className="h-8 bg-white/5 border-white/10 text-pastel-cream placeholder:text-white/55 focus-visible:ring-pastel-orange/40"
                              />
                            ) : (
                              <span className="text-white/70">{formData.location || <span className="italic text-white/55">Not set</span>}</span>
                            )}
                          </div>
                        </div>

                        <Separator className="bg-white/10" />

                        <div>
                          <Label htmlFor="bio" className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-pastel-orange-soft font-bold">Bio</Label>
                          {isEditing ? (
                            <Textarea
                              id="bio"
                              value={formData.bio}
                              onChange={(e) => handleInputChange('bio', e.target.value)}
                              className="w-full min-h-[80px] mt-1.5 bg-white/5 border-white/10 text-pastel-cream placeholder:text-white/55 focus-visible:ring-pastel-orange/40"
                            />
                          ) : (
                            <p className="text-sm text-white/70 mt-1.5">{formData.bio || <span className="italic text-white/55">Not set</span>}</p>
                          )}
                        </div>

                        {isEditing && (
                          <div className="flex gap-2 pt-4">
                            <Button onClick={handleSave} className="bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft font-bold shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)]">Save Changes</Button>
                            <Button variant="outline" onClick={() => setIsEditing(false)} className="bg-transparent border border-pastel-cream/30 text-pastel-cream hover:bg-white/5 hover:border-pastel-cream/50 font-bold">Cancel</Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    <Card className="animated-element bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 font-calistoga text-pastel-cream">
                          <History className="h-5 w-5 text-pastel-orange" />
                          Recent Activity
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {recentActivity.length > 0 ? (
                          <div className="space-y-2">
                            {recentActivity.map((activity, index) => (
                              <div key={index} className="flex items-start gap-3 p-3 rounded-xl bg-white/5 ring-1 ring-white/10 hover:bg-white/[0.07] transition-colors">
                                <div className="h-2 w-2 rounded-full bg-pastel-orange mt-2 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-bold text-pastel-cream">{activity.action}</p>
                                  {activity.points && (
                                    <p className="text-sm text-pastel-orange font-bold tabular-nums">{activity.points}</p>
                                  )}
                                  <p className="text-xs text-white/55 mt-0.5">{activity.date}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-white/55 text-center py-8">
                            No recent activity. Join a league to get started!
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  {/* Quick Stats Sidebar */}
                  <div className="space-y-6">
                    <Card className="animated-element bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                      <CardHeader>
                        <CardTitle className="font-calistoga text-lg text-pastel-cream">Season Summary</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="text-center p-3 rounded-xl bg-pastel-orange/10 ring-1 ring-pastel-orange/30">
                            <div className="font-calistoga text-2xl text-pastel-orange tabular-nums leading-none">
                              {userStats.currentRank ?? '-'}
                            </div>
                            <div className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-white/55 font-bold mt-1">Current Rank</div>
                          </div>
                          <div className="text-center p-3 rounded-xl bg-pastel-sage/10 ring-1 ring-pastel-sage/30">
                            <div className="font-calistoga text-2xl text-pastel-sage-soft tabular-nums leading-none">{userStats.championships}</div>
                            <div className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-white/55 font-bold mt-1">Championships</div>
                          </div>
                        </div>
                        <Separator className="bg-white/10" />
                        <div className="space-y-3">
                          <div className="flex justify-between text-sm">
                            <span className="text-white/55">Total Seasons</span>
                            <span className="font-bold text-pastel-cream tabular-nums">{userStats.totalSeasons}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-white/55">Playoff Apps</span>
                            <span className="font-bold text-pastel-cream tabular-nums">{userStats.playoffAppearances}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-white/55">Overall Record</span>
                            <span className="font-bold text-pastel-cream tabular-nums">{userStats.overallRecord}</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="animated-element bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                      <CardHeader>
                        <CardTitle className="font-calistoga text-lg text-pastel-cream">Team Info</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div>
                          <Label className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-pastel-orange-soft font-bold">Fantasy Team</Label>
                          <p className="font-bold text-pastel-cream mt-1">{formData.teamName || 'No team yet'}</p>
                        </div>
                        {formData.favoriteTeam && (
                          <div>
                            <Label className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-pastel-orange-soft font-bold">Favorite NHL Team</Label>
                            <p className="font-bold text-pastel-cream mt-1">{formData.favoriteTeam || <span className="italic text-white/55">Not set</span>}</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="stats" className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Card className="animated-element bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                    <CardContent className="p-6 text-center">
                      <Calendar className="h-8 w-8 mx-auto mb-2 text-amber-300" />
                      <div className="font-calistoga text-3xl text-pastel-cream tabular-nums leading-none">{userStats.totalSeasons}</div>
                      <div className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-white/55 font-bold mt-1.5">Leagues</div>
                    </CardContent>
                  </Card>
                  <Card className="animated-element bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                    <CardContent className="p-6 text-center">
                      <Target className="h-8 w-8 mx-auto mb-2 text-pastel-sage-soft" />
                      <div className="font-calistoga text-3xl text-pastel-cream tabular-nums leading-none">{userStats.overallRecord}</div>
                      <div className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-white/55 font-bold mt-1.5">W-L Record</div>
                    </CardContent>
                  </Card>
                  <Card className="animated-element bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                    <CardContent className="p-6 text-center">
                      <TrendingUp className="h-8 w-8 mx-auto mb-2 text-pastel-sage-soft" />
                      <div className="font-calistoga text-3xl text-pastel-cream tabular-nums leading-none">{userStats.totalPoints.toLocaleString()}</div>
                      <div className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-white/55 font-bold mt-1.5">Total Points</div>
                    </CardContent>
                  </Card>
                  <Card className="animated-element bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                    <CardContent className="p-6 text-center">
                      <Medal className="h-8 w-8 mx-auto mb-2 text-pastel-orange" />
                      <div className="font-calistoga text-3xl text-pastel-cream tabular-nums leading-none">{userStats.avgPointsPerGame || '-'}</div>
                      <div className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-white/55 font-bold mt-1.5">Avg Pts/Week</div>
                    </CardContent>
                  </Card>
                </div>

                <Card className="animated-element bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                  <CardHeader>
                    <CardTitle className="font-calistoga text-xl text-pastel-cream">Performance History</CardTitle>
                    <CardDescription className="text-white/55">Your matchup results across all leagues</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {userStats.statsLoaded && userStats.totalSeasons > 0 ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-3 gap-3 text-center">
                          <div className="p-4 rounded-xl bg-pastel-sage/15 ring-1 ring-pastel-sage/30">
                            <div className="font-calistoga text-2xl text-pastel-sage-soft tabular-nums leading-none">{userStats.wins}</div>
                            <div className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-white/55 font-bold mt-1.5">Wins</div>
                          </div>
                          <div className="p-4 rounded-xl bg-red-400/15 ring-1 ring-red-400/30">
                            <div className="font-calistoga text-2xl text-red-300 tabular-nums leading-none">{userStats.losses}</div>
                            <div className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-white/55 font-bold mt-1.5">Losses</div>
                          </div>
                          <div className="p-4 rounded-xl bg-white/5 ring-1 ring-white/10">
                            <div className="font-calistoga text-2xl text-white/70 tabular-nums leading-none">{userStats.ties}</div>
                            <div className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-white/55 font-bold mt-1.5">Ties</div>
                          </div>
                        </div>
                        {(userStats.wins + userStats.losses + userStats.ties) > 0 && (
                          <div className="flex items-center gap-2 pt-2">
                            <div className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-white/55 font-bold">Win Rate</div>
                            <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                              <div
                                className="h-full bg-pastel-sage rounded-full transition-all"
                                style={{ width: `${Math.round((userStats.wins / (userStats.wins + userStats.losses + userStats.ties)) * 100)}%` }}
                              />
                            </div>
                            <div className="text-xs font-bold text-pastel-cream tabular-nums">
                              {Math.round((userStats.wins / (userStats.wins + userStats.losses + userStats.ties)) * 100)}%
                            </div>
                          </div>
                        )}
                      </div>
                    ) : userStats.statsLoaded ? (
                      <div className="text-center py-12">
                        <TrendingUp className="h-12 w-12 mx-auto mb-4 text-pastel-orange/30" />
                        <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-2">✦ Empty</div>
                        <h3 className="font-calistoga text-xl text-pastel-cream mb-2">No Performance History</h3>
                        <p className="text-sm text-white/55 mb-4">
                          {userLeagueState === 'active-user'
                            ? 'Complete a matchup week to see your performance history here.'
                            : 'Join a league and complete a season to see your performance history here.'}
                        </p>
                        {userLeagueState !== 'active-user' && (
                          <Button asChild className="bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft font-bold shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)]">
                            <Link to="/create-league">Create or Join a League</Link>
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-8">
                        <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin text-pastel-orange/60" />
                        <p className="text-sm text-white/55">Loading stats…</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="achievements" className="space-y-6">
                {achievements.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {achievements.map((achievement, index) => (
                      <Card key={index} className="animated-element bg-[#1A2A20] border-0 ring-1 ring-white/10 hover:ring-pastel-orange/30 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] hover:shadow-[0_24px_60px_-16px_rgba(255,168,87,0.2)] transition-all">
                        <CardContent className="p-6">
                          <div className="flex items-start gap-4">
                            <div className="p-3 rounded-xl bg-pastel-orange/15 ring-1 ring-pastel-orange/30 shrink-0">
                              <achievement.icon className={`h-6 w-6 ${achievement.color}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="font-calistoga text-lg text-pastel-cream mb-1">{achievement.title}</h3>
                              {achievement.description && (
                                <p className="text-sm text-white/55 mb-2 leading-relaxed">{achievement.description}</p>
                              )}
                              {achievement.year && (
                                <Badge variant="secondary" className="text-[10px] font-jbmono uppercase tracking-[0.18em] font-bold bg-white/5 ring-1 ring-white/10 text-white/70 hover:bg-white/10 border-0">{achievement.year}</Badge>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <Card className="bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                    <CardContent className="p-12 text-center">
                      <Trophy className="h-12 w-12 mx-auto mb-4 text-pastel-orange/30" />
                      <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-2">✦ Empty</div>
                      <h3 className="font-calistoga text-xl text-pastel-cream mb-2">No Achievements Yet</h3>
                      <p className="text-sm text-white/55 mb-4">
                        {userLeagueState === 'active-user'
                          ? 'Keep competing to earn achievements!'
                          : 'Join a league and start competing to earn achievements!'}
                      </p>
                      {userLeagueState !== 'active-user' && (
                        <Button asChild className="bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft font-bold shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)]">
                          <Link to="/create-league">Create or Join a League</Link>
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="settings" className="space-y-6">
                {settingsMessage && (
                  <div className={`p-3 rounded-xl text-sm ring-1 ${settingsMessage.type === 'success' ? 'bg-pastel-sage/15 ring-pastel-sage/40 text-pastel-sage-soft' : 'bg-red-400/15 ring-red-400/40 text-red-300'}`}>
                    {settingsMessage.text}
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Display Name & Account Info */}
                  <Card className="animated-element lg:col-span-2 bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 font-calistoga text-pastel-cream">
                        <User className="h-5 w-5 text-pastel-orange" />
                        Account Information
                      </CardTitle>
                      <CardDescription className="text-white/55">Your identity and account details</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="settings-display-name" className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-pastel-orange-soft font-bold">Display Name</Label>
                            <div className="flex gap-2">
                              <Input
                                id="settings-display-name"
                                value={displayNameInput}
                                onChange={(e) => setDisplayNameInput(e.target.value)}
                                placeholder="Choose a display name"
                                className="bg-white/5 border-white/10 text-pastel-cream placeholder:text-white/55 focus-visible:ring-pastel-orange/40"
                              />
                              <Button
                                onClick={handleSaveDisplayName}
                                disabled={savingDisplayName || displayNameInput.trim() === (profile?.display_name || '')}
                                size="sm"
                                className="shrink-0 bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft font-bold disabled:opacity-50"
                              >
                                {savingDisplayName ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                              </Button>
                            </div>
                            <p className="text-xs text-white/55">This is the name shown to other users across the platform.</p>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-pastel-orange-soft font-bold">Email Address</Label>
                            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-white/5 ring-1 ring-white/10 text-sm">
                              <Mail className="h-4 w-4 text-pastel-orange shrink-0" />
                              <span className="text-white/70 truncate">{user?.email}</span>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label className="flex items-center gap-2 text-[10px] font-jbmono uppercase tracking-[0.22em] text-pastel-orange-soft font-bold">
                              <Moon className="h-3.5 w-3.5" />
                              Appearance
                            </Label>
                            <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-white/5 ring-1 ring-white/10">
                              <Moon className="h-4 w-4 text-pastel-orange shrink-0" />
                              <div className="min-w-0">
                                <div className="text-sm font-bold text-pastel-cream">Citrus Dark</div>
                                <div className="text-xs text-white/55">Rink-side dark, tuned for the whole app. One look, no surprises.</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Change Password */}
                  <Card className="animated-element bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 font-calistoga text-pastel-cream">
                        <Lock className="h-5 w-5 text-pastel-orange" />
                        Change Password
                      </CardTitle>
                      <CardDescription className="text-white/55">Update your account password</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <form onSubmit={handleChangePasswordReal} className="space-y-4">
                        {hasPassword ? (
                          <div className="space-y-2">
                            <Label htmlFor="settings-currentPassword" className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-pastel-orange-soft font-bold">Current Password</Label>
                            <Input
                              id="settings-currentPassword"
                              type="password"
                              autoComplete="current-password"
                              placeholder="Your current password"
                              value={currentPassword}
                              onChange={(e) => setCurrentPassword(e.target.value)}
                              disabled={changePasswordLoading}
                              className="bg-white/5 border-white/10 text-pastel-cream placeholder:text-white/55 focus-visible:ring-pastel-orange/40 disabled:opacity-50"
                            />
                          </div>
                        ) : (
                          <p className="text-sm text-white/65">
                            You sign in with {signInProviders.map((p) => p === 'google' ? 'Google' : p === 'apple' ? 'Apple' : p).join(' and ') || 'a linked account'}. Setting a password here adds email sign-in to this account.
                          </p>
                        )}
                        <div className="space-y-2">
                          <Label htmlFor="settings-newPassword" className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-pastel-orange-soft font-bold">New Password</Label>
                          <Input
                            id="settings-newPassword"
                            type="password"
                            placeholder="Min 8 characters"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            disabled={changePasswordLoading}
                            className="bg-white/5 border-white/10 text-pastel-cream placeholder:text-white/55 focus-visible:ring-pastel-orange/40 disabled:opacity-50"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="settings-confirmPassword" className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-pastel-orange-soft font-bold">Confirm New Password</Label>
                          <Input
                            id="settings-confirmPassword"
                            type="password"
                            placeholder="Confirm new password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            disabled={changePasswordLoading}
                            className="bg-white/5 border-white/10 text-pastel-cream placeholder:text-white/55 focus-visible:ring-pastel-orange/40 disabled:opacity-50"
                          />
                        </div>
                        <Button
                          type="submit"
                          disabled={changePasswordLoading || !newPassword || !confirmPassword || (hasPassword && !currentPassword)}
                          className="w-full bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft font-bold shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)] disabled:opacity-50"
                        >
                          {changePasswordLoading ? (
                            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Updating…</>
                          ) : (
                            'Update Password'
                          )}
                        </Button>
                        <button
                          type="button"
                          onClick={() => void handleSendResetLink()}
                          disabled={sendingReset}
                          className="w-full text-center text-sm text-pastel-orange-soft hover:text-pastel-orange underline-offset-4 hover:underline disabled:opacity-50"
                        >
                          {sendingReset ? 'Sending…' : 'Forgot it? Email me a reset link'}
                        </button>
                      </form>
                    </CardContent>
                  </Card>

                  {/* Team Settings */}
                  <Card className="animated-element bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 font-calistoga text-pastel-cream">
                        <Shield className="h-5 w-5 text-pastel-orange" />
                        Team Settings
                      </CardTitle>
                      <CardDescription className="text-white/55">Customize your team identity</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="team-name" className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-pastel-orange-soft font-bold">Team Name</Label>
                        <Input
                          id="team-name"
                          value={formData.teamName}
                          onChange={(e) => handleInputChange('teamName', e.target.value)}
                          className="bg-white/5 border-white/10 text-pastel-cream placeholder:text-white/55 focus-visible:ring-pastel-orange/40"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="team-abbr" className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-pastel-orange-soft font-bold">Abbreviation (3-4 chars)</Label>
                        <Input
                          id="team-abbr"
                          value={formData.teamAbbr}
                          maxLength={4}
                          onChange={(e) => handleInputChange('teamAbbr', e.target.value)}
                          className="bg-white/5 border-white/10 text-pastel-cream placeholder:text-white/55 focus-visible:ring-pastel-orange/40"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="team-desc" className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-pastel-orange-soft font-bold">Team Slogan/Bio</Label>
                        <Textarea
                          id="team-desc"
                          value={formData.teamDescription}
                          onChange={(e) => handleInputChange('teamDescription', e.target.value)}
                          className="min-h-[80px] bg-white/5 border-white/10 text-pastel-cream placeholder:text-white/55 focus-visible:ring-pastel-orange/40"
                        />
                      </div>
                      <Button onClick={handleSaveTeamName} className="bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft font-bold shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)]">Save Team Details</Button>
                    </CardContent>
                  </Card>

                  {/* League Reset (Commissioner Only) */}
                  {commissionerLeagues.length > 0 && (
                    <Card className="animated-element bg-[#1A2A20] border-0 ring-1 ring-red-400/30 rounded-2xl shadow-[0_16px_40px_-12px_rgba(248,113,113,0.15)]">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 font-calistoga text-red-300">
                          <RotateCcw className="h-5 w-5" />
                          League Draft Reset
                        </CardTitle>
                        <CardDescription className="text-white/55">
                          Reset draft data for leagues you commission. This permanently deletes all draft picks and orders.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {loadingLeagues ? (
                          <p className="text-sm text-white/55">Loading leagues…</p>
                        ) : (
                          <div className="space-y-2">
                            {commissionerLeagues.map((league) => (
                              <div
                                key={league.id}
                                className="flex items-center justify-between p-3 ring-1 ring-white/10 rounded-xl bg-white/5"
                              >
                                <div className="flex-1 min-w-0">
                                  <p className="font-bold text-pastel-cream truncate">{league.name}</p>
                                  <p className="text-xs text-white/55 mt-0.5">
                                    Status: <span className="capitalize text-white/70">{league.draft_status.replace('_', ' ')}</span>
                                  </p>
                                </div>
                                <Button
                                  size="sm"
                                  onClick={() => handleResetLeagueDraft(league.id, league.name)}
                                  disabled={league.draft_status === 'not_started'}
                                  className="bg-red-400/20 ring-1 ring-red-400/40 text-red-300 hover:bg-red-400/30 font-bold disabled:opacity-40 shrink-0"
                                >
                                  <RotateCcw className="h-4 w-4 mr-2" />
                                  Reset Draft
                                </Button>
                              </div>
                            ))}
                            {commissionerLeagues.length === 0 && (
                              <p className="text-sm text-white/55 text-center py-4">
                                You are not a commissioner of any leagues.
                              </p>
                            )}
                          </div>
                        )}
                        {/* A standing note about an action nobody has taken
                            yet, so it wears the confirmation treatment, not
                            the error one. See components/confirm. */}
                        <DestructiveConsequence className="text-xs">
                          Resetting a draft permanently deletes all draft picks and draft order data, and it cannot be undone.
                          Only reset if you need to start the draft completely fresh.
                        </DestructiveConsequence>
                      </CardContent>
                    </Card>
                  )}

                  {/* Commissioner League Settings — Full Settings Panel */}
                  {commissionerLeagues.length > 0 && (
                    <Card className="animated-element lg:col-span-2 bg-[#1A2A20] border-0 ring-1 ring-pastel-orange/30 rounded-2xl shadow-[0_16px_40px_-12px_rgba(255,168,87,0.15)]">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 font-calistoga text-pastel-cream">
                          <Crown className="h-5 w-5 text-pastel-orange" />
                          Commissioner League Settings
                        </CardTitle>
                        <CardDescription className="text-white/55">
                          Configure waivers, scoring, draft, and rosters for leagues you commission. Changes will notify all league members.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-6">
                        {/* League Selector */}
                        <div className="space-y-2">
                          <Label className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-pastel-orange-soft font-bold">Select League</Label>
                          <Select
                            value={selectedSettingsLeagueId || ''}
                            onValueChange={(value) => setSelectedSettingsLeagueId(value)}
                          >
                            <SelectTrigger className="bg-white/5 border-white/10 text-pastel-cream focus:ring-pastel-orange/40">
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
                            <Loader2 className="h-6 w-6 animate-spin mx-auto text-pastel-orange/60" />
                            <p className="text-sm text-white/55 mt-2">Loading league settings…</p>
                          </div>
                        ) : selectedSettingsLeagueId && selectedLeagueData ? (
                          <Tabs value={commSettingsTab} onValueChange={setCommSettingsTab} className="w-full">
                            <TabsList className="grid w-full grid-cols-4 bg-[#0F1F15] ring-1 ring-white/10 p-1 rounded-xl">
                              <TabsTrigger value="waivers" className="px-1.5 sm:px-3 text-xs sm:text-sm text-white/55 hover:text-pastel-cream font-bold data-[state=active]:bg-pastel-orange data-[state=active]:text-[#581E00] data-[state=active]:shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)]">Waivers</TabsTrigger>
                              <TabsTrigger value="scoring" className="px-1.5 sm:px-3 text-xs sm:text-sm text-white/55 hover:text-pastel-cream font-bold data-[state=active]:bg-pastel-orange data-[state=active]:text-[#581E00] data-[state=active]:shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)]">Scoring</TabsTrigger>
                              <TabsTrigger value="draft" className="px-1.5 sm:px-3 text-xs sm:text-sm text-white/55 hover:text-pastel-cream font-bold data-[state=active]:bg-pastel-orange data-[state=active]:text-[#581E00] data-[state=active]:shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)]">Draft</TabsTrigger>
                              <TabsTrigger value="rosters" className="px-1.5 sm:px-3 text-xs sm:text-sm text-white/55 hover:text-pastel-cream font-bold data-[state=active]:bg-pastel-orange data-[state=active]:text-[#581E00] data-[state=active]:shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)]">Rosters</TabsTrigger>
                            </TabsList>

                            {/* Waiver Settings Tab */}
                            <TabsContent value="waivers" className="space-y-6 py-4">
                              <div className="space-y-2">
                                <Label className="flex items-center gap-2 text-[10px] font-jbmono uppercase tracking-[0.22em] text-pastel-orange-soft font-bold">
                                  <Clock className="h-3.5 w-3.5" />
                                  Waiver Process Time (MT)
                                </Label>
                                <Select
                                  value={commWaiverSettings.waiver_process_time}
                                  onValueChange={(value) => setCommWaiverSettings(prev => ({ ...prev, waiver_process_time: value }))}
                                >
                                  <SelectTrigger className="bg-white/5 border-white/10 text-pastel-cream focus:ring-pastel-orange/40">
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
                                <p className="text-xs text-white/55">Time when waiver claims are processed daily (Mountain Time)</p>
                              </div>

                              <div className="space-y-2">
                                <Label className="flex items-center gap-2 text-[10px] font-jbmono uppercase tracking-[0.22em] text-pastel-orange-soft font-bold">
                                  <RefreshCw className="h-3.5 w-3.5" />
                                  Waiver Period (Hours)
                                </Label>
                                <Select
                                  value={commWaiverSettings.waiver_period_hours.toString()}
                                  onValueChange={(value) => setCommWaiverSettings(prev => ({ ...prev, waiver_period_hours: parseInt(value) }))}
                                >
                                  <SelectTrigger className="bg-white/5 border-white/10 text-pastel-cream focus:ring-pastel-orange/40">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="24">24 hours (1 day)</SelectItem>
                                    <SelectItem value="48">48 hours (2 days)</SelectItem>
                                    <SelectItem value="72">72 hours (3 days)</SelectItem>
                                  </SelectContent>
                                </Select>
                                <p className="text-xs text-white/55">How long dropped players stay on waivers</p>
                              </div>

                              <div className="space-y-2">
                                <Label className="flex items-center gap-2 text-[10px] font-jbmono uppercase tracking-[0.22em] text-pastel-orange-soft font-bold">
                                  <Trophy className="h-3.5 w-3.5" />
                                  Waiver Type
                                </Label>
                                <Select
                                  value={commWaiverSettings.waiver_type}
                                  onValueChange={(value: 'rolling' | 'reverse_draft_order' | 'faab' | 'reverse_standings') => setCommWaiverSettings(prev => ({ ...prev, waiver_type: value }))}
                                >
                                  <SelectTrigger className="bg-white/5 border-white/10 text-pastel-cream focus:ring-pastel-orange/40">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="rolling">Rolling Priority (Join Order)</SelectItem>
                                    <SelectItem value="reverse_draft_order">Rolling Priority (Reverse Draft Order)</SelectItem>
                                    <SelectItem value="reverse_standings">Reverse Standings</SelectItem>
                                    <SelectItem value="faab">FAAB (Bidding)</SelectItem>
                                  </SelectContent>
                                </Select>
                                <p className="text-xs text-white/55">Join Order: seeded by when teams joined. Reverse Draft Order: the last round-one pick holds waiver 1. Both roll. The claimant drops to the back. Reverse Standings: recomputed weekly, worst record first.</p>
                              </div>

                              <div className="flex items-center justify-between p-3 bg-white/5 ring-1 ring-white/10 rounded-xl">
                                <div className="space-y-0.5">
                                  <Label className="flex items-center gap-2 text-sm font-bold text-pastel-cream">
                                    <Shield className="h-4 w-4 text-pastel-orange" />
                                    Game Lock
                                  </Label>
                                  <p className="text-xs text-white/55">Lock players during/after their games</p>
                                </div>
                                <Switch
                                  checked={commWaiverSettings.waiver_game_lock}
                                  onCheckedChange={(checked) => setCommWaiverSettings(prev => ({ ...prev, waiver_game_lock: checked }))}
                                />
                              </div>

                              <div className="flex items-center justify-between p-3 bg-white/5 ring-1 ring-white/10 rounded-xl">
                                <div className="space-y-0.5">
                                  <Label className="flex items-center gap-2 text-sm font-bold text-pastel-cream">
                                    <RefreshCw className="h-4 w-4 text-pastel-orange" />
                                    Allow Trades During Games
                                  </Label>
                                  <p className="text-xs text-white/55">Players can be traded even if game-locked</p>
                                </div>
                                <Switch
                                  checked={commWaiverSettings.allow_trades_during_games}
                                  onCheckedChange={(checked) => setCommWaiverSettings(prev => ({ ...prev, allow_trades_during_games: checked }))}
                                />
                              </div>

                              {/* Manual Waiver Processing & Sync Rosters */}
                              <div className="border-t border-white/10 pt-4 mt-4 space-y-3">
                                <div className="flex items-center justify-between p-3 bg-white/5 ring-1 ring-white/10 rounded-xl">
                                  <div className="space-y-0.5">
                                    <Label className="flex items-center gap-2 text-sm font-bold text-pastel-cream">
                                      <Play className="h-4 w-4 text-pastel-orange" />
                                      Process Waivers Now
                                    </Label>
                                    <p className="text-xs text-white/55">Manually process all pending waiver claims</p>
                                  </div>
                                  <Button
                                    size="sm"
                                    onClick={handleCommProcessWaivers}
                                    disabled={processingWaivers}
                                    className="bg-pastel-orange/20 ring-1 ring-pastel-orange/40 text-pastel-orange-soft hover:bg-pastel-orange/30 font-bold disabled:opacity-50 shrink-0"
                                  >
                                    {processingWaivers ? (
                                      <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Processing…
                                      </>
                                    ) : (
                                      <>
                                        <RefreshCw className="mr-2 h-4 w-4" />
                                        Process Now
                                      </>
                                    )}
                                  </Button>
                                </div>

                                <div className="flex items-center justify-between p-3 bg-white/5 ring-1 ring-white/10 rounded-xl">
                                  <div className="space-y-0.5">
                                    <Label className="flex items-center gap-2 text-sm font-bold text-pastel-cream">
                                      <RefreshCw className="h-4 w-4 text-pastel-orange" />
                                      Sync Rosters from Draft
                                    </Label>
                                    <p className="text-xs text-white/55">Rebuild team rosters from the completed draft results (safety net)</p>
                                  </div>
                                  <Button
                                    size="sm"
                                    onClick={handleCommSyncRosters}
                                    disabled={syncingRosters}
                                    className="bg-pastel-orange/20 ring-1 ring-pastel-orange/40 text-pastel-orange-soft hover:bg-pastel-orange/30 font-bold disabled:opacity-50 shrink-0"
                                  >
                                    {syncingRosters ? (
                                      <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Syncing…
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
                              <div className="space-y-6">
                                <div>
                                  <h3 className="font-calistoga text-lg text-pastel-cream mb-3">Skater Scoring</h3>
                                  <div className="grid grid-cols-2 gap-4">
                                    {COMMISSIONER_SCORING_FIELDS.skater.map(stat => (
                                      <div key={stat.key} className="space-y-2">
                                        <Label className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-pastel-orange-soft font-bold">{stat.label}</Label>
                                        <Input
                                          type="number"
                                          step="0.1"
                                          value={commScoringSettings.skater?.[stat.key] ?? stat.default}
                                          onChange={(e) => setCommScoringSettings(prev => ({
                                            ...prev,
                                            skater: { ...prev.skater, [stat.key]: parseFloat(e.target.value) || 0 }
                                          }))}
                                          className="bg-white/5 border-white/10 text-pastel-cream placeholder:text-white/55 focus-visible:ring-pastel-orange/40 tabular-nums"
                                        />
                                      </div>
                                    ))}
                                  </div>
                                </div>

                                <div>
                                  <h3 className="font-calistoga text-lg text-pastel-cream mb-3">Goalie Scoring</h3>
                                  <div className="grid grid-cols-2 gap-4">
                                    {COMMISSIONER_SCORING_FIELDS.goalie.map(stat => (
                                      <div key={stat.key} className="space-y-2">
                                        <Label className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-pastel-orange-soft font-bold">{stat.label}</Label>
                                        <Input
                                          type="number"
                                          step="0.1"
                                          value={commScoringSettings.goalie?.[stat.key] ?? stat.default}
                                          onChange={(e) => setCommScoringSettings(prev => ({
                                            ...prev,
                                            goalie: { ...prev.goalie, [stat.key]: parseFloat(e.target.value) || 0 }
                                          }))}
                                          className="bg-white/5 border-white/10 text-pastel-cream placeholder:text-white/55 focus-visible:ring-pastel-orange/40 tabular-nums"
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
                                  <Label className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-pastel-orange-soft font-bold">Draft Rounds</Label>
                                  <Input
                                    type="number"
                                    value={commDraftSettings.draft_rounds}
                                    onChange={(e) => setCommDraftSettings(prev => ({
                                      ...prev,
                                      draft_rounds: parseInt(e.target.value) || 21
                                    }))}
                                    disabled={selectedLeagueData?.draft_status === 'completed'}
                                    className="bg-white/5 border-white/10 text-pastel-cream placeholder:text-white/55 focus-visible:ring-pastel-orange/40 tabular-nums disabled:opacity-50"
                                  />
                                  {selectedLeagueData?.draft_status === 'completed' && (
                                    <p className="text-xs text-white/55">Draft is completed: rounds cannot be changed</p>
                                  )}
                                </div>
                                <div className="space-y-2">
                                  <Label className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-pastel-orange-soft font-bold">Pick Time Limit (seconds)</Label>
                                  <Input
                                    type="number"
                                    value={commDraftSettings.pickTimeLimit}
                                    onChange={(e) => setCommDraftSettings(prev => ({
                                      ...prev,
                                      pickTimeLimit: parseInt(e.target.value) || 90
                                    }))}
                                    disabled={selectedLeagueData?.draft_status === 'completed'}
                                    className="bg-white/5 border-white/10 text-pastel-cream placeholder:text-white/55 focus-visible:ring-pastel-orange/40 tabular-nums disabled:opacity-50"
                                  />
                                  {selectedLeagueData?.draft_status === 'completed' && (
                                    <p className="text-xs text-white/55">Draft is completed: time limit cannot be changed</p>
                                  )}
                                </div>
                              </div>
                            </TabsContent>

                            {/* Roster Overview Tab */}
                            <TabsContent value="rosters" className="space-y-6 py-4">
                              <div className="space-y-4">
                                <h3 className="font-calistoga text-lg text-pastel-cream">Team Rosters</h3>
                                {loadingRosterCounts ? (
                                  <div className="text-center py-4">
                                    <Loader2 className="h-4 w-4 animate-spin mx-auto text-pastel-orange/60" />
                                    <p className="text-sm text-white/55 mt-2">Loading roster counts…</p>
                                  </div>
                                ) : (
                                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                                    {selectedLeagueTeams.map((team) => (
                                      <div key={team.id} className="flex items-center justify-between p-3 ring-1 ring-white/10 bg-white/5 rounded-xl">
                                        <div className="min-w-0">
                                          <div className="font-bold text-pastel-cream truncate">{team.team_name}</div>
                                          <div className="text-xs text-white/55 mt-0.5 tabular-nums">
                                            {commRosterCounts[team.id] ?? 0} players
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                    {selectedLeagueTeams.length === 0 && (
                                      <p className="text-sm text-white/55 text-center py-4">No teams in this league yet.</p>
                                    )}
                                  </div>
                                )}
                              </div>
                            </TabsContent>
                          </Tabs>
                        ) : (
                          <p className="text-sm text-white/55 text-center py-4">Select a league above to configure its settings.</p>
                        )}

                        {/* Save Button */}
                        {selectedSettingsLeagueId && selectedLeagueData && commSettingsTab !== 'rosters' && (
                          <div className="flex justify-end gap-2 border-t border-white/10 pt-4">
                            <Button onClick={handleSaveCommSettings} disabled={savingCommSettings} className="bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft font-bold shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)] disabled:opacity-50">
                              {savingCommSettings ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  Saving…
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
                  <Card className="animated-element bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 font-calistoga text-pastel-cream">
                        <Settings className="h-5 w-5 text-pastel-orange" />
                        Game Preferences
                      </CardTitle>
                      <CardDescription className="text-white/55">The alerts the app sends</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {/* One switch, because the app sends one push: the draft
                          engine's "You're on the clock". The email switch that
                          stood beside it had no sender behind it. */}
                      <div className="flex items-center justify-between p-3 bg-white/5 ring-1 ring-white/10 rounded-xl">
                        <div className="space-y-0.5">
                          <Label className="text-sm font-bold text-pastel-cream">On-the-clock push</Label>
                          <p className="text-xs text-white/55">
                            A push the moment a draft pick is yours. iOS app only.
                          </p>
                        </div>
                        <Switch
                          checked={pushEnabled}
                          disabled={updateProfile.isPending}
                          onCheckedChange={(c) => void handlePushToggle(c)}
                        />
                      </div>
                    </CardContent>
                  </Card>

                  {/* Legal & Privacy */}
                  <Card className="animated-element bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 font-calistoga text-pastel-cream">
                        <FileText className="h-5 w-5 text-pastel-orange" />
                        Legal & Privacy
                      </CardTitle>
                      <CardDescription className="text-white/55">Review our policies and terms</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <a
                        href="/privacy-policy.html"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between p-3 rounded-xl bg-white/5 ring-1 ring-white/10 hover:bg-white/[0.07] hover:ring-pastel-orange/30 transition-all group"
                      >
                        <span className="font-bold text-pastel-cream group-hover:text-pastel-orange">Privacy Policy</span>
                        <ExternalLink className="h-4 w-4 text-white/55 group-hover:text-pastel-orange" />
                      </a>
                      <a
                        href="/terms-of-service.html"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between p-3 rounded-xl bg-white/5 ring-1 ring-white/10 hover:bg-white/[0.07] hover:ring-pastel-orange/30 transition-all group"
                      >
                        <span className="font-bold text-pastel-cream group-hover:text-pastel-orange">Terms of Service</span>
                        <ExternalLink className="h-4 w-4 text-white/55 group-hover:text-pastel-orange" />
                      </a>
                    </CardContent>
                  </Card>

                  {/* Data Export */}
                  <Card className="animated-element bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 font-calistoga text-pastel-cream">
                        <Download className="h-5 w-5 text-pastel-orange" />
                        Your Data
                      </CardTitle>
                      <CardDescription className="text-white/55">Export a copy of all your data</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-white/55 mb-4 leading-relaxed">
                        Download a JSON file containing all your account data, including your profile, teams, leagues, transactions, and draft history.
                      </p>
                      <Button variant="outline" onClick={handleExportData} disabled={exportLoading} className="w-full bg-transparent border border-pastel-cream/30 text-pastel-cream hover:bg-white/5 hover:border-pastel-cream/50 font-bold disabled:opacity-50">
                        {exportLoading ? (
                          <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Exporting…</>
                        ) : (
                          <><Download className="mr-2 h-4 w-4" />Export My Data</>
                        )}
                      </Button>
                    </CardContent>
                  </Card>

                  {/* Privacy & Consent */}
                  <Card className="animated-element bg-[#1A2A20] border-0 ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 font-calistoga text-pastel-cream">
                        <ShieldCheck className="h-5 w-5 text-pastel-orange" />
                        Privacy &amp; Consent
                      </CardTitle>
                      <CardDescription className="text-white/55">
                        What you have agreed to, and how to change it
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {consentLoading ? (
                        <div className="flex items-center gap-2 text-sm text-white/55">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading your consent record…
                        </div>
                      ) : consentError ? (
                        <div className="flex items-start gap-2 rounded-xl bg-red-500/10 ring-1 ring-red-400/30 p-3">
                          <ShieldAlert className="h-4 w-4 text-red-300 mt-0.5 shrink-0" />
                          <div className="text-sm">
                            <p className="text-red-200 font-bold">Could not load your consent record</p>
                            <p className="text-white/55 mt-1">{consentError}</p>
                            <Button variant="outline" onClick={loadConsent}
                              className="mt-3 h-8 bg-transparent border border-pastel-cream/30 text-pastel-cream hover:bg-white/5 font-bold">
                              Try again
                            </Button>
                          </div>
                        </div>
                      ) : consentRows.length === 0 ? (
                        <p className="text-sm text-white/55">No policies are currently in force.</p>
                      ) : (
                        consentRows.map((row) => {
                          const view = CONSENT_PRESENTATION[row.status] ?? CONSENT_PRESENTATION.never_given;
                          const busy = consentBusy === row.policy_type;
                          return (
                            <div key={row.policy_type}
                              className="rounded-xl bg-black/20 ring-1 ring-white/10 p-3 flex flex-wrap items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-bold text-pastel-cream">{prettyPolicy(row.policy_type)}</span>
                                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ring-1 ${view.tone}`}>
                                    {view.label}
                                  </span>
                                  <span className="text-[11px] text-white/55">v{row.required_version}</span>
                                </div>
                                <p className="text-xs text-white/55 mt-1">{view.blurb}</p>
                                {row.consented_at && (
                                  <p className="text-[11px] text-white/55 mt-0.5">
                                    Accepted {new Date(row.consented_at).toLocaleDateString()}
                                    {row.consented_version ? ` (v${row.consented_version})` : ''}
                                    {row.withdrawn_at ? ` · withdrawn ${new Date(row.withdrawn_at).toLocaleDateString()}` : ''}
                                  </p>
                                )}
                              </div>
                              {view.action === 'withdraw' ? (
                                <Button variant="outline" disabled={busy}
                                  onClick={() => handleWithdrawConsent(row)}
                                  className="h-8 bg-transparent border border-white/20 text-white/70 hover:bg-white/5 hover:text-pastel-cream font-bold disabled:opacity-50">
                                  {busy ? <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Working…</> : 'Withdraw'}
                                </Button>
                              ) : (
                                <Button disabled={busy}
                                  onClick={() => handleGrantConsent(row)}
                                  className="h-8 bg-pastel-orange text-[#581E00] hover:bg-pastel-orange/90 font-bold disabled:opacity-50">
                                  {busy ? <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Working…</> : 'Accept'}
                                </Button>
                              )}
                            </div>
                          );
                        })
                      )}
                      <p className="text-xs text-white/55 leading-relaxed pt-1">
                        Withdrawing consent keeps both the date you granted it and the date you withdrew it, because
                        the record of when you changed your mind matters as much as the consent itself.
                      </p>
                    </CardContent>
                  </Card>

                  {/* Subscription Plan */}
                  <Card className="animated-element lg:col-span-2 bg-[#1A2A20] border-0 ring-1 ring-pastel-orange/30 rounded-2xl shadow-[0_16px_40px_-12px_rgba(255,168,87,0.15)] relative overflow-hidden">
                    <div aria-hidden="true" className="absolute top-0 right-0 w-64 h-64 bg-pastel-orange/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
                    <CardHeader className="relative z-10">
                      <CardTitle className="flex items-center gap-2 font-calistoga text-pastel-cream">
                        <Crown className="h-5 w-5 text-pastel-orange" />
                        Subscription Plan
                      </CardTitle>
                      <CardDescription className="text-white/55">Manage your membership</CardDescription>
                    </CardHeader>
                    <CardContent className="relative z-10">
                      <div className="bg-pastel-orange/10 rounded-xl p-6 ring-1 ring-pastel-orange/30 flex flex-col md:flex-row items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                          <div className="h-12 w-12 rounded-2xl bg-pastel-orange/20 ring-1 ring-pastel-orange/40 flex items-center justify-center text-pastel-orange shrink-0">
                            <Crown className="h-6 w-6" />
                          </div>
                          <div>
                            <h3 className="font-calistoga text-xl text-pastel-cream flex items-center gap-2 flex-wrap">
                              Free Plan
                              <span className="bg-white/10 ring-1 ring-white/20 text-white/70 text-[10px] font-jbmono uppercase tracking-[0.18em] font-bold px-2 py-0.5 rounded-full">Premium Coming Soon</span>
                            </h3>
                            <p className="text-sm text-white/55 mt-1">All features are free during the beta period</p>
                          </div>
                        </div>
                      </div>

                      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="flex items-start gap-2 text-sm">
                          <Check className="h-4 w-4 text-pastel-orange mt-0.5 shrink-0" />
                          <span className="text-pastel-cream">Advanced Stats <span className="text-xs text-white/55">(Free during Beta)</span></span>
                        </div>
                        <div className="flex items-start gap-2 text-sm">
                          <Check className="h-4 w-4 text-pastel-orange mt-0.5 shrink-0" />
                          <span className="text-pastel-cream">Ad-free Experience <span className="text-xs text-white/55">(Free during Beta)</span></span>
                        </div>
                        <div className="flex items-start gap-2 text-sm">
                          <Check className="h-4 w-4 text-pastel-orange mt-0.5 shrink-0" />
                          <span className="text-pastel-cream">Priority Support <span className="text-xs text-white/55">(Free during Beta)</span></span>
                        </div>
                        <div className="flex items-start gap-2 text-sm">
                          <Check className="h-4 w-4 text-pastel-orange mt-0.5 shrink-0" />
                          <span className="text-pastel-cream">Trade Analyzer <span className="text-xs text-white/55">(Free during Beta)</span></span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Delete Account */}
                  <Card className="animated-element lg:col-span-2 bg-[#1A2A20] border-0 ring-1 ring-red-400/40 rounded-2xl shadow-[0_16px_40px_-12px_rgba(248,113,113,0.2)]">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 font-calistoga text-red-300">
                        <Trash2 className="h-5 w-5" />
                        Delete Account
                      </CardTitle>
                      <CardDescription className="text-red-300/80">
                        Permanently delete your account and all associated data
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* The card around this is the danger zone and keeps
                          its red framing; the panel INSIDE it states what a
                          deletion would cost and is a question, so it wears
                          the confirmation treatment. */}
                      <DestructiveConsequence className="flex-col gap-2 px-4 py-4">
                        <h4 className="font-bold text-pastel-cream mb-2">This action cannot be undone</h4>
                        <ul className="text-sm space-y-1 ml-4 list-disc marker:text-pastel-orange/60 leading-relaxed">
                          <li>Your account and authentication credentials will be permanently deleted</li>
                          <li>All your fantasy teams and league data will be removed</li>
                          <li>If you're a league commissioner, your leagues may be orphaned</li>
                          <li>Your draft history and transactions will be anonymized</li>
                        </ul>
                      </DestructiveConsequence>

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button className="w-full bg-red-400/20 ring-1 ring-red-400/40 text-red-300 hover:bg-red-400/30 font-bold">
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete My Account
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className={`bg-[#1A2A20] border-0 ${CONFIRM_SURFACE_RING} text-pastel-cream`}>
                          <AlertDialogHeader>
                            <AlertDialogTitle className="font-calistoga text-pastel-cream">Are you absolutely sure?</AlertDialogTitle>
                            <AlertDialogDescription className="space-y-4 text-white/70">
                              <p>
                                This will permanently delete your account and all associated data.
                                This action cannot be undone.
                              </p>
                              <div>
                                <Label htmlFor="deleteConfirmation" className="text-sm font-bold text-pastel-cream">
                                  Type <span className="font-bold text-pastel-orange">DELETE</span> to confirm:
                                </Label>
                                <Input
                                  id="deleteConfirmation"
                                  value={deleteConfirmation}
                                  onChange={(e) => setDeleteConfirmation(e.target.value)}
                                  placeholder="DELETE"
                                  className="mt-2 bg-white/5 border-white/10 text-pastel-cream placeholder:text-white/55 focus-visible:ring-red-400/50"
                                />
                              </div>
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel
                              onClick={() => setDeleteConfirmation('')}
                              className="bg-transparent border border-pastel-cream/30 text-pastel-cream hover:bg-white/5 hover:text-pastel-cream hover:border-pastel-cream/50 font-bold"
                            >
                              Cancel
                            </AlertDialogCancel>
                            <AlertDialogAction
                              onClick={handleDeleteAccount}
                              disabled={deleteConfirmation !== 'DELETE' || deleteAccountLoading}
                              className="bg-red-400/20 ring-1 ring-red-400/40 text-red-300 hover:bg-red-400/30 font-bold disabled:opacity-50"
                            >
                              {deleteAccountLoading ? (
                                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Deleting…</>
                              ) : (
                                'Delete Account'
                              )}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </CardContent>
                  </Card>

                  <div className="lg:col-span-2 text-center text-sm text-white/55">
                    <p>Need help? Contact us at <a href="mailto:CitrusFantasySports@Gmail.com" className="text-pastel-orange hover:text-pastel-orange-soft hover:underline">CitrusFantasySports@Gmail.com</a></p>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </main>}
      <HockeyFooter variant="app" />
    </div>
  );
};

export default Profile;
