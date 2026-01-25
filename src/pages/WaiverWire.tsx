import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Search, Clock, AlertCircle, CheckCircle2, XCircle, User, Trophy } from 'lucide-react';
import { isGuestMode } from '@/utils/guestHelpers';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import { CitrusBackground } from '@/components/CitrusBackground';
import { CitrusSparkle, CitrusLeaf, CitrusWedge } from '@/components/icons/CitrusIcons';
import { WaiverService, type WaiverClaim, type WaiverPriority } from '@/services/WaiverService';
import { PlayerService, type Player } from '@/services/PlayerService';
import { LeagueService } from '@/services/LeagueService';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { AdSpace } from '@/components/AdSpace';
import LeagueNotifications from '@/components/matchup/LeagueNotifications';

const WaiverWire = () => {
  const { user } = useAuth();
  const { userLeagueState, activeLeagueId } = useLeague();
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(true);
  const [waiverClaims, setWaiverClaims] = useState<WaiverClaim[]>([]);
  const [claimPlayers, setClaimPlayers] = useState<Map<number, Player>>(new Map());
  const [waiverPriority, setWaiverPriority] = useState<WaiverPriority[]>([]);
  const [myTeamId, setMyTeamId] = useState<string | null>(null);
  const [myPriority, setMyPriority] = useState<number | null>(null);
  const [waiverSettings, setWaiverSettings] = useState<any>(null);
  const [teamCount, setTeamCount] = useState<number>(0);
  
  // Available players search
  const [searchTerm, setSearchTerm] = useState('');
  const [positionFilter, setPositionFilter] = useState<string>('all');
  const [availablePlayers, setAvailablePlayers] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  
  // Claim submission
  const [selectedPlayer, setSelectedPlayer] = useState<any | null>(null);
  const [dropPlayer, setDropPlayer] = useState<number | null>(null);
  const [myRoster, setMyRoster] = useState<any[]>([]);

  // Load data on mount
  useEffect(() => {
    if (user && activeLeagueId) {
      loadWaiverData();
    } else {
      setLoading(false);
    }
  }, [user, activeLeagueId]);

  const loadWaiverData = async () => {
    if (!user || !activeLeagueId) return;
    
    setLoading(true);
    try {
      // Get user's team
      const { data: team } = await supabase
        .from('teams')
        .select('id')
        .eq('league_id', activeLeagueId)
        .eq('owner_id', user.id)
        .maybeSingle();

      if (team) {
        setMyTeamId(team.id);

        // Load waiver claims
        const claims = await WaiverService.getTeamWaiverClaims(activeLeagueId, team.id);
        setWaiverClaims(claims);

        // Fetch player details for claims
        if (claims.length > 0) {
          const playerIds = new Set<number>();
          claims.forEach(claim => {
            playerIds.add(claim.player_id);
            if (claim.drop_player_id) {
              playerIds.add(claim.drop_player_id);
            }
          });

          if (playerIds.size > 0) {
            const playerIdStrings = Array.from(playerIds).map(id => String(id));
            const players = await PlayerService.getPlayersByIds(playerIdStrings);
            const playerMap = new Map<number, Player>();
            players.forEach(p => {
              playerMap.set(Number(p.id), p);
            });
            setClaimPlayers(playerMap);
          } else {
            setClaimPlayers(new Map());
          }
        } else {
          setClaimPlayers(new Map());
        }

        // Load roster for drop selection (team_lineups uses JSONB arrays)
        const { data: lineup } = await supabase
          .from('team_lineups')
          .select('starters, bench, ir')
          .eq('team_id', team.id)
          .eq('league_id', activeLeagueId)
          .maybeSingle();
        
        if (lineup) {
          // Get all player IDs from JSONB arrays
          const allPlayerIds: string[] = [
            ...((lineup.starters as string[]) || []),
            ...((lineup.bench as string[]) || []),
            ...((lineup.ir as string[]) || [])
          ].filter(id => id && !isNaN(Number(id)));

          if (allPlayerIds.length > 0) {
            // Use PlayerService to get player details (handles all data correctly)
            const players = await PlayerService.getPlayersByIds(allPlayerIds);
            // Map to the expected format
            const rosterPlayers = players.map(p => ({
              player_id: Number(p.id),
              full_name: p.full_name,
              position_code: p.position,
              team_abbrev: p.team
            }));
            setMyRoster(rosterPlayers);
          } else {
            setMyRoster([]);
          }
        } else {
          setMyRoster([]);
        }
      }

      // Load league to get team count
      const { league, error: leagueError } = await LeagueService.getLeague(activeLeagueId, user.id);
      const maxTeams = league?.settings?.teamsCount || 12;

      // Get actual team count from teams table (more reliable than waiver_priority length)
      const { data: teams, error: teamsError } = await supabase
        .from('teams')
        .select('id')
        .eq('league_id', activeLeagueId);
      const actualTeamCount = teams?.length || 0;
      setTeamCount(actualTeamCount);

      // Load waiver priority
      const priority = await WaiverService.getWaiverPriority(activeLeagueId);
      setWaiverPriority(priority);
      
      // Find user's priority
      const myPrio = priority.find(p => p.team_id === team?.id);
      
      // If no priority record exists, create one (for existing teams that predate the trigger)
      if (team && !myPrio && actualTeamCount > 0) {
        try {
          console.log('Creating waiver priority for team:', team.id, 'in league:', activeLeagueId);
          // Use RPC function to create priority (bypasses RLS)
          const { data: rpcResult, error: rpcError } = await supabase
            .rpc('create_waiver_priority_for_team', {
              p_league_id: activeLeagueId,
              p_team_id: team.id
            });
          
          console.log('RPC result:', rpcResult, 'RPC error:', rpcError);
          
          if (!rpcError && rpcResult && rpcResult.length > 0) {
            const result = rpcResult[0];
            console.log('RPC result data:', result);
            if (result.success && result.priority) {
              // Reload priority after creating
              const updatedPriority = await WaiverService.getWaiverPriority(activeLeagueId);
              setWaiverPriority(updatedPriority);
              const newMyPrio = updatedPriority.find(p => p.team_id === team.id);
              console.log('New priority after reload:', newMyPrio);
              if (newMyPrio && newMyPrio.priority > 0 && newMyPrio.priority <= actualTeamCount) {
                setMyPriority(newMyPrio.priority);
              } else {
                console.warn('Created priority but validation failed:', newMyPrio, 'actualTeamCount:', actualTeamCount);
                setMyPriority(result.priority); // Use the priority from RPC result
              }
            } else {
              console.error('RPC returned error:', result.error_message);
              setMyPriority(null);
            }
          } else {
            console.error('Error calling create_waiver_priority_for_team:', rpcError);
            setMyPriority(null);
          }
        } catch (error) {
          console.error('Error creating waiver priority:', error);
          setMyPriority(null);
        }
      } else {
        console.log('Priority check:', { 
          hasTeam: !!team, 
          hasPrio: !!myPrio, 
          teamCount: actualTeamCount,
          myPrio 
        });
        // Validate priority is within valid range
        const validPriority = myPrio && 
          myPrio.priority > 0 && 
          myPrio.priority <= actualTeamCount 
          ? myPrio.priority 
          : null;
        setMyPriority(validPriority);
      }

      // Load league waiver settings
      const settings = await WaiverService.getLeagueWaiverSettings(activeLeagueId, user.id);
      setWaiverSettings(settings);

    } catch (error) {
      console.error('Error loading waiver data:', error);
    } finally {
      setLoading(false);
    }
  };

  const searchPlayers = async () => {
    if (!activeLeagueId) return;
    
    setSearchLoading(true);
    try {
      const players = await WaiverService.getAvailablePlayers(
        activeLeagueId,
        positionFilter === 'all' ? undefined : positionFilter || undefined,
        searchTerm || undefined
      );
      setAvailablePlayers(players);
    } catch (error) {
      console.error('Error searching players:', error);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSubmitClaim = async () => {
    if (!selectedPlayer || !myTeamId || !activeLeagueId) return;

    // Use smart addPlayer function that handles both free agent and waiver claims
    const result = await WaiverService.addPlayer(
      activeLeagueId,
      myTeamId,
      selectedPlayer.player_id,
      dropPlayer
    );

    if (result.success) {
      if (result.isFreeAgent) {
        toast({
          title: "Player Added",
          description: `${selectedPlayer.full_name} added to your roster immediately`,
        });
      } else {
        toast({
          title: "Waiver Claim Submitted",
          description: `Claim for ${selectedPlayer.full_name} submitted. Will process at 3:00 AM EST.`,
        });
      }
      setSelectedPlayer(null);
      setDropPlayer(null);
      loadWaiverData();
    } else {
      toast({
        title: result.isFreeAgent === false ? "Claim Failed" : "Add Failed",
        description: result.error,
        variant: "destructive"
      });
    }
  };

  const handleCancelClaim = async (claimId: string) => {
    const result = await WaiverService.cancelWaiverClaim(claimId);
    
    if (result.success) {
      toast({
        title: "Claim Cancelled",
        description: "Waiver claim has been cancelled",
      });
      loadWaiverData();
    } else {
      toast({
        title: "Cancellation Failed",
        description: result.error,
        variant: "destructive"
      });
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col relative overflow-hidden">
      <CitrusBackground density="light" />
      
      <Navbar />
      <main className="w-full pt-28 pb-16 m-0 p-0">
        <div className="w-full m-0 p-0">
          {/* Sidebar, Content, and Notifications Grid - Sidebar at bottom on mobile, left on desktop; Notifications on right on desktop */}
          <div className="flex flex-col lg:grid lg:grid-cols-[240px_1fr_300px] lg:gap-8 lg:px-8 lg:mx-0 lg:w-screen lg:relative lg:left-1/2 lg:-translate-x-1/2">
            {/* Main Content - Scrollable - Appears first on mobile */}
            <div className="min-w-0 max-h-[calc(100vh-12rem)] overflow-y-auto px-2 lg:px-4 order-1 lg:order-2">
              <div className="text-center mb-12 relative">
              <CitrusLeaf className="absolute -top-4 -left-8 w-16 h-16 text-citrus-sage/15 rotate-12" />
              <CitrusWedge className="absolute -top-2 -right-6 w-14 h-14 text-citrus-orange/15 -rotate-45" />
              
              <div className="flex items-center justify-center gap-3 mb-4">
                <Trophy className="w-10 h-10 text-citrus-orange" />
                <h1 className="text-4xl md:text-5xl font-varsity font-black text-citrus-forest uppercase tracking-tight">Waiver Wire</h1>
                <Trophy className="w-10 h-10 text-citrus-sage" />
              </div>
              <p className="text-lg font-display text-citrus-charcoal">
                Manage waiver claims and priorities
              </p>
            </div>

            {/* Demo Mode Banner */}
            {isGuestMode(userLeagueState) && (
              <div className="mb-8">
                <LeagueCreationCTA 
                  title="You're viewing demo waiver wire"
                  description="Sign up to manage waiver claims and priorities for your team."
                  variant="compact"
                />
              </div>
            )}

            {/* Waiver Priority & Settings */}
            <div className="grid md:grid-cols-2 gap-6 mb-8">
              <Card className="bg-citrus-cream corduroy-texture border-4 border-citrus-sage rounded-varsity shadow-patch relative overflow-hidden">
                <CitrusSparkle className="absolute top-2 right-2 w-12 h-12 text-citrus-sage/10" />
                <CardHeader className="relative z-10">
                  <CardTitle className="font-varsity font-black text-citrus-forest uppercase flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-citrus-orange" />
                    Your Waiver Priority
                  </CardTitle>
                </CardHeader>
                <CardContent className="relative z-10">
                  {loading ? (
                    <div className="text-center py-4 font-display">Loading...</div>
                  ) : myPriority ? (
                    <div className="text-center">
                      <div className="text-6xl font-varsity font-black text-citrus-orange mb-2">
                        #{myPriority}
                      </div>
                      <p className="text-sm font-display text-citrus-charcoal">
                        of {teamCount || waiverPriority.length} teams
                      </p>
                    </div>
                  ) : (
                    <div className="text-center py-4 font-display text-citrus-charcoal">
                      Priority not set
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="bg-citrus-cream corduroy-texture border-4 border-citrus-orange rounded-varsity shadow-patch relative overflow-hidden">
                <CitrusLeaf className="absolute top-2 right-2 w-12 h-12 text-citrus-orange/10 rotate-12" />
                <CardHeader className="relative z-10">
                  <CardTitle className="font-varsity font-black text-citrus-forest uppercase flex items-center gap-2">
                    <Clock className="w-5 h-5 text-citrus-sage" />
                    Waiver Settings
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 relative z-10">
                  <div className="flex items-center justify-between p-3 bg-citrus-sage/10 rounded-varsity border-2 border-citrus-sage/30">
                    <span className="text-sm font-display text-citrus-charcoal">Process Time</span>
                    <span className="font-varsity font-bold text-citrus-forest">
                      {waiverSettings?.waiver_process_time || '3:00 AM'} EST
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-citrus-peach/10 rounded-varsity border-2 border-citrus-peach/30">
                    <span className="text-sm font-display text-citrus-charcoal">Waiver Period</span>
                    <span className="font-varsity font-bold text-citrus-forest">
                      {waiverSettings?.waiver_period_hours || 48} hours
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-citrus-orange/10 rounded-varsity border-2 border-citrus-orange/30">
                    <span className="text-sm font-display text-citrus-charcoal">Game Lock</span>
                    <Badge className={`${waiverSettings?.waiver_game_lock ? 'bg-citrus-sage' : 'bg-citrus-charcoal'} text-citrus-cream font-varsity`}>
                      {waiverSettings?.waiver_game_lock ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Search Available Players */}
            <Card className="mb-8 bg-citrus-cream corduroy-texture border-4 border-citrus-forest rounded-[2rem] shadow-patch">
              <CardHeader>
                <CardTitle className="font-varsity font-black text-citrus-forest uppercase flex items-center gap-2">
                  <Search className="w-5 h-5 text-citrus-orange" />
                  Search Available Players
                </CardTitle>
                <CardDescription className="font-display text-citrus-charcoal">
                  Find players to add via waiver claim
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col md:flex-row gap-3 mb-6">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-citrus-charcoal/50" />
                    <Input 
                      placeholder="Search by player name..." 
                      className="pl-10 border-3 border-citrus-sage rounded-varsity bg-citrus-cream font-display h-12"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && searchPlayers()}
                    />
                  </div>
                  <Select value={positionFilter} onValueChange={setPositionFilter}>
                    <SelectTrigger className="w-full md:w-[180px] border-3 border-citrus-sage rounded-varsity bg-citrus-cream font-display h-12">
                      <SelectValue placeholder="All Positions" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Positions</SelectItem>
                      <SelectItem value="C">Center</SelectItem>
                      <SelectItem value="LW">Left Wing</SelectItem>
                      <SelectItem value="RW">Right Wing</SelectItem>
                      <SelectItem value="D">Defense</SelectItem>
                      <SelectItem value="G">Goalie</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button 
                    onClick={searchPlayers}
                    disabled={searchLoading}
                    className="bg-gradient-to-br from-citrus-sage to-citrus-orange border-4 border-citrus-forest rounded-varsity shadow-patch font-varsity font-bold uppercase h-12"
                  >
                    {searchLoading ? 'Searching...' : 'Search'}
                  </Button>
                </div>

                {availablePlayers.length > 0 && (
                  <div className="space-y-3">
                    {availablePlayers.map((player) => (
                      <div key={player.player_id} className="flex items-center justify-between p-4 bg-citrus-sage/10 rounded-varsity border-2 border-citrus-sage/30 hover:border-citrus-orange hover:shadow-patch transition-all">
                        <div className="flex-1">
                          <div className="font-varsity font-bold text-citrus-forest">
                            {player.full_name}
                          </div>
                          <div className="text-sm font-display text-citrus-charcoal">
                            {player.position_code} - {player.team_abbrev} #{player.jersey_number}
                          </div>
                        </div>
                        <Button 
                          onClick={() => setSelectedPlayer(player)}
                          size="sm"
                          className="bg-citrus-orange border-2 border-citrus-forest rounded-varsity font-varsity font-bold"
                        >
                          Claim
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Active Waiver Claims */}
            <Card className="bg-citrus-cream corduroy-texture border-4 border-citrus-forest rounded-[2rem] shadow-patch">
              <CardHeader>
                <CardTitle className="font-varsity font-black text-citrus-forest uppercase flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-citrus-orange" />
                  Active Waiver Claims
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="text-center py-12 font-display text-citrus-charcoal">
                    Loading claims...
                  </div>
                ) : waiverClaims.length > 0 ? (
                  <div className="space-y-4">
                    {waiverClaims.map((claim) => {
                      const player = claimPlayers.get(claim.player_id);
                      const dropPlayer = claim.drop_player_id ? claimPlayers.get(claim.drop_player_id) : null;
                      
                      return (
                        <div key={claim.id} className="flex items-center justify-between p-4 bg-gradient-to-r from-citrus-peach/20 to-citrus-orange/20 rounded-varsity border-3 border-citrus-orange/50">
                          <div className="flex-1">
                            <div className="font-varsity font-bold text-citrus-forest">
                              {player?.full_name || `Player #${claim.player_id}`}
                            </div>
                            <div className="text-sm font-display text-citrus-charcoal space-y-1">
                              {player && (
                                <div>
                                  {player.position} • {player.team}
                                </div>
                              )}
                              {dropPlayer && (
                                <div className="text-citrus-orange/80">
                                  Dropping: {dropPlayer.full_name} ({dropPlayer.position} • {dropPlayer.team})
                                </div>
                              )}
                              <div>
                                Priority #{claim.priority}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <Badge className="bg-citrus-sage text-citrus-cream font-varsity font-bold">
                              {claim.status}
                            </Badge>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => handleCancelClaim(claim.id)}
                              className="border-2 border-citrus-forest rounded-varsity font-varsity"
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <User className="w-16 h-16 text-citrus-sage/30 mx-auto mb-4" />
                    <p className="font-display text-citrus-charcoal">No active waiver claims</p>
                  </div>
                )}
              </CardContent>
            </Card>
            </div>

            {/* Left Sidebar - At bottom on mobile, left on desktop */}
            <aside className="w-full lg:w-auto order-2 lg:order-1">
              <div className="lg:sticky lg:top-32 space-y-4 lg:space-y-6">
                <AdSpace size="300x250" label="Waiver Sponsor" />
                <AdSpace size="300x250" label="Fantasy Partner" />
              </div>
            </aside>

            {/* Right Sidebar - Notifications (hidden on mobile) */}
            {userLeagueState === 'active-user' && activeLeagueId && (
              <aside className="hidden lg:block order-3">
                <div className="lg:sticky lg:top-32 h-[calc(100vh-12rem)] bg-card border rounded-lg shadow-sm overflow-hidden">
                  <LeagueNotifications leagueId={activeLeagueId} />
                </div>
              </aside>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default WaiverWire;
