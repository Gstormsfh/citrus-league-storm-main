import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEFAULT_PICK_TIME_LIMIT_SECONDS } from '@citrus/shared';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { 
  Play, 
  Settings, 
  Users, 
  Clock, 
  Trophy, 
  Crown,
  UserPlus,
  Hourglass,
  Shuffle,
  List,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Edit,
  Trash2,
  TriangleAlert,
  Copy,
  Check,
  Mail,
  Link as LinkIcon,
  Calendar,
  X,
  Share2
} from 'lucide-react';
import { DestructiveConsequence } from '@/components/confirm/DestructiveConsequence';
import { CONFIRM_ICON, CONFIRM_TITLE } from '@/components/confirm/destructiveConfirm';
import { useToast } from '@/hooks/use-toast';
import { buildInviteLink, canSystemShare, emailInvite, shareInvite } from '@/utils/inviteShare';
import { logger } from '@/utils/logger';

interface Team {
  id: string;
  name: string;
  owner: string;
  color: string;
  picks: unknown[];
}

interface DraftSettings {
  rounds: number;
  pickTimeLimit: number;
  draftOrder: 'standard' | 'serpentine' | 'custom';
  scoringFormat: 'standard' | 'points' | 'categories';
  effectiveOrder?: string[]; // The actual team order to use (randomized, custom, or default)
}

interface DraftLobbyProps {
  teams: Team[];
  onStartDraft: (settings: DraftSettings) => void;
  onPrepareDraft?: (settings: DraftSettings) => void; // Optional prepare/queue draft handler
  isCommissioner: boolean;
  hasExistingDraft?: boolean;
  isDraftQueued?: boolean; // Whether draft is queued/ready to start
  currentPick?: number;
  totalPicks?: number;
  onRandomizeOrder?: () => void;
  randomizedOrder?: string[] | null;
  customDraftOrder?: string[] | null; // Custom order from the Custom Order button
  onCustomOrderChange?: (order: string[] | null) => void; // Callback when custom order is saved
  leagueDraftRounds?: number; // League's draft_rounds setting
  leaguePickTimeLimit?: number; // League's saved pickTimeLimit from settings
  onResetDraft?: () => void; // Optional reset draft handler
  onAddAITeams?: () => Promise<void>; // Optional callback to add AI teams
  onDeleteTeam?: (teamId: string) => Promise<void>; // Optional callback to delete a team
  leagueId?: string; // League ID for adding AI teams
  maxTeams?: number; // Maximum teams allowed in league (from settings.teamsCount)
  leagueDraftType?: string; // League's draft type from creation (snake/linear/auction) — single source of truth for draft order
  joinCode?: string; // League join code for inviting managers
  leagueName?: string; // League name for email template
  scheduledDraftTime?: string | null; // Scheduled draft time (ISO string)
  onScheduleDraft?: (scheduledTime: string | null) => void; // Callback to set/clear scheduled draft time
  onTeamsCountChange?: (count: number) => void; // Callback to change max teams (commissioner only)
  /**
   * T7 (2026-08-08 architect Entry 7): true while a Start-Draft
   * sequence is in flight (init + ignition combined). When true,
   * Start-Draft buttons disable to prevent double-fire mid-sequence.
   * Threaded from parent's useStartDraftFull().isPending.
   */
  isStartingDraft?: boolean;
}

