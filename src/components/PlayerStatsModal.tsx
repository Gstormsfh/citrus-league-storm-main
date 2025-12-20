import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { TrendingUp, TrendingDown, Target, Shield, Zap, Star, AlertCircle, Clock, User, Ruler, Weight, Calendar, Award, Activity, BarChart3, Users, Timer, Crosshair, Trash2 } from 'lucide-react';
import { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';
import { cn } from '@/lib/utils';
import { LeagueService } from '@/services/LeagueService';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useState } from 'react';

interface PlayerStatsModalProps {
  player: HockeyPlayer | null;
  isOpen: boolean;
  onClose: () => void;
  leagueId?: string | null;
  isOnRoster?: boolean; // Whether this player is on the user's roster
  onPlayerDropped?: () => void; // Callback to refresh roster after drop
}

const PlayerStatsModal = ({ player, isOpen, onClose, leagueId, isOnRoster = false, onPlayerDropped }: PlayerStatsModalProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isDropping, setIsDropping] = useState(false);

  if (!player) return null;

  const isGoalie = player.position === 'Goalie' || player.position === 'G';
  const stats = player.stats || {};

  const handleDropPlayer = async () => {
    if (!user || !leagueId || !player?.id) {
      toast({
        title: "Error",
        description: "Unable to drop player. Missing required information.",
        variant: "destructive"
      });
      return;
    }

    if (!confirm(`Are you sure you want to drop ${player.name}? This action cannot be undone.`)) {
      return;
    }

    setIsDropping(true);
    try {
      const { success, error } = await LeagueService.dropPlayer(
        leagueId,
        user.id,
        String(player.id),
        'Roster Tab'
      );

      if (success) {
        toast({
          title: "Player Dropped",
          description: `${player.name} has been dropped from your roster.`,
        });
        onPlayerDropped?.();
        onClose();
      } else {
        toast({
          title: "Error",
          description: error?.message || "Failed to drop player. Please try again.",
          variant: "destructive"
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error?.message || "Failed to drop player. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsDropping(false);
    }
  };

  // Get status badge info
  const getStatusInfo = () => {
    if (!player.status) return null;
    const statusConfig = {
      'IR': { label: 'Injury Reserve', variant: 'destructive' as const, icon: AlertCircle, color: 'text-red-500' },
      'SUSP': { label: 'Suspended', variant: 'destructive' as const, icon: AlertCircle, color: 'text-orange-500' },
      'GTD': { label: 'Game Time Decision', variant: 'secondary' as const, icon: Clock, color: 'text-yellow-500' },
      'WVR': { label: 'Waiver', variant: 'outline' as const, icon: AlertCircle, color: 'text-blue-500' },
    };
    return statusConfig[player.status];
  };

  const statusInfo = getStatusInfo();

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-white text-2xl font-bold shadow-lg">
              {player.number}
            </div>
            <div className="flex-1">
              <h2 className="text-3xl font-bold">{player.name}</h2>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <Badge variant="secondary" className="text-sm">{player.position}</Badge>
                <span className="text-muted-foreground font-medium">{player.team}</span>
                {player.teamAbbreviation && (
                  <Badge variant="outline" className="text-xs">{player.teamAbbreviation}</Badge>
                )}
                {player.starter && (
                  <Badge variant="default" className="gap-1">
                    <Star className="h-3 w-3 fill-current" />
                    Starter
                  </Badge>
                )}
                {statusInfo && (
                  <Badge variant={statusInfo.variant} className="gap-1">
                    <statusInfo.icon className={cn("h-3 w-3", statusInfo.color)} />
                    {statusInfo.label}
                  </Badge>
                )}
              </div>
            </div>
            {leagueId && user && isOnRoster && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDropPlayer}
                disabled={isDropping}
                className="ml-auto"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {isDropping ? 'Dropping...' : 'Drop Player'}
              </Button>
            )}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="stats" className="mt-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="stats">Season Stats</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
            <TabsTrigger value="recent">Recent Form</TabsTrigger>
            <TabsTrigger value="news">News & Analysis</TabsTrigger>
          </TabsList>

          {/* Season Stats Tab */}
          <TabsContent value="stats" className="space-y-4 mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {isGoalie ? (
                <>
                  <Card>
                    <CardHeader className="flex flex-row items-center space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Wins</CardTitle>
                      <Shield className="h-4 w-4 ml-auto text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{stats.wins ?? 0}</div>
                      <p className="text-xs text-muted-foreground">
                        {stats.losses ?? 0}L {stats.otl ?? 0}OT
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="flex flex-row items-center space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Goals Against Avg</CardTitle>
                      <Target className="h-4 w-4 ml-auto text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{stats.gaa?.toFixed(2) ?? '0.00'}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="flex flex-row items-center space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Save Percentage</CardTitle>
                      <Zap className="h-4 w-4 ml-auto text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {stats.savePct ? (stats.savePct * 100).toFixed(3) : '0.000'}%
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="flex flex-row items-center space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Shutouts</CardTitle>
                      <Star className="h-4 w-4 ml-auto text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{stats.shutouts ?? 0}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="flex flex-row items-center space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Games Played</CardTitle>
                      <Activity className="h-4 w-4 ml-auto text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{stats.gamesPlayed ?? 0}</div>
                    </CardContent>
                  </Card>
                </>
              ) : (
                <>
                  <Card>
                    <CardHeader className="flex flex-row items-center space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Goals</CardTitle>
                      <Target className="h-4 w-4 ml-auto text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{stats.goals ?? 0}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="flex flex-row items-center space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Assists</CardTitle>
                      <Zap className="h-4 w-4 ml-auto text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{stats.assists ?? 0}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="flex flex-row items-center space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Total Points</CardTitle>
                      <Star className="h-4 w-4 ml-auto text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{stats.points ?? (stats.goals ?? 0) + (stats.assists ?? 0)}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="flex flex-row items-center space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Shots on Goal</CardTitle>
                      <Crosshair className="h-4 w-4 ml-auto text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{stats.shots ?? 0}</div>
                      {stats.shots && stats.goals && (
                        <p className="text-xs text-muted-foreground">
                          {((stats.goals / stats.shots) * 100).toFixed(1)}% shooting
                        </p>
                      )}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="flex flex-row items-center space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Games Played</CardTitle>
                      <Activity className="h-4 w-4 ml-auto text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{stats.gamesPlayed ?? 0}</div>
                    </CardContent>
                  </Card>
                   <Card>
                    <CardHeader className="flex flex-row items-center space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Hits</CardTitle>
                      <Weight className="h-4 w-4 ml-auto text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{stats.hits ?? 0}</div>
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          </TabsContent>

          {/* Advanced Stats Tab (Merged Detailed Stats) */}
          <TabsContent value="advanced" className="space-y-4 mt-4">
            {/* Advanced Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {isGoalie ? (
                <>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium">Save Percentage</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {stats.savePct ? (stats.savePct * 100).toFixed(3) : '0.000'}%
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium">Goals Against Average</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{stats.gaa?.toFixed(2) ?? '0.00'}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium">Goals Saved Above Expected</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className={cn("text-2xl font-bold", 
                        (stats.goalsSavedAboveExpected || 0) > 0 ? "text-green-600" : (stats.goalsSavedAboveExpected || 0) < 0 ? "text-red-600" : ""
                      )}>
                        {(stats.goalsSavedAboveExpected || 0) > 0 ? '+' : ''}{(stats.goalsSavedAboveExpected || 0).toFixed(2)}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">GSAx (Expected - Actual)</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium">High Danger Save %</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {stats.highDangerSavePct ? (stats.highDangerSavePct * 100).toFixed(1) : '0.0'}%
                      </div>
                    </CardContent>
                  </Card>
                </>
              ) : (
                <>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium">Expected Goals (xG)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{stats.xGoals?.toFixed(1) ?? '0.0'}</div>
                      <p className="text-xs text-muted-foreground mt-1">
                         Diff: <span className={cn(
                           ((stats.goals || 0) - (stats.xGoals || 0)) > 0 ? "text-green-600" : "text-red-600"
                         )}>
                           {((stats.goals || 0) - (stats.xGoals || 0)) > 0 ? '+' : ''}
                           {((stats.goals || 0) - (stats.xGoals || 0)).toFixed(1)}
                         </span>
                      </p>
                    </CardContent>
                  </Card>
                  {/* Corsi/Fenwick intentionally removed (not tracked) */}
                   <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium">Hits</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{stats.hits ?? 0}</div>
                    </CardContent>
                  </Card>
                   <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium">Blocked Shots</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{stats.blockedShots ?? 0}</div>
                    </CardContent>
                  </Card>
                   <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium">Power Play Points</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{stats.powerPlayPoints ?? 0}</div>
                    </CardContent>
                  </Card>
                </>
              )}
            </div>


            {/* Detailed Stats Table (Merged) */}
            <div className="mt-6">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Detailed Statistics
              </h3>
              <Card>
                <CardContent className="p-0">
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-px bg-border">
                     {/* Helper for stat items */}
                     {[
                       { label: 'Goals', value: stats.goals ?? 0 },
                       { label: 'Assists', value: stats.assists ?? 0 },
                       { label: 'Points', value: stats.points ?? (stats.goals ?? 0) + (stats.assists ?? 0) },
                       { label: '+/-', value: stats.plusMinus ?? 0, color: (stats.plusMinus ?? 0) > 0 ? 'text-green-600' : (stats.plusMinus ?? 0) < 0 ? 'text-red-600' : '' },
                       { label: 'Shots', value: stats.shots ?? 0 },
                       { label: 'Hits', value: stats.hits ?? 0 },
                       { label: 'Blocks', value: stats.blockedShots ?? 0 },
                       { label: 'PIM', value: stats.pim ?? 0 },
                       { label: 'PPP', value: stats.powerPlayPoints ?? 0 },
                       { label: 'SHP', value: stats.shortHandedPoints ?? 0 },
                       { label: 'Games', value: stats.gamesPlayed ?? 0 },
                       { label: 'TOI/G', value: stats.toi ?? '0:00' },
                     ].map((item, i) => (
                       <div key={i} className="bg-card p-3 flex flex-col items-center justify-center text-center">
                         <span className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{item.label}</span>
                         <span className={cn("text-lg font-bold", item.color)}>{item.value}</span>
                       </div>
                     ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Recent Form Tab */}
          <TabsContent value="recent" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Last 5 Games</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-6 gap-2 text-sm font-medium text-muted-foreground border-b pb-2">
                    <div className="col-span-2">Opponent</div>
                    <div className="text-center">G</div>
                    <div className="text-center">A</div>
                    <div className="text-center">Pts</div>
                    <div className="text-center">+/-</div>
                  </div>
                  {[
                    { opp: 'vs TBL', date: 'Oct 24', g: 1, a: 1, p: 2, pm: 2 },
                    { opp: '@ FLA', date: 'Oct 22', g: 0, a: 2, p: 2, pm: 1 },
                    { opp: 'vs DET', date: 'Oct 19', g: 1, a: 0, p: 1, pm: -1 },
                    { opp: '@ BUF', date: 'Oct 17', g: 0, a: 1, p: 1, pm: 0 },
                    { opp: 'vs TOR', date: 'Oct 14', g: 2, a: 1, p: 3, pm: 3 },
                  ].map((game, i) => (
                    <div key={i} className="grid grid-cols-6 gap-2 text-sm items-center py-2 border-b last:border-0">
                      <div className="col-span-2">
                        <div className="font-medium">{game.opp}</div>
                        <div className="text-xs text-muted-foreground">{game.date}</div>
                      </div>
                      <div className="text-center font-bold">{game.g}</div>
                      <div className="text-center font-bold">{game.a}</div>
                      <div className="text-center font-bold text-primary">{game.p}</div>
                      <div className={cn("text-center font-medium", game.pm > 0 ? "text-green-600" : game.pm < 0 ? "text-red-600" : "")}>
                        {game.pm > 0 ? '+' : ''}{game.pm}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* News Tab */}
          <TabsContent value="news" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  Latest News & Analysis
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <div className="flex justify-between items-start">
                    <h4 className="font-bold text-base">Exceptional performance in win against Lightning</h4>
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">2 hours ago</span>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {player.name} was a force to be reckoned with on Thursday, tallying a goal and an assist in a 4-2 victory. 
                    His line dominated possession metrics, and he looked dangerous every time he touched the puck. 
                    Fantasy managers should continue to start him with confidence as he rides a 5-game point streak.
                  </p>
                </div>
                
                <div className="space-y-2 border-t pt-4">
                  <div className="flex justify-between items-start">
                    <h4 className="font-bold text-base">Practice notes: Power play adjustments</h4>
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">Yesterday</span>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Head coach mentioned that {player.name} will be seeing some time on the top power-play unit moving forward, 
                    replacing an injured teammate. This should provide a significant boost to his fantasy value in the short term, 
                    especially with the upcoming schedule featuring several teams with weak penalty kills.
                  </p>
                </div>

                <div className="space-y-2 border-t pt-4">
                  <div className="flex justify-between items-start">
                    <h4 className="font-bold text-base">Season Outlook Update</h4>
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">Oct 15, 2024</span>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Projected to finish with 95+ points this season. His shooting percentage is slightly elevated, 
                    but his shot volume supports high production. A safe bet for top-tier production in all standard leagues.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Profile Tab */}
          <TabsContent value="profile" className="space-y-4 mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="overflow-hidden">
                <CardHeader className="bg-muted/30 py-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <User className="h-4 w-4" />
                    Bio
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y text-sm">
                    <div className="grid grid-cols-2 px-4 py-3 hover:bg-muted/5">
                      <span className="text-muted-foreground">Height</span>
                      <span className="font-medium text-right">{player.height ?? 'N/A'}</span>
                    </div>
                    <div className="grid grid-cols-2 px-4 py-3 hover:bg-muted/5">
                      <span className="text-muted-foreground">Weight</span>
                      <span className="font-medium text-right">{player.weight ?? 'N/A'}</span>
                    </div>
                    <div className="grid grid-cols-2 px-4 py-3 hover:bg-muted/5">
                      <span className="text-muted-foreground">Age</span>
                      <span className="font-medium text-right">{player.age ?? 'N/A'}</span>
                    </div>
                    <div className="grid grid-cols-2 px-4 py-3 hover:bg-muted/5">
                      <span className="text-muted-foreground">Experience</span>
                      <span className="font-medium text-right">{player.experience ?? 'N/A'}</span>
                    </div>
                    <div className="grid grid-cols-2 px-4 py-3 hover:bg-muted/5">
                      <span className="text-muted-foreground">Drafted</span>
                      <span className="font-medium text-right">2015, Round 1, #1 Overall</span>
                    </div>
                    <div className="grid grid-cols-2 px-4 py-3 hover:bg-muted/5">
                      <span className="text-muted-foreground">Birthplace</span>
                      <span className="font-medium text-right">Richmond Hill, ON, CAN</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="overflow-hidden">
                <CardHeader className="bg-muted/30 py-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Activity className="h-4 w-4" />
                    Status
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y text-sm">
                     <div className="grid grid-cols-2 px-4 py-3 hover:bg-muted/5">
                      <span className="text-muted-foreground">Team</span>
                      <span className="font-medium flex items-center justify-end gap-2">
                        {player.teamAbbreviation && <Badge variant="outline" className="h-5 px-1">{player.teamAbbreviation}</Badge>}
                        {player.team}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 px-4 py-3 hover:bg-muted/5">
                      <span className="text-muted-foreground">Position</span>
                      <span className="font-medium text-right">{player.position}</span>
                    </div>
                    <div className="grid grid-cols-2 px-4 py-3 hover:bg-muted/5">
                      <span className="text-muted-foreground">Jersey</span>
                      <span className="font-medium text-right">#{player.number}</span>
                    </div>
                    <div className="grid grid-cols-2 px-4 py-3 hover:bg-muted/5">
                      <span className="text-muted-foreground">Role</span>
                      <div className="text-right">
                        <Badge variant={player.starter ? "default" : "secondary"} className="h-5">
                          {player.starter ? "Starter" : "Bench"}
                        </Badge>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 px-4 py-3 hover:bg-muted/5">
                      <span className="text-muted-foreground">Health</span>
                      <div className="text-right">
                        {player.status ? (
                           <Badge variant={statusInfo?.variant || "outline"} className="h-5">
                            {statusInfo?.label || player.status}
                          </Badge>
                        ) : (
                           <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50 h-5">Healthy</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default PlayerStatsModal;
