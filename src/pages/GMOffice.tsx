import { useLeague } from '@/contexts/LeagueContext';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeftRight, Users, TrendingUp, Calendar, FileText, BarChart3, ListChecks, Bell } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Narwhal } from '@/components/icons/Narwhal';
import { HeadlinesBanner } from '@/components/gm-office/HeadlinesBanner';
import { RosterDepthWidget } from '@/components/gm-office/RosterDepthWidget';
import { isGuestMode } from '@/utils/guestHelpers';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';

const gmActions = [
  {
    title: "Stormy AI Assistant",
    description: "Get personalized advice and insights from your AI GM",
    icon: Narwhal,
    gradient: "from-primary to-secondary",
    link: "/gm-office/stormy",
    hasNewInsight: false // Will be dynamic later
  },
  {
    title: "Make a Trade",
    description: "Propose, negotiate, and view pending offers with league managers.",
    icon: ArrowLeftRight,
    gradient: "from-primary to-secondary",
    link: "/trade-analyzer"
  },
  {
    title: "Free Agents",
    description: "Browse and claim players. View Top 5 Adds.",
    icon: Users,
    gradient: "from-primary to-secondary",
    link: "/free-agents"
  },
  {
    title: "Team Analytics",
    description: "Deep dive into your team's performance metrics",
    icon: BarChart3,
    gradient: "from-primary to-secondary",
    link: "/team-analytics"
  },
  {
    title: "Waiver Wire",
    description: "Manage waiver claims and priorities",
    icon: TrendingUp,
    gradient: "from-primary to-secondary",
    link: "/waiver-wire"
  },
  {
    title: "Lineup Manager",
    description: "Set your daily lineups and plan for positional limits.",
    icon: Calendar,
    gradient: "from-primary to-secondary",
    link: "/schedule-manager"
  }
];

const GMOffice = () => {
  const { userLeagueState } = useLeague();
  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-background/95">
      <Navbar />
      <main className="pt-24 pb-16">
        <div className="container mx-auto px-4">
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Left Sidebar - Roster Depth Widget */}
            <aside className="lg:w-64 lg:flex-shrink-0 order-2 lg:order-1">
              <div className="lg:sticky lg:top-24">
                <RosterDepthWidget />
              </div>
            </aside>

            {/* Main Content */}
            <div className="flex-1 min-w-0 order-1 lg:order-2">
              <div className="max-w-3xl mx-auto text-center mb-8">
                <h1 className="text-4xl md:text-5xl font-bold mb-4 citrus-gradient-text">GM's Office</h1>
                <p className="text-lg text-muted-foreground">
                  Your command center for team management and strategy
                </p>
              </div>
              
              {/* Demo Mode Banner */}
              {isGuestMode(userLeagueState) && (
                <div className="max-w-3xl mx-auto mb-8">
                  <LeagueCreationCTA 
                    title="You're viewing demo GM Office"
                    description="Sign up to access all GM tools and manage your team."
                    variant="compact"
                  />
                </div>
              )}
              
              <div className="max-w-3xl mx-auto mb-8">
                <HeadlinesBanner />
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-3xl mx-auto">
                {gmActions.map((action, index) => (
                  <Link 
                    key={action.title} 
                    to={action.link}
                    className="group"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <Card className="h-full transition-all duration-300 hover:shadow-xl hover:scale-105 border-2 border-transparent hover:border-[#F9A436] cursor-pointer overflow-hidden relative">
                      <div className="absolute top-0 left-0 w-full h-32 bg-[#F9E076] opacity-10" />
                      <CardHeader className="relative">
                        <div className="relative">
                          <div className="w-16 h-16 rounded-2xl bg-[#F9E076] flex items-center justify-center mb-4 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300 shadow-lg">
                            <action.icon className="h-8 w-8" style={{ color: '#459345' }} strokeWidth={2.5} />
                          </div>
                          {action.hasNewInsight && (
                            <Badge className="absolute top-0 right-0 bg-[#459345] text-white text-xs">
                              New Insight
                            </Badge>
                          )}
                        </div>
                        <CardTitle className="text-xl group-hover:text-primary transition-colors">{action.title}</CardTitle>
                        <CardDescription className="text-sm mt-2">
                          {action.description}
                        </CardDescription>
                      </CardHeader>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};


export default GMOffice;
