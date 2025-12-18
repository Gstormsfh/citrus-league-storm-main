import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Clock } from 'lucide-react';

const WaiverWire = () => {
  const waiverClaims = [
    { player: "Connor McDavid", position: "C", team: "EDM", claimPriority: 1, processDate: "Dec 28, 2025" },
    { player: "Auston Matthews", position: "C", team: "TOR", claimPriority: 3, processDate: "Dec 29, 2025" },
    { player: "David Pastrnak", position: "RW", team: "BOS", claimPriority: 5, processDate: "Dec 30, 2025" }
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <main className="flex-1 pt-24 pb-16">
        <div className="container mx-auto px-4">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-12">
              <h1 className="text-4xl md:text-5xl font-bold mb-4">Waiver Wire</h1>
              <p className="text-lg text-muted-foreground">
                Manage waiver claims and priorities
              </p>
            </div>

            <Card className="mb-8">
              <CardHeader>
                <CardTitle>Your Waiver Priority: #2</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  <span>Waivers process daily at 3:00 AM EST</span>
                </div>
              </CardContent>
            </Card>

            <Card className="mb-8">
              <CardHeader>
                <CardTitle>Search Available Players</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search by player name..." className="pl-10" />
                  </div>
                  <Button>Search</Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Active Waiver Claims</CardTitle>
              </CardHeader>
              <CardContent>
                {waiverClaims.length > 0 ? (
                  <div className="space-y-4">
                    {waiverClaims.map((claim, index) => (
                      <div key={index} className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                        <div className="flex-1">
                          <div className="font-semibold">{claim.player}</div>
                          <div className="text-sm text-muted-foreground">
                            {claim.position} - {claim.team}
                          </div>
                        </div>
                        <div className="flex items-center gap-6">
                          <div className="text-right">
                            <div className="text-sm font-medium">Priority #{claim.claimPriority}</div>
                            <div className="text-xs text-muted-foreground">{claim.processDate}</div>
                          </div>
                          <Button variant="outline" size="sm">Cancel</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    No active waiver claims
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default WaiverWire;
