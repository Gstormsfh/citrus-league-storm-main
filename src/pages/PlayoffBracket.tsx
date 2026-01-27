import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { MatchupService, Matchup } from '@/services/MatchupService';
import { LeagueService } from '@/services/LeagueService';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import LoadingScreen from '@/components/LoadingScreen';
import { useMinimumLoadingTime } from '@/hooks/useMinimumLoadingTime';

const PlayoffBracket = () => {
  const { leagueId } = useParams<{ leagueId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { userLeagueState, activeLeagueId } = useLeague();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bracketData, setBracketData] = useState<{
    rounds: Array<{
      roundNumber: number;
      roundName: string;
      matchups: Matchup[];
    }>;
    bracketSize: number;
  } | null>(null);
  const [teamNames, setTeamNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user || userLeagueState !== 'active-user' || !leagueId) {
      setLoading(false);
      return;
    }

    const loadBracketData = async () => {
      try {
        setLoading(true);
        setError(null);

        const { rounds, bracketSize, error: bracketError } = await MatchupService.getPlayoffBracket(leagueId);

        if (bracketError) throw bracketError;

        setBracketData({ rounds, bracketSize });

        // Get team names for display
        const { teams } = await LeagueService.getLeagueTeams(leagueId);
        const names: Record<string, string> = {};
        teams.forEach(team => {
          names[team.id] = team.team_name;
        });
        setTeamNames(names);

      } catch (err: any) {
        console.error('Error loading playoff bracket:', err);
        setError(err.message || 'Failed to load playoff bracket');
      } finally {
        setLoading(false);
      }
    };

    loadBracketData();
  }, [user, userLeagueState, leagueId]);

  // Apply minimum display time to prevent flash
  const displayLoading = useMinimumLoadingTime(loading, 800);

  if (displayLoading) {
    return (
      <LoadingScreen
        character="lemon"
        message="Loading Playoff Bracket..."
      />
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#D4E8B8]">
        <Navbar />
        <main className="w-full pt-28 pb-16 m-0 p-0">
          <div className="w-full m-0 p-0">
            {/* Sidebar, Content, and Notifications Grid - Sidebar at bottom on mobile, left on desktop; Notifications on right on desktop */}
            <div className="flex flex-col lg:grid lg:grid-cols-[240px_1fr_300px] lg:gap-8 lg:px-8 lg:mx-0 lg:w-screen lg:relative lg:left-1/2 lg:-translate-x-1/2">
              {/* Main Content - Scrollable - Appears first on mobile */}
              <div className="min-w-0 max-h-[calc(100vh-12rem)] overflow-y-auto px-2 lg:px-6 order-1 lg:order-2">
                <div className="text-center py-20">
                  <p className="text-destructive text-lg">{error}</p>
                  <Button
                    onClick={() => leagueId && navigate(`/matchup/${leagueId}/1`)}
                    className="mt-4"
                  >
                    Back to Regular Season
                  </Button>
                </div>
              </div>
              <aside className="w-full lg:w-auto order-2 lg:order-1">
                <div className="lg:sticky lg:top-32 space-y-4 lg:space-y-6">
                  <AdSpace size="300x250" label="Bracket Sponsor" />
                </div>
              </aside>
              {userLeagueState === 'active-user' && (activeLeagueId || leagueId) && (
                <aside className="hidden lg:block order-3">
                  <div className="lg:sticky lg:top-32 h-[calc(100vh-12rem)] bg-card border rounded-lg shadow-sm overflow-hidden">
                    <LeagueNotifications leagueId={activeLeagueId || leagueId || ''} />
                  </div>
                </aside>
              )}
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (!bracketData || bracketData.rounds.length === 0) {
    return (
      <div className="min-h-screen bg-[#D4E8B8]">
        <Navbar />
        <main className="w-full pt-28 pb-16 m-0 p-0">
          <div className="w-full m-0 p-0">
            {/* Sidebar, Content, and Notifications Grid - Sidebar at bottom on mobile, left on desktop; Notifications on right on desktop */}
          <div className="flex flex-col lg:grid lg:grid-cols-[240px_1fr_300px]">
              {/* Main Content - Scrollable - Appears first on mobile */}
              <div className="min-w-0 max-h-[calc(100vh-12rem)] overflow-y-auto px-2 lg:px-6 order-1 lg:order-2">
                <div className="text-center py-20">
                  <h1 className="text-2xl font-bold mb-4">Playoff Bracket</h1>
                  <p className="text-muted-foreground mb-4">Playoff matchups have not been generated yet.</p>
                  <Button
                    onClick={() => leagueId && navigate(`/matchup/${leagueId}/1`)}
                  >
                    Back to Regular Season
                  </Button>
                </div>
              </div>
              <aside className="w-full lg:w-auto order-2 lg:order-1">
                <div className="lg:sticky lg:top-32 space-y-4 lg:space-y-6">
                  <AdSpace size="300x250" label="Bracket Sponsor" />
                  <AdSpace size="300x250" label="Fantasy Partner" />
                </div>
              </aside>
              {userLeagueState === 'active-user' && (activeLeagueId || leagueId) && (
                <aside className="hidden lg:block order-3">
                  <div className="lg:sticky lg:top-32 h-[calc(100vh-12rem)] bg-card border rounded-lg shadow-sm overflow-hidden">
                    <LeagueNotifications leagueId={activeLeagueId || leagueId || ''} />
                  </div>
                </aside>
              )}
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="w-full pt-28 pb-16 m-0 p-0">
        <div className="w-full m-0 p-0">
          {/* Sidebar, Content, and Notifications Grid - Sidebar at bottom on mobile, left on desktop; Notifications on right on desktop */}
          <div className="flex flex-col lg:grid lg:grid-cols-[240px_1fr_300px]">
            {/* Main Content - Scrollable - Appears first on mobile */}
            <div className="min-w-0 max-h-[calc(100vh-12rem)] overflow-y-auto px-2 lg:px-6 order-1 lg:order-2">
              <div className="mb-6">
                <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-fantasy-primary to-fantasy-secondary bg-clip-text text-transparent">
                  Playoff Bracket
                </h1>
                <p className="text-muted-foreground">Tournament bracket for {bracketData.bracketSize} teams</p>
              </div>

              <div className="space-y-8">
                {bracketData.rounds.map((round) => (
                  <Card key={round.roundNumber} className="border-fantasy-primary/20">
                    <CardHeader>
                      <CardTitle className="text-xl font-bold text-fantasy-primary">
                        {round.roundName}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {round.matchups.map((matchup) => (
                          <Card
                            key={matchup.id}
                            className="border-l-4 border-fantasy-secondary/40 bg-fantasy-secondary/5"
                          >
                            <CardContent className="p-4">
                              <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                  <span className="font-medium text-sm">
                                    {teamNames[matchup.team1_id] || `Team ${matchup.team1_id}`}
                                  </span>
                                  <span className="text-lg font-bold text-fantasy-secondary">
                                    {matchup.team1_score}
                                  </span>
                                </div>
                                {matchup.team2_id ? (
                                  <div className="flex justify-between items-center">
                                    <span className="font-medium text-sm">
                                      {teamNames[matchup.team2_id] || `Team ${matchup.team2_id}`}
                                    </span>
                                    <span className="text-lg font-bold text-[hsl(var(--vibrant-orange))]">
                                      {matchup.team2_score}
                                    </span>
                                  </div>
                                ) : (
                                  <div className="text-sm text-muted-foreground italic">Bye Week</div>
                                )}
                                <div className="text-xs text-muted-foreground mt-2 pt-2 border-t">
                                  Week {matchup.week_number} • {matchup.status}
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="mt-8">
                <Button
                  onClick={() => leagueId && navigate(`/matchup/${leagueId}/1`)}
                  variant="outline"
                >
                  Back to Regular Season
                </Button>
              </div>
            </div>

            {/* Left Sidebar - At bottom on mobile, left on desktop */}
            <aside className="w-full lg:w-auto order-2 lg:order-1">
              <div className="lg:sticky lg:top-32 space-y-4 lg:space-y-6">
                <AdSpace size="300x250" label="Bracket Sponsor" />
                <AdSpace size="300x250" label="Fantasy Partner" />
              </div>
            </aside>

            {/* Right Sidebar - Notifications (hidden on mobile) */}
            {userLeagueState === 'active-user' && (activeLeagueId || leagueId) && (
              <aside className="hidden lg:block order-3">
                <div className="lg:sticky lg:top-32 h-[calc(100vh-12rem)] bg-card border rounded-lg shadow-sm overflow-hidden">
                  <LeagueNotifications leagueId={activeLeagueId || leagueId || ''} />
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

export default PlayoffBracket;

