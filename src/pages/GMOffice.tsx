import { useLeague } from '@/contexts/LeagueContext';
import { cn } from '@/lib/utils';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeftRight, Users, TrendingUp, Calendar, FileText, BarChart3, ListChecks, Bell } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Narwhal } from '@/components/icons/Narwhal';
import { HeadlinesBanner } from '@/components/gm-office/HeadlinesBanner';
import { TeamIntelHub } from '@/components/gm-office/TeamIntelHub';
import { isGuestMode } from '@/utils/guestHelpers';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import { CitrusSectionDivider } from '@/components/CitrusSectionDivider';
import { CitrusSlice, CitrusSparkle, CitrusLeaf, CitrusWedge, CitrusBurst } from '@/components/icons/CitrusIcons';
import { AdSpace } from '@/components/AdSpace';
import LeagueNotifications from '@/components/matchup/LeagueNotifications';

const gmActions = [
  {
    title: "Stormy AI Assistant",
    description: "Get personalized advice and insights from your AI GM",
    icon: Narwhal,
    citrusIcon: CitrusSparkle,
    gradient: "from-citrus-sage to-citrus-green-medium",
    link: "/gm-office/stormy",
    hasNewInsight: false // Will be dynamic later
  },
  {
    title: "Make a Trade",
    description: "Propose, negotiate, and view pending offers with league managers.",
    icon: ArrowLeftRight,
    citrusIcon: CitrusWedge,
    gradient: "from-citrus-green-light to-citrus-sage",
    link: "/trade-analyzer"
  },
  {
    title: "Free Agents",
    description: "Browse and claim players. View Top 5 Adds.",
    icon: Users,
    citrusIcon: CitrusSlice,
    gradient: "from-citrus-sage to-citrus-green-light",
    link: "/free-agents"
  },
  {
    title: "Team Analytics",
    description: "Deep dive into your team's performance metrics",
    icon: BarChart3,
    citrusIcon: CitrusBurst,
    gradient: "from-citrus-sage to-citrus-green-medium",
    link: "/team-analytics"
  },
  {
    title: "Waiver Wire",
    description: "Manage waiver claims and priorities",
    icon: TrendingUp,
    citrusIcon: CitrusLeaf,
    gradient: "from-citrus-sage to-citrus-green-medium",
    link: "/waiver-wire"
  },
  {
    title: "Lineup Manager",
    description: "Set your daily lineups and plan for positional limits.",
    icon: Calendar,
    citrusIcon: CitrusWedge,
    gradient: "from-citrus-peach to-citrus-sage",
    link: "/schedule-manager"
  }
];

const GMOffice = () => {
  const { userLeagueState, activeLeagueId } = useLeague();
  return (
    <div className="min-h-screen bg-[#D4E8B8] text-foreground relative">
      {/* Desktop Navbar - Hidden on mobile */}
      <div className="hidden lg:block">
        <Navbar />
      </div>

      {/* MOBILE: Compact sticky header */}
      <div className="lg:hidden sticky top-0 z-40 bg-[#D4E8B8]/98 backdrop-blur-xl border-b border-citrus-sage/20 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-center h-12 px-4">
          <h1 className="text-lg font-varsity font-bold text-citrus-forest">GM's Office</h1>
        </div>
      </div>

      <main className="w-full lg:pt-24 lg:pb-16 pb-[calc(5rem+env(safe-area-inset-bottom))] m-0 p-0 relative z-10">
        <div className="w-full m-0 p-0">
          <div className={cn(
            "flex flex-col lg:grid lg:gap-8 lg:px-8 lg:mx-0 lg:w-screen lg:relative lg:left-1/2 lg:-translate-x-1/2",
            userLeagueState === 'active-user' && activeLeagueId
              ? "lg:grid-cols-[240px_1fr_300px]"
              : "lg:grid-cols-[240px_1fr]"
          )}>
            {/* Main Content - Appears first on mobile */}
            <div className="min-w-0 px-2 lg:px-6 order-1 lg:order-2">
              {/* Compact page header */}
              <div className="hidden lg:block max-w-5xl mx-auto mb-4">
                <h1 className="text-2xl font-varsity font-black text-citrus-forest uppercase tracking-tight">GM's Office</h1>
                <p className="text-sm font-display text-citrus-charcoal/70">Your command center for team management and strategy</p>
              </div>
              
              {/* Demo Mode Banner */}
              {isGuestMode(userLeagueState) && (
                <div className="max-w-3xl mx-auto mb-4">
                  <LeagueCreationCTA 
                    title="You're viewing demo GM Office"
                    description="Sign up to access all GM tools and manage your team."
                    variant="compact"
                  />
                </div>
              )}
              
              <div className="max-w-3xl mx-auto mb-4">
                <HeadlinesBanner />
              </div>
              
              <CitrusSectionDivider />
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto mt-4">
                {gmActions.map((action, index) => (
                  <Link 
                    key={action.title} 
                    to={action.link}
                    className="group"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <Card className="h-full transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_8px_0_rgba(223,117,54,0.4)] border-4 border-citrus-forest cursor-pointer overflow-hidden relative bg-citrus-cream corduroy-texture rounded-[2rem] shadow-[0_6px_0_rgba(27,48,34,0.2)]">
                      {/* Background gradient */}
                      <div className={`absolute top-0 left-0 w-full h-32 bg-gradient-to-br ${action.gradient} opacity-10`} />
                      
                      {/* Floating citrus icon */}
                      <action.citrusIcon className="absolute top-2 right-2 w-12 h-12 text-citrus-sage/10 rotate-12" />
                      
                      <CardHeader className="relative z-10">
                        <div className="relative">
                          <div className={`w-20 h-20 rounded-varsity bg-gradient-to-br ${action.gradient} border-4 border-citrus-forest flex items-center justify-center mb-4 group-hover:scale-110 group-hover:-rotate-3 transition-all duration-300 shadow-[inset_0_2px_4px_rgba(0,0,0,0.1),0_4px_0_rgba(27,48,34,0.2)]`}>
                            <action.icon className="h-10 w-10 text-citrus-cream" strokeWidth={2.5} />
                          </div>
                          {action.hasNewInsight && (
                            <Badge className="absolute top-0 right-0 bg-citrus-orange border-2 border-citrus-forest text-citrus-cream text-xs font-varsity font-bold shadow-patch">
                              New!
                            </Badge>
                          )}
                        </div>
                        <CardTitle className="text-xl font-varsity font-black text-citrus-forest uppercase tracking-tight group-hover:text-citrus-orange transition-colors">{action.title}</CardTitle>
                        <CardDescription className="text-sm mt-2 font-display text-citrus-charcoal">
                          {action.description}
                        </CardDescription>
                      </CardHeader>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>

            {/* Left Sidebar - At bottom on mobile, left on desktop - Extends to edge */}
            <aside className="w-full lg:w-auto order-2 lg:order-1">
              <div className="lg:sticky lg:top-28 space-y-4 lg:space-y-6">
                <TeamIntelHub />
                <AdSpace size="300x250" label="GM Sponsor" />
              </div>
            </aside>

            {/* Right Sidebar - Notifications (hidden on mobile) - Extends to edge */}
            {userLeagueState === 'active-user' && activeLeagueId && (
              <aside className="hidden lg:block order-3">
                <div className="lg:sticky lg:top-28 h-[calc(100vh-12rem)] bg-card border rounded-lg shadow-sm overflow-hidden">
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


export default GMOffice;
