import { useState } from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calendar, Trophy, Users, ArrowRight } from 'lucide-react';

const ScheduleManager = () => {
  const [viewMode, setViewMode] = useState<'summary' | 'full'>('summary');

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
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <main className="flex-1 pt-24 pb-16">
        <div className="container mx-auto px-4">
          <div className="max-w-5xl mx-auto">
            <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
              <div className="text-center md:text-left">
                <h1 className="text-4xl font-bold">Schedule Manager</h1>
                <p className="text-lg text-muted-foreground">
                  View upcoming matchups and plan your lineup
                </p>
              </div>
              
              {viewMode === 'summary' ? (
                <Button onClick={() => setViewMode('full')}>See Full Schedule</Button>
              ) : (
                <Button variant="outline" onClick={() => setViewMode('summary')}>Back to Summary</Button>
              )}
            </div>

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
