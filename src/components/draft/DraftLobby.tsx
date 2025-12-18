import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  Copy,
  Check,
  Hourglass,
  Shuffle,
  List,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Edit
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

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
  onResetDraft?: () => void; // Optional reset draft handler
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
  onRandomizeOrder,
  randomizedOrder,
  customDraftOrder,
  onCustomOrderChange,
  leagueDraftRounds = 21,
  onResetDraft
}: DraftLobbyProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [settings, setSettings] = useState<DraftSettings>({
    rounds: leagueDraftRounds, // Use league's draft_rounds setting
    pickTimeLimit: 90,
    draftOrder: 'serpentine',
    scoringFormat: 'standard'
  });
  
  // Custom draft order state (team IDs in order) - for dropdown option
  const [customOrder, setCustomOrder] = useState<string[]>(teams && Array.isArray(teams) ? teams.map(t => t.id) : []);
  
  // Custom order state for the Draft Order section button
  const [showCustomOrderDialog, setShowCustomOrderDialog] = useState(false);
  const [draftOrderCustomOrder, setDraftOrderCustomOrder] = useState<string[]>(
    customDraftOrder && customDraftOrder.length > 0 
      ? customDraftOrder 
      : (teams && Array.isArray(teams) ? teams.map(t => t.id) : [])
  );

  // Update settings when leagueDraftRounds changes
  useEffect(() => {
    setSettings(prev => ({
      ...prev,
      rounds: leagueDraftRounds
    }));
  }, [leagueDraftRounds]);

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

  const draftCode = "DRAFT-2024-NHL";

  const handleCopyCode = () => {
    navigator.clipboard.writeText(draftCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({
      title: "Draft code copied!",
      description: "Share this code with other managers to join the draft.",
    });
  };

  const handleStartDraft = () => {
    if (!teams || !Array.isArray(teams) || teams.length < 4) {
      toast({
        title: "Not enough teams",
        description: "You need at least 4 teams to start the draft.",
        variant: "destructive"
      });
      return;
    }
    onStartDraft(settings);
  };

  return (
    <div className="space-y-6">
      {/* Draft Header */}
      <div className="text-center space-y-4">
        <div className="flex items-center justify-center gap-2">
          <Trophy className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold">NHL Fantasy Draft Lobby</h1>
        </div>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          {hasExistingDraft
            ? `Draft in progress (Pick ${currentPick} of ${totalPicks}). Click "Continue Draft" to rejoin.`
            : isCommissioner 
              ? "Configure your draft settings and wait for all managers to join before starting the draft."
              : "Waiting for the league commissioner to start the draft. Review the settings below."}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Draft Settings */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Draft Settings
                {!isCommissioner && <Badge variant="secondary" className="ml-2">Read Only</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
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
                      <SelectItem value="12">12 Rounds</SelectItem>
                      <SelectItem value="16">16 Rounds</SelectItem>
                      <SelectItem value="18">18 Rounds</SelectItem>
                      <SelectItem value="20">20 Rounds</SelectItem>
                      <SelectItem value="21">21 Rounds</SelectItem>
                      <SelectItem value="24">24 Rounds</SelectItem>
                      <SelectItem value="30">30 Rounds</SelectItem>
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
                      <SelectItem value="60">60 seconds</SelectItem>
                      <SelectItem value="90">90 seconds</SelectItem>
                      <SelectItem value="120">2 minutes</SelectItem>
                      <SelectItem value="180">3 minutes</SelectItem>
                    </SelectContent>
                  </Select>
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
                      <SelectItem value="standard">Standard (1-8, 1-8, 1-8...)</SelectItem>
                      <SelectItem value="serpentine">Serpentine (1-8, 8-1, 1-8...)</SelectItem>
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
                              <GripVertical className="h-4 w-4 text-muted-foreground" />
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
                                <ArrowUp className="h-3 w-3" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => moveTeamDown(index)}
                                disabled={index === customOrder.length - 1}
                              >
                                <ArrowDown className="h-3 w-3" />
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
                      <Shuffle className="h-3 w-3 mr-2" />
                      Reset to Default Order
                    </Button>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="scoring">Scoring Format</Label>
                  <Select 
                    value={settings.scoringFormat} 
                    onValueChange={(value: 'standard' | 'points' | 'categories') => setSettings({...settings, scoringFormat: value})}
                    disabled={!isCommissioner}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="points">Points Only</SelectItem>
                      <SelectItem value="categories">Categories</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />

              {/* Draft Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-primary">{teams.length}</div>
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
                  <div className="text-2xl font-bold text-primary">{teams.length * settings.rounds}</div>
                  <div className="text-sm text-muted-foreground">Total Picks</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Draft Order */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <List className="h-5 w-5" />
                  Draft Order
                </CardTitle>
                {isCommissioner && !hasExistingDraft && (
                  <div className="flex gap-2">
                    {onRandomizeOrder && (
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={onRandomizeOrder}
                        className="gap-2"
                      >
                        <Shuffle className="h-4 w-4" />
                        Randomize Order
                      </Button>
                    )}
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => setShowCustomOrderDialog(true)}
                      className="gap-2"
                    >
                      <Edit className="h-4 w-4" />
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
                      <div className="flex-1">
                        <div className="font-medium">{team.name}</div>
                        <div className="text-sm text-muted-foreground">{team.owner}</div>
                      </div>
                      {index === 0 && <Crown className="h-4 w-4 text-yellow-500" />}
                    </div>
                  );
                })}
              </div>
              {(customDraftOrder || randomizedOrder || settings.draftOrder === 'custom') && (
                <div className="mt-4 p-3 rounded-lg bg-primary/10 border border-primary/20">
                  <p className="text-sm text-primary font-medium flex items-center gap-2">
                    <Check className="h-4 w-4" />
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
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                All Teams ({teams.length}/12)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {teams.map((team) => (
                  <div key={team.id} className="flex items-center gap-3 p-3 rounded-lg border">
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-4 h-4 rounded-full" 
                        style={{ backgroundColor: team.color }}
                      />
                    </div>
                    <div className="flex-1">
                      <div className="font-medium">{team.name}</div>
                      <div className="text-sm text-muted-foreground">{team.owner}</div>
                    </div>
                  </div>
                ))}
                
                {/* Empty slots */}
                {Array.from({ length: Math.max(0, 12 - teams.length) }).map((_, index) => (
                  <div key={`empty-${index}`} className="flex items-center gap-3 p-3 rounded-lg border border-dashed border-muted">
                    <UserPlus className="h-4 w-4 text-muted-foreground" />
                    <div className="text-muted-foreground">Waiting for manager...</div>
                  </div>
                ))}
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
                      <GripVertical className="h-4 w-4 text-muted-foreground" />
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
                        <ArrowUp className="h-3 w-3" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => moveDraftOrderTeamDown(index)}
                        disabled={index === draftOrderCustomOrder.length - 1}
                      >
                        <ArrowDown className="h-3 w-3" />
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
                <Shuffle className="h-3 w-3 mr-2" />
                Reset to Default
              </Button>
              <Button onClick={handleSaveCustomDraftOrder}>
                Save Order
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Join Draft */}
          <Card>
            <CardHeader>
              <CardTitle>Invite Managers</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Draft Code</Label>
                <div className="flex gap-2">
                  <Input value={draftCode} readOnly className="font-mono" />
                  <Button variant="outline" size="icon" onClick={handleCopyCode}>
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                Share this code with other managers so they can join your draft.
              </div>
            </CardContent>
          </Card>

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
                    <span className="font-medium">{teams.length}/12</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Minimum required:</span>
                    <span className="font-medium">4</span>
                  </div>
                  {isDraftQueued && (
                    <div className="mt-2 p-2 rounded-lg bg-primary/10 border border-primary/20">
                      <p className="text-xs text-primary font-medium flex items-center gap-2">
                        <Check className="h-3 w-3" />
                        Draft is queued and ready to start
                      </p>
                    </div>
                  )}
                </div>
                
                {hasExistingDraft ? (
                  <Button 
                    onClick={handleStartDraft}
                    className="w-full"
                  >
                    <Play className="h-4 w-4 mr-2" />
                    Continue Draft
                  </Button>
                ) : isDraftQueued ? (
                  <>
                    <Button 
                      onClick={handleStartDraft}
                      className="w-full bg-primary hover:bg-primary/90"
                      size="lg"
                    >
                      <Play className="h-5 w-5 mr-2" />
                      Start Draft Now
                    </Button>
                    <p className="text-xs text-muted-foreground text-center">
                      Draft is prepared. Click to begin!
                    </p>
                  </>
                ) : (
                  <>
                    {onPrepareDraft && (
                      <Button 
                        onClick={handlePrepareDraftClick}
                        className="w-full"
                        disabled={teams.length < 4}
                      >
                        <Hourglass className="h-4 w-4 mr-2" />
                        Prepare Draft
                      </Button>
                    )}
                    <Button 
                      onClick={handleStartDraft}
                      className="w-full"
                      disabled={teams.length < 4}
                      variant={onPrepareDraft ? "outline" : "default"}
                    >
                      <Play className="h-4 w-4 mr-2" />
                      Start Draft
                    </Button>
                    {teams.length < 4 && (
                      <p className="text-xs text-muted-foreground text-center">
                        Need at least 4 teams to start
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              <Card className="border-primary/20 bg-primary/5">
                <CardHeader>
                  <CardTitle className="text-primary flex items-center gap-2">
                    <Hourglass className="h-5 w-5" />
                    Waiting to Start
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">
                    The commissioner will start the draft once all teams have joined.
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

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Not in this league?</CardTitle>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" className="w-full" onClick={() => navigate('/create-league')}>
                    <Trophy className="h-4 w-4 mr-2" />
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
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">
                  Estimated time: {Math.ceil((teams.length * settings.rounds * settings.pickTimeLimit) / 60)} minutes
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Trophy className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">
                  {settings.draftOrder === 'serpentine' ? 'Serpentine' : 'Standard'} draft order
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};
