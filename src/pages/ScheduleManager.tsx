import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar, Trophy, Users, ArrowRight, Clock } from 'lucide-react';
import { CitrusBackground } from '@/components/CitrusBackground';
import { CitrusSparkle, CitrusLeaf } from '@/components/icons/CitrusIcons';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

const ScheduleManager = () => {
  const { user } = useAuth();
  const { activeLeagueId } = useLeague();
  const [viewMode, setViewMode] = useState<'summary' | 'full'>('summary');
  const [nhlGames, setNhlGames] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [myRoster, setMyRoster] = useState<any[]>([]);

  useEffect(() => {
    loadScheduleData();
  }, [user, activeLeagueId]);

  const loadScheduleData = async () => {
    setLoading(true);
    try {
      // Load this week's NHL games
      const today = new Date();
      const nextWeek = new Date(today);
      nextWeek.setDate(nextWeek.getDate() + 7);

      const { data: games } = await supabase
        .from('nhl_games')
        .select('*')
        .gte('game_date', today.toISOString().split('T')[0])
        .lte('game_date', nextWeek.toISOString().split('T')[0])
        .order('game_date', { ascending: true })
        .order('start_time_utc', { ascending: true });

      setNhlGames(games || []);

      // Load user's roster if logged in
      if (user && activeLeagueId) {
        const { data: team } = await supabase
          .from('teams')
          .select('id')
          .eq('league_id', activeLeagueId)
          .eq('owner_id', user.id)
          .maybeSingle();

        if (team) {
          const { data: roster } = await supabase
            .from('team_lineups')
            .select(`
              player_id,
              roster_slot,
              player_directory!inner(id, first_name, last_name, position, current_team_abbrev)
            `)
            .eq('team_id', team.id)
            .eq('league_id', activeLeagueId);

          setMyRoster(roster || []);
        }
      }
    } catch (error) {
      console.error('Error loading schedule data:', error);
    } finally {
      setLoading(false);
    }
  };

  const upcomingMatchups = [
    { week: "Week 12", opponent: "Ice Warriors", date: "Dec 28 - Jan 3", status: "upcoming", projection: "145.2 - 138.5" },
    { week: "Week 13", opponent: "Frozen Fury", date: "Jan 4 - Jan 10", status: "upcoming", projection: "140.1 - 142.8" },
    { week: "Week 14", opponent: "Blizzard Kings", date: "Jan 11 - Jan 17", status: "upcoming", projection: "155.0 - 130.2" },
    { week: "Week 15", opponent: "Avalanche Elite", date: "Jan 18 - Jan 24", status: "upcoming", projection: "138.9 - 139.1" }
  ];

  const recentResults = [
    { week: "Week 11", opponent: "Puck Dynasty", score: "145-132", result: "win" },
    { week: "Week 10", opponent: "Hockey Legends", score: "128-138", result: "loss" },
    { week: "Week 9", opponent: "Goal Crushers", score: "156-142", result: "win" },
    { week: "Week 8", opponent: "Zamboni Drivers", score: "130-110", result: "win" },
    { week: "Week 7", opponent: "Net Minders", score: "115-125", result: "loss" }
  ];

  const currentMatchup = upcomingMatchups[0];

  return (
    <div className="min-h-screen bg-background flex flex-col relative overflow-hidden">
      <CitrusBackground density="medium" />
      <Navbar />
      <main className="flex-1 pt-24 pb-16 relative z-10">
        <div className="container mx-auto px-4">
          <div className="max-w-6xl mx-auto">
            <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4 relative">
              <CitrusLeaf className="absolute -top-4 -left-8 w-16 h-16 text-citrus-sage/15 rotate-12" />
              <div className="text-center md:text-left">
                <div className="flex items-center justify-center md:justify-start gap-3 mb-2">
                  <Calendar className="w-8 h-8 text-citrus-orange" />
                  <h1 className="text-4xl font-varsity font-black text-citrus-forest uppercase tracking-tight">Schedule Manager</h1>
                  <CitrusSparkle className="w-6 h-6 text-citrus-sage animate-pulse" />
                </div>
                <p className="text-lg font-display text-citrus-charcoal">
                  View upcoming NHL games and plan your lineup
                </p>
              </div>
              
              {viewMode === 'summary' ? (
                <Button onClick={() => setViewMode('full')} className="bg-gradient-to-br from-citrus-sage to-citrus-orange border-4 border-citrus-forest rounded-varsity shadow-patch font-varsity font-bold uppercase">
                  See Full Schedule
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setViewMode('summary')} className="border-2 border-citrus-sage rounded-varsity font-varsity">
                  Back to Summary
                </Button>
              )}
            </div>

            {/* NHL Games This Week */}
            <Card className="mb-8 bg-citrus-cream corduroy-texture border-4 border-citrus-forest rounded-[2rem] shadow-patch">
              <CardHeader>
                <CardTitle className="font-varsity font-black text-citrus-forest uppercase flex items-center gap-2">
                  <Clock className="w-5 h-5 text-citrus-orange" />
                  NHL Games This Week
                </CardTitle>
                <CardDescription className="font-display text-citrus-charcoal">
                  {loading ? 'Loading schedule...' : `${nhlGames.length} games scheduled`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="text-center py-8 font-display text-citrus-charcoal">Loading games...</div>
                ) : nhlGames.length > 0 ? (
                  <div className="space-y-3">
                    {nhlGames.slice(0, 10).map((game, idx) => (
                      <div key={game.id || idx} className="flex items-center justify-between p-4 bg-gradient-to-r from-citrus-sage/10 to-citrus-peach/10 rounded-varsity border-2 border-citrus-sage/30">
                        <div className="flex-1">
                          <div className="flex items-center gap-4">
                            <Badge className="bg-citrus-orange text-citrus-cream font-varsity font-bold">
                              {format(new Date(game.game_date), 'MMM d')}
                            </Badge>
                            <div className="font-varsity font-bold text-citrus-forest">
                              {game.away_team_abbrev} @ {game.home_team_abbrev}
                            </div>
                          </div>
                          <div className="text-sm font-display text-citrus-charcoal mt-1">
                            {game.start_time_utc && format(new Date(game.start_time_utc), 'h:mm a')}
                          </div>
                        </div>
                        <Badge variant="outline" className="font-mono text-xs border-citrus-sage">
                          {game.game_status || 'Scheduled'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 font-display text-citrus-charcoal">
                    No games scheduled this week
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Summary View */}
            {viewMode === 'summary' && (
              <div className="grid md:grid-cols-2 gap-8">
                {/* Next Matchup Highlight */}
                <Card className="border-primary/20 bg-gradient-to-br from-background to-primary/5">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-primary">
                      <Calendar className="h-5 w-5" />
                      Next Matchup
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-col items-center justify-center py-6">
                      <div className="text-xl font-semibold mb-2">{currentMatchup.week}</div>
                      <div className="text-3xl font-bold mb-4">vs {currentMatchup.opponent}</div>
                      <div className="text-muted-foreground mb-6">{currentMatchup.date}</div>
                      
                      <div className="w-full bg-background/50 rounded-lg p-4 border flex justify-between items-center">
                        <div className="text-center">
                          <div className="text-xs text-muted-foreground uppercase">Your Proj</div>
                          <div className="font-bold text-lg text-green-600">145.2</div>
                        </div>
                        <div className="text-xs text-muted-foreground">vs</div>
                        <div className="text-center">
                          <div className="text-xs text-muted-foreground uppercase">Opp Proj</div>
                          <div className="font-bold text-lg text-red-600">138.5</div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Quick Stats & Last Result */}
                <div className="space-y-6">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">Current Record</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-4xl font-bold">8-3-0</div>
                      <p className="text-sm text-muted-foreground mt-1">2nd in Division • 94% Playoff Odds</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <Trophy className="h-4 w-4" />
                        Last Result ({recentResults[0].week})
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex justify-between items-center">
                        <div>
                          <div className="font-semibold text-lg">vs {recentResults[0].opponent}</div>
                          <div className="text-sm text-muted-foreground">{recentResults[0].score}</div>
                        </div>
                        <div className="px-3 py-1 bg-green-100 text-green-700 rounded-full font-bold text-sm">
                          WIN
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

            {/* Full View */}
            {viewMode === 'full' && (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Calendar className="h-5 w-5" />
                      Upcoming Schedule
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {upcomingMatchups.map((matchup, index) => (
                        <div key={index} className="flex items-center justify-between p-4 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors">
                          <div className="flex items-center gap-4">
                            <Users className="h-5 w-5 text-primary" />
                            <div>
                              <div className="font-semibold">{matchup.week}</div>
                              <div className="text-sm text-muted-foreground">vs {matchup.opponent}</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-medium">{matchup.projection}</div>
                            <div className="text-xs text-muted-foreground">{matchup.date}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Trophy className="h-5 w-5" />
                      Past Results
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {recentResults.map((result, index) => (
                        <div key={index} className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                          <div className="flex items-center gap-4">
                            <div className={`w-2 h-12 rounded ${result.result === 'win' ? 'bg-green-500' : 'bg-red-500'}`} />
                            <div>
                              <div className="font-semibold">{result.week}</div>
                              <div className="text-sm text-muted-foreground">vs {result.opponent}</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-semibold">{result.score}</div>
                            <div className={`text-sm ${result.result === 'win' ? 'text-green-600' : 'text-red-600'}`}>
                              {result.result === 'win' ? 'Win' : 'Loss'}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default ScheduleManager;