export const DraftLobby = ({
  teams,
  onStartDraft,
  onPrepareDraft,
  isCommissioner,
  hasExistingDraft = false,
  isDraftQueued = false,
  currentPick = 0,
  totalPicks = 0,
  isStartingDraft = false,
  onDeleteTeam,
  onRandomizeOrder,
  randomizedOrder,
  customDraftOrder,
  onCustomOrderChange,
  leagueDraftRounds = 21,
  leaguePickTimeLimit,
  onResetDraft,
  onAddAITeams,
  leagueId,
  maxTeams = 12,
  leagueDraftType,
  joinCode,
  leagueName,
  scheduledDraftTime,
  onScheduleDraft,
  onTeamsCountChange
}: DraftLobbyProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [teamToDelete, setTeamToDelete] = useState<Team | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [scheduleDateInput, setScheduleDateInput] = useState('');
  const [scheduleTimeInput, setScheduleTimeInput] = useState('');
  // SETTINGS-UNIFICATION (2026-08-17): every value here INHERITS from the
  // league (set once at creation). 'snake' at creation === 'serpentine'
  // here — same concept, and the lobby now speaks the creation vocabulary.
  const orderFromLeague = leagueDraftType === 'linear' ? 'standard' as const : 'serpentine' as const;
  const [settings, setSettings] = useState<DraftSettings>({
    rounds: leagueDraftRounds, // Use league's draft_rounds setting
    pickTimeLimit: leaguePickTimeLimit || DEFAULT_PICK_TIME_LIMIT_SECONDS, // Use league's saved pickTimeLimit
    draftOrder: orderFromLeague,
    scoringFormat: 'standard'
  });
  // Commissioner-only override disclosure — settings show as a summary by
  // default so nobody is asked the same question twice.
  const [showAdjust, setShowAdjust] = useState(false);
  
  // Custom draft order state (team IDs in order) - for dropdown option
  const [customOrder, setCustomOrder] = useState<string[]>(teams && Array.isArray(teams) ? teams.map(t => t.id) : []);
  
  // Custom order state for the Draft Order section button
  const [showCustomOrderDialog, setShowCustomOrderDialog] = useState(false);
  const [draftOrderCustomOrder, setDraftOrderCustomOrder] = useState<string[]>(
    customDraftOrder && customDraftOrder.length > 0 
      ? customDraftOrder 
      : (teams && Array.isArray(teams) ? teams.map(t => t.id) : [])
  );

  // Sync settings from league data when props change. draftOrder follows
  // the league's draft type unless the commissioner explicitly chose a
  // custom order in this lobby session.
  useEffect(() => {
    setSettings(prev => ({
      ...prev,
      rounds: leagueDraftRounds,
      ...(leaguePickTimeLimit ? { pickTimeLimit: leaguePickTimeLimit } : {}),
      ...(prev.draftOrder !== 'custom' && leagueDraftType
        ? { draftOrder: leagueDraftType === 'linear' ? 'standard' as const : 'serpentine' as const }
        : {})
    }));
  }, [leagueDraftRounds, leaguePickTimeLimit, leagueDraftType]);

  // Initialize custom order when teams change
  useEffect(() => {
    if (teams && Array.isArray(teams) && teams.length > 0 && customOrder.length === 0) {
      setCustomOrder(teams.map(t => t.id));
    }
    // Initialize draftOrderCustomOrder from prop if available, otherwise use default
    if (teams && Array.isArray(teams) && teams.length > 0) {
      const defaultOrder = teams.map(t => t.id);
      if (customDraftOrder && customDraftOrder.length === teams.length) {
        // Use the custom order from parent
        setDraftOrderCustomOrder(customDraftOrder);
      } else if (!customDraftOrder && (!randomizedOrder || draftOrderCustomOrder.length !== teams.length)) {
        // Reset to default only if no custom order and no randomized order
        setDraftOrderCustomOrder(defaultOrder);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- draftOrderCustomOrder.length is a guard condition, not a trigger; setters are stable
  }, [teams, customOrder.length, randomizedOrder, customDraftOrder]);

  // Helper functions for custom order
  const moveTeamUp = (index: number) => {
    if (index === 0) return;
    const newOrder = [...customOrder];
    [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
    setCustomOrder(newOrder);
  };

  const moveTeamDown = (index: number) => {
    if (index === customOrder.length - 1) return;
    const newOrder = [...customOrder];
    [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
    setCustomOrder(newOrder);
  };

  // Helper functions for draft order custom order (used in dialog)
  const moveDraftOrderTeamUp = (index: number) => {
    if (index === 0) return;
    const newOrder = [...draftOrderCustomOrder];
    [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
    setDraftOrderCustomOrder(newOrder);
  };

  const moveDraftOrderTeamDown = (index: number) => {
    if (index === draftOrderCustomOrder.length - 1) return;
    const newOrder = [...draftOrderCustomOrder];
    [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
    setDraftOrderCustomOrder(newOrder);
  };

  const handleSaveCustomDraftOrder = () => {
    // Save the custom order (similar to randomizedOrder - doesn't change settings)
    // Check if it's different from default
    const defaultOrder = teams && Array.isArray(teams) ? teams.map(t => t.id) : [];
    const isModified = JSON.stringify(draftOrderCustomOrder) !== JSON.stringify(defaultOrder);
    
    if (isModified) {
      // Pass the custom order to parent (like randomizedOrder)
      onCustomOrderChange?.(draftOrderCustomOrder);
    } else {
      // If reset to default, clear it
      onCustomOrderChange?.(null);
    }
    
    setShowCustomOrderDialog(false);
    toast({
      title: "Custom order saved",
      description: "The draft order has been updated.",
    });
  };

  const getTeamById = (teamId: string) => teams && Array.isArray(teams) ? teams.find(t => t.id === teamId) : undefined;
  
  // Get the effective draft order to display
  const getEffectiveDraftOrder = () => {
    if (!teams || !Array.isArray(teams) || teams.length === 0) {
      return [];
    }
    // Priority: settings custom order (from dropdown) > customDraftOrder (from button) > randomizedOrder > default
    if (settings.draftOrder === 'custom' && customOrder.length > 0) {
      return customOrder;
    }
    // Check if customDraftOrder exists (from Custom Order button) - takes priority over randomized
    if (customDraftOrder && customDraftOrder.length === teams.length) {
      return customDraftOrder;
    }
    // Check if randomizedOrder exists
    if (randomizedOrder && randomizedOrder.length === teams.length) {
      return randomizedOrder;
    }
    return teams.map(t => t.id);
  };

  const handleDeleteTeam = async () => {
    if (!teamToDelete || !onDeleteTeam) return;

    try {
      await onDeleteTeam(teamToDelete.id);
      toast({
        title: "Team Removed",
        description: `${teamToDelete.name} has been removed from the league.`,
      });
      setTeamToDelete(null);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : (typeof error === 'string' ? error : JSON.stringify(error)) || 'Unknown error';
      logger.error('[DraftLobby] Error deleting team:', error);
      toast({
        title: "Team Didn't Remove",
        description: `Couldn't remove that team: ${errorMessage}`,
        variant: "destructive"
      });
    }
  };

  const handleStartDraft = () => {
    if (!teams || !Array.isArray(teams) || teams.length < 2) {
      toast({
        title: "Not enough teams",
        description: "You need at least 2 teams to start the draft.",
        variant: "destructive"
      });
      return;
    }
    // Include the effective draft order so DraftRoom always has the correct order
    const effectiveOrder = getEffectiveDraftOrder();
    onStartDraft({
      ...settings,
      effectiveOrder: effectiveOrder.length > 0 ? effectiveOrder : undefined
    });
  };

  return (
    <div className="space-y-6 overflow-x-hidden overflow-y-visible">
      {/* Draft Header */}
      <div className="text-center space-y-2 sm:space-y-4">
        <div className="flex items-center justify-center gap-2">
          <Trophy className="h-6 w-6 sm:h-8 sm:w-8 text-primary" aria-hidden="true" />
          <h1 className="text-xl sm:text-3xl font-bold">Draft Lobby</h1>
        </div>
        <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto px-4">
          {hasExistingDraft
            ? `Draft in progress (Pick ${currentPick} of ${totalPicks}). Click "Continue Draft" to rejoin.`
            : isCommissioner
              ? "Configure your draft settings and wait for all managers to join before starting the draft."
              : "Waiting for the league commissioner to start the draft. Review the settings below."}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Draft Settings — appears second on mobile (after controls), first on desktop */}
        <div className="lg:col-span-2 space-y-6 order-2 lg:order-1 min-w-0">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" aria-hidden="true" />
                Draft Settings
                {!isCommissioner && <Badge variant="secondary" className="ml-2">Read Only</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 overflow-x-auto">
              {/* SETTINGS-UNIFICATION (2026-08-17): the summary IS the
                  settings view — every value inherited from league creation.
                  The controls below live behind a commissioner-only
                  "Adjust" disclosure so the lobby never re-asks a question
                  the commissioner already answered. */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 overflow-x-auto">
                <div className="text-center">
                  <div className="text-2xl font-bold text-primary">{teams.length}<span className="text-base text-muted-foreground">/{maxTeams}</span></div>
                  <div className="text-sm text-muted-foreground">Teams</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-primary">{settings.rounds}</div>
                  <div className="text-sm text-muted-foreground">Rounds</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-primary">{settings.pickTimeLimit}s</div>
                  <div className="text-sm text-muted-foreground">Per Pick</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-primary">
                    {settings.draftOrder === 'standard' ? 'Linear' : settings.draftOrder === 'custom' ? 'Custom' : 'Snake'}
                  </div>
                  <div className="text-sm text-muted-foreground">Draft Order</div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Inherited from your league settings. Nothing to re-enter.
              </p>

              {isCommissioner && (
                <div className="text-center">
                  <Button variant="ghost" size="sm" onClick={() => setShowAdjust(v => !v)}>
                    {showAdjust ? 'Hide adjustments' : 'Adjust for this draft'}
                  </Button>
                </div>
              )}

              {showAdjust && isCommissioner && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="rounds">Number of Rounds</Label>
                  <Select 
                    value={settings.rounds.toString()} 
                    onValueChange={(value) => setSettings({...settings, rounds: parseInt(value)})}
                    disabled={!isCommissioner}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {/* SETTINGS-DYNAMICS (2026-08-17): league creation
                          derives rounds from roster size (e.g. 14), so the
                          league's actual value must always be selectable —
                          a fixed list made nonstandard counts render as an
                          empty select. */}
                      {Array.from(new Set([settings.rounds, 12, 14, 16, 18, 20, 21, 24, 30]))
                        .filter(n => Number.isFinite(n) && n >= 1)
                        .sort((a, b) => a - b)
                        .map(n => (
                          <SelectItem key={n} value={n.toString()}>{n} Rounds</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="timer">Pick Time Limit</Label>
                  <Select 
                    value={settings.pickTimeLimit.toString()} 
                    onValueChange={(value) => setSettings({...settings, pickTimeLimit: parseInt(value)})}
                    disabled={!isCommissioner}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30">30 seconds</SelectItem>
                      <SelectItem value="45">45 seconds</SelectItem>
                      <SelectItem value="60">60 seconds</SelectItem>
                      <SelectItem value="90">90 seconds</SelectItem>
                      <SelectItem value="120">2 minutes</SelectItem>
                      <SelectItem value="180">3 minutes</SelectItem>
                      <SelectItem value="300">5 minutes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="teamsCount">Max Teams</Label>
                  <Select
                    value={maxTeams.toString()}
                    onValueChange={(value) => {
                      const count = parseInt(value);
                      if (onTeamsCountChange) onTeamsCountChange(count);
                    }}
                    disabled={!isCommissioner || !onTeamsCountChange || hasExistingDraft}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {/* SETTINGS-DYNAMICS (2026-08-17): 2-team leagues are
                          legal (league creation allows 2–50) — this list
                          starting at 4 meant the lobby literally could not
                          express the league the commissioner configured, and
                          nudged 2-team leagues up to 4. Include the league's
                          own size even if nonstandard. */}
                      {Array.from(new Set([maxTeams, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20]))
                        .filter(n => Number.isFinite(n) && n >= 2 && n >= teams.length)
                        .sort((a, b) => a - b)
                        .map(n => (
                          <SelectItem key={n} value={n.toString()}>{n} Teams</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  {teams.length > 0 && <p className="text-xs text-muted-foreground">{teams.length} joined so far</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="order">Draft Order</Label>
                  <Select
                    value={settings.draftOrder}
                    onValueChange={(value: 'standard' | 'serpentine' | 'custom') => setSettings({...settings, draftOrder: value})}
                    disabled={!isCommissioner}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {/* Vocabulary matches league creation: Snake there
                          === serpentine here. One concept, one name. */}
                      <SelectItem value="serpentine">Snake (1-8, 8-1, 1-8...)</SelectItem>
                      <SelectItem value="standard">Linear (1-8, 1-8, 1-8...)</SelectItem>
                      <SelectItem value="custom">Custom Order (Set Manually)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Custom Order Editor */}
                {settings.draftOrder === 'custom' && isCommissioner && (
                  <div className="space-y-2 p-4 border rounded-lg bg-muted/30">
                    <Label className="text-sm font-semibold">Custom Draft Order</Label>
                    <p className="text-xs text-muted-foreground mb-3">
                      Arrange teams in your desired draft order. This order will be used for all rounds.
                    </p>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {customOrder.map((teamId, index) => {
                        const team = getTeamById(teamId);
                        if (!team) return null;
                        
                        return (
                          <div
                            key={teamId}
                            className="flex items-center gap-2 p-2 bg-background border rounded-md"
                          >
                            <div className="flex items-center gap-2 flex-1">
                              <GripVertical className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                              <span className="text-sm font-medium w-8">#{index + 1}</span>
                              <span className="text-sm flex-1">{team.name}</span>
                              <Badge variant="outline" className="text-xs">
                                {team.owner}
                              </Badge>
                            </div>
                            <div className="flex gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => moveTeamUp(index)}
                                disabled={index === 0}
                              >
                                <ArrowUp className="h-3 w-3" aria-hidden="true" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => moveTeamDown(index)}
                                disabled={index === customOrder.length - 1}
                              >
                                <ArrowDown className="h-3 w-3" aria-hidden="true" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full mt-2"
                      onClick={() => {
                        // Reset to default order (teams as they appear)
                        setCustomOrder(teams.map(t => t.id));
                      }}
                    >
                      <Shuffle className="h-3 w-3 mr-2" aria-hidden="true" />
                      Reset to Default Order
                    </Button>
                  </div>
                )}

                {/* Scoring Format was configured at league creation
                    (format, stat set, point values). The lobby no longer
                    re-asks — SETTINGS-UNIFICATION (2026-08-17). */}
              </div>
              )}
            </CardContent>
          </Card>

          {/* Draft Order */}
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2">
                  <List className="h-5 w-5" aria-hidden="true" />
                  Draft Order
                </CardTitle>
                {isCommissioner && !hasExistingDraft && (
                  <div className="flex flex-wrap gap-2">
                    {onRandomizeOrder && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={onRandomizeOrder}
                        className="gap-2"
                      >
                        <Shuffle className="h-4 w-4" aria-hidden="true" />
                        <span className="hidden xs:inline">Randomize</span>
                        <span className="xs:hidden">Rand.</span> Order
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowCustomOrderDialog(true)}
                      className="gap-2"
                    >
                      <Edit className="h-4 w-4" aria-hidden="true" />
                      Custom Order
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {getEffectiveDraftOrder().map((teamId, index) => {
                  const team = teams.find(t => t.id === teamId);
                  if (!team) return null;
                  
                  return (
                    <div key={teamId} className="flex items-center gap-3 p-3 rounded-lg border bg-gradient-to-r from-primary/5 to-transparent">
                      <div className="flex items-center gap-2 min-w-[3rem]">
                        <div 
                          className="w-3 h-3 rounded-full" 
                          style={{ backgroundColor: team.color }}
                        />
                        <span className="font-bold text-primary">#{index + 1}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{team.name}</div>
                        <div className="text-sm text-muted-foreground truncate">{team.owner}</div>
                      </div>
                      {index === 0 && <Crown className="h-4 w-4 text-yellow-500 shrink-0" aria-hidden="true" />}
                    </div>
                  );
                })}
              </div>
              {(customDraftOrder || randomizedOrder || settings.draftOrder === 'custom') && (
                <div className="mt-4 p-3 rounded-lg bg-primary/10 border border-primary/20">
                  <p className="text-sm text-primary font-medium flex items-center gap-2">
                    <Check className="h-4 w-4" aria-hidden="true" />
                    {settings.draftOrder === 'custom' 
                      ? 'Custom draft order (from settings) has been set and will be used when you start the draft.'
                      : customDraftOrder
                        ? 'Custom draft order has been set and will be used when you start the draft.'
                        : 'Draft order has been randomized and will be used when you start the draft.'}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Team List */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" aria-hidden="true" />
                  All Teams ({teams.length}/{maxTeams})
                </CardTitle>
                {isCommissioner && teams.length < maxTeams && onAddAITeams && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={async () => {
                      if (onAddAITeams) {
                        await onAddAITeams();
                      }
                    }}
                  >
                    <Users className="h-4 w-4 mr-2" aria-hidden="true" />
                    Add AI Teams
                  </Button>
                )}
              </div>
              {isCommissioner && onTeamsCountChange && (
                <div className="flex items-center gap-3 mt-2">
                  <Label htmlFor="teamsCountHeader" className="text-sm whitespace-nowrap">Max Teams:</Label>
                  <Select
                    value={maxTeams.toString()}
                    onValueChange={(value) => {
                      const count = parseInt(value);
                      if (onTeamsCountChange) onTeamsCountChange(count);
                    }}
                    disabled={hasExistingDraft}
                  >
                    <SelectTrigger className="w-[120px] h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {/* SETTINGS-DYNAMICS (2026-08-17): 2-team leagues are
                          legal (league creation allows 2–50) — this list
                          starting at 4 meant the lobby literally could not
                          express the league the commissioner configured, and
                          nudged 2-team leagues up to 4. Include the league's
                          own size even if nonstandard. */}
                      {Array.from(new Set([maxTeams, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20]))
                        .filter(n => Number.isFinite(n) && n >= 2 && n >= teams.length)
                        .sort((a, b) => a - b)
                        .map(n => (
                          <SelectItem key={n} value={n.toString()}>{n} Teams</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {teams.map((team) => (
                  <div key={team.id} className="flex items-center gap-3 p-3 rounded-lg border min-w-0">
                    <div className="flex items-center gap-2 shrink-0">
                      <div
                        className="w-4 h-4 rounded-full"
                        style={{ backgroundColor: team.color }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{team.name}</div>
                      <div className="text-sm text-muted-foreground truncate">{team.owner}</div>
                    </div>
                    {isCommissioner && onDeleteTeam && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setTeamToDelete(team)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                ))}

                {/* Show a few empty slots (max 3) to indicate open spots without flooding the page */}
                {teams.length < maxTeams && (
                  <>
                    {Array.from({ length: Math.min(3, maxTeams - teams.length) }).map((_, index) => (
                      <div key={`empty-${index}`} className="flex items-center gap-3 p-3 rounded-lg border border-dashed border-muted">
                        <UserPlus className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        <div className="text-muted-foreground">Waiting for manager...</div>
                      </div>
                    ))}
                    {maxTeams - teams.length > 3 && (
                      <div className="flex items-center gap-3 p-3 text-sm text-muted-foreground">
                        + {maxTeams - teams.length - 3} more open spots
                      </div>
                    )}
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Custom Order Dialog */}
        <Dialog open={showCustomOrderDialog} onOpenChange={setShowCustomOrderDialog}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Custom Draft Order</DialogTitle>
              <DialogDescription>
                Arrange teams in your desired draft order. This order will be used for all rounds (serpentine will reverse on even rounds).
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-4">
              {draftOrderCustomOrder.map((teamId, index) => {
                const team = getTeamById(teamId);
                if (!team) return null;
                
                return (
                  <div
                    key={teamId}
                    className="flex items-center gap-2 p-3 bg-background border rounded-md"
                  >
                    <div className="flex items-center gap-2 flex-1">
                      <GripVertical className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      <span className="text-sm font-medium w-8">#{index + 1}</span>
                      <span className="text-sm flex-1">{team.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {team.owner}
                      </Badge>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => moveDraftOrderTeamUp(index)}
                        disabled={index === 0}
                      >
                        <ArrowUp className="h-3 w-3" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => moveDraftOrderTeamDown(index)}
                        disabled={index === draftOrderCustomOrder.length - 1}
                      >
                        <ArrowDown className="h-3 w-3" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  if (teams && Array.isArray(teams)) {
                    setDraftOrderCustomOrder(teams.map(t => t.id));
                  }
                }}
              >
                <Shuffle className="h-3 w-3 mr-2" aria-hidden="true" />
                Reset to Default
              </Button>
              <Button onClick={handleSaveCustomDraftOrder}>
                Save Order
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Sidebar — appears first on mobile (controls + invite), second on desktop */}
        <div className="space-y-6 order-1 lg:order-2 min-w-0">
          {/* League Invite Code - Commissioner Only */}
          {isCommissioner && joinCode && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                  Invite Managers
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Join Code Display - Compact */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-3 py-2 bg-muted rounded-md border">
                    <div className="text-lg font-mono font-semibold text-center">{joinCode}</div>
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => {
                      if (joinCode) {
                        navigator.clipboard.writeText(joinCode);
                        setCopiedCode(true);
                        toast({
                          title: 'Copied!',
                          description: 'Join code copied',
                        });
                        setTimeout(() => setCopiedCode(false), 2000);
                      }
                    }}
                  >
                    {copiedCode ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                  </Button>
                </div>

                {/* Quick Actions - Compact Row.
                    INVITE SHARE (2026-09-01): OS share sheet leads wherever it
                    exists — the scheme-based send button did nothing inside the
                    native shell, and links built on the in-app origin were
                    unopenable. Mechanics live in utils/inviteShare. */}
                <div className="flex gap-2">
                  {canSystemShare() ? (
                    <Button
                      variant="default"
                      size="sm"
                      className="flex-1"
                      onClick={async () => {
                        if (!joinCode) return;
                        const result = await shareInvite(leagueName || 'My League', joinCode);
                        if (result === 'copied') {
                          toast({ title: 'Invite copied!', description: 'Paste it anywhere to invite friends.' });
                        } else if (result === 'failed') {
                          toast({ title: 'Could not share', description: 'Use the Link button instead.' });
                        }
                      }}
                    >
                      <Share2 className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                      Share
                    </Button>
                  ) : (
                    <Button
                      variant="default"
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        if (joinCode) emailInvite(leagueName || 'My League', joinCode);
                      }}
                    >
                      <Mail className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                      Email
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      if (joinCode) {
                        navigator.clipboard.writeText(buildInviteLink(joinCode));
                        setCopiedLink(true);
                        toast({
                          title: 'Link Copied!',
                          description: 'Invite link copied',
                        });
                        setTimeout(() => setCopiedLink(false), 2000);
                      }
                    }}
                  >
                    {copiedLink ? (
                      <>
                        <Check className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                        Copied
                      </>
                    ) : (
                      <>
                        <LinkIcon className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                        Link
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Scheduled Draft Time Display - visible to all members */}
          {scheduledDraftTime && (
            <Card className="border-primary/20 bg-primary/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-primary" aria-hidden="true" />
                  Scheduled Draft
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center space-y-2">
                  <div className="text-lg font-bold text-primary">
                    {new Date(scheduledDraftTime).toLocaleDateString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric'
                    })}
                  </div>
                  <div className="text-2xl font-bold">
                    {new Date(scheduledDraftTime).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </div>
                  {new Date(scheduledDraftTime) > new Date() && (
                    <p className="text-xs text-muted-foreground">
                      Draft room will open at this time
                    </p>
                  )}
                  {isCommissioner && onScheduleDraft && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs"
                      onClick={() => onScheduleDraft(null)}
                    >
                      <X className="h-3 w-3 mr-1" aria-hidden="true" />
                      Clear Schedule
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Start Draft or Waiting Status */}
          {isCommissioner ? (
            <Card>
              <CardHeader>
                <CardTitle>Draft Control</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Teams joined:</span>
                    <span className="font-medium">{teams.length}/{maxTeams}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Minimum required:</span>
                    <span className="font-medium">4</span>
                  </div>
                  {isDraftQueued && (
                    <div className="mt-2 p-2 rounded-lg bg-primary/10 border border-primary/20">
                      <p className="text-xs text-primary font-medium flex items-center gap-2">
                        <Check className="h-3 w-3" aria-hidden="true" />
                        Draft is queued and ready to start
                      </p>
                    </div>
                  )}
                </div>

                {hasExistingDraft ? (
                  <Button
                    onClick={handleStartDraft}
                    className="w-full"
                    disabled={isStartingDraft}
                  >
                    <Play className="h-4 w-4 mr-2" aria-hidden="true" />
                    {isStartingDraft ? 'Starting…' : 'Continue Draft'}
                  </Button>
                ) : isDraftQueued ? (
                  <>
                    <Button
                      onClick={handleStartDraft}
                      className="w-full bg-primary hover:bg-primary/90"
                      size="lg"
                      disabled={isStartingDraft}
                    >
                      <Play className="h-5 w-5 mr-2" aria-hidden="true" />
                      {isStartingDraft ? 'Starting…' : 'Start Draft Now'}
                    </Button>
                    <p className="text-xs text-muted-foreground text-center">
                      Draft is prepared. Click to begin!
                    </p>
                  </>
                ) : (
                  <>
                    {/* Impromptu Draft - Start immediately */}
                    {onPrepareDraft && (
                      <Button
                        onClick={() => {
                          const effectiveOrder = getEffectiveDraftOrder();
                          onPrepareDraft?.({
                            ...settings,
                            effectiveOrder: effectiveOrder.length > 0 ? effectiveOrder : undefined
                          });
                        }}
                        className="w-full"
                        disabled={teams.length < 2 || isStartingDraft}
                      >
                        <Hourglass className="h-4 w-4 mr-2" aria-hidden="true" />
                        Prepare Draft
                      </Button>
                    )}
                    <Button
                      onClick={handleStartDraft}
                      className="w-full"
                      disabled={teams.length < 2 || isStartingDraft}
                      variant={onPrepareDraft ? "outline" : "default"}
                    >
                      <Play className="h-4 w-4 mr-2" aria-hidden="true" />
                      {isStartingDraft ? 'Starting…' : 'Start Draft Now'}
                    </Button>

                    {/* Schedule Draft - Set a future time */}
                    {onScheduleDraft && !scheduledDraftTime && (
                      <Button
                        variant="outline"
                        className="w-full"
                        disabled={teams.length < 2}
                        onClick={() => {
                          // Default to tomorrow at 8 PM
                          const tomorrow = new Date();
                          tomorrow.setDate(tomorrow.getDate() + 1);
                          tomorrow.setHours(20, 0, 0, 0);
                          setScheduleDateInput(tomorrow.toISOString().split('T')[0]);
                          setScheduleTimeInput('20:00');
                          setShowScheduleDialog(true);
                        }}
                      >
                        <Calendar className="h-4 w-4 mr-2" aria-hidden="true" />
                        Schedule Draft Time
                      </Button>
                    )}

                    {teams.length < 2 && (
                      <p className="text-xs text-muted-foreground text-center">
                        Need at least 2 teams to start
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              {hasExistingDraft ? (
                <Card className="border-primary/20 bg-primary/5">
                  <CardHeader>
                    <CardTitle className="text-primary flex items-center gap-2">
                      <Play className="h-5 w-5" aria-hidden="true" />
                      Draft In Progress
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      The draft is currently in progress. Click below to join the draft room.
                    </p>
                    <p className="text-sm font-medium">
                      Pick {currentPick} of {totalPicks}
                    </p>
                    <Button
                      onClick={handleStartDraft}
                      className="w-full bg-primary hover:bg-primary/90"
                      size="lg"
                      disabled={isStartingDraft}
                    >
                      <Play className="h-5 w-5 mr-2" aria-hidden="true" />
                      {isStartingDraft ? 'Joining…' : 'Join Draft Room'}
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <Card className="border-primary/20 bg-primary/5">
                  <CardHeader>
                    <CardTitle className="text-primary flex items-center gap-2">
                      <Hourglass className="h-5 w-5" aria-hidden="true" />
                      {scheduledDraftTime ? 'Draft Scheduled' : 'Waiting for Draft'}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-4">
                      {scheduledDraftTime
                        ? 'The draft is scheduled. You\'ll be able to join the draft room when it starts.'
                        : 'The commissioner will start the draft once all teams are ready. Stay in the lobby to join automatically.'}
                    </p>
                    <div className="flex items-center justify-center">
                      <div className="animate-pulse flex space-x-2">
                        <div className="w-2 h-2 bg-primary rounded-full"></div>
                        <div className="w-2 h-2 bg-primary rounded-full delay-75"></div>
                        <div className="w-2 h-2 bg-primary rounded-full delay-150"></div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Not in this league?</CardTitle>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" className="w-full" onClick={() => navigate('/create-league')}>
                    <Trophy className="h-4 w-4 mr-2" aria-hidden="true" />
                    Create New League
                  </Button>
                </CardContent>
              </Card>
            </>
          )}

          {/* Draft Info */}
          <Card>
            <CardContent className="pt-6 space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span className="text-muted-foreground">
                  Estimated time: {Math.ceil((teams.length * settings.rounds * settings.pickTimeLimit) / 60)} minutes
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Trophy className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span className="text-muted-foreground">
                  {settings.draftOrder === 'serpentine' ? 'Serpentine' : 'Standard'} draft order
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Delete Team Confirmation Dialog */}
      <Dialog open={!!teamToDelete} onOpenChange={() => setTeamToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            {/* A question, not a failure. The title used to be
                `text-destructive` and the triangle red, so the first line a
                commissioner read announced a problem that had not happened.
                See components/confirm/destructiveConfirm.ts. */}
            <DialogTitle className={CONFIRM_TITLE}>
              <TriangleAlert className={CONFIRM_ICON} aria-hidden="true" />
              Remove Team
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to remove <span className="font-semibold">{teamToDelete?.name}</span> from this league?
            </DialogDescription>
          </DialogHeader>
          <DestructiveConsequence>
            This removes all of their draft picks and roster data, and it cannot be undone.
          </DestructiveConsequence>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTeamToDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteTeam}>
              <Trash2 className="h-4 w-4 mr-2" aria-hidden="true" />
              Remove Team
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Schedule Draft Time Dialog - Commissioner Only */}
      <Dialog open={showScheduleDialog} onOpenChange={setShowScheduleDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" aria-hidden="true" />
              Schedule Draft Time
            </DialogTitle>
            <DialogDescription>
              Set a date and time for the draft. All league members will see when the draft is scheduled and can join the draft room at that time.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="draft-date">Date</Label>
              <Input
                id="draft-date"
                type="date"
                value={scheduleDateInput}
                min={new Date().toISOString().split('T')[0]}
                onChange={(e) => setScheduleDateInput(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="draft-time">Time</Label>
              <Input
                id="draft-time"
                type="time"
                value={scheduleTimeInput}
                onChange={(e) => setScheduleTimeInput(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowScheduleDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!scheduleDateInput || !scheduleTimeInput) {
                  toast({
                    title: 'Missing Information',
                    description: 'Please select both a date and time.',
                    variant: 'destructive',
                  });
                  return;
                }
                const scheduledTime = new Date(`${scheduleDateInput}T${scheduleTimeInput}`);
                if (scheduledTime <= new Date()) {
                  toast({
                    title: 'Invalid Time',
                    description: 'Scheduled time must be in the future.',
                    variant: 'destructive',
                  });
                  return;
                }
                onScheduleDraft?.(scheduledTime.toISOString());
                setShowScheduleDialog(false);
                toast({
                  title: 'Draft Scheduled',
                  description: `Draft scheduled for ${scheduledTime.toLocaleDateString()} at ${scheduledTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
                });
              }}
            >
              <Calendar className="h-4 w-4 mr-2" aria-hidden="true" />
              Schedule Draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
