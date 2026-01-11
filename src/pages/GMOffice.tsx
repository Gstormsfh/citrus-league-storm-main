import { useLeague } from '@/contexts/LeagueContext';
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
import { CitrusBackground } from '@/components/CitrusBackground';
import { CitrusSectionDivider } from '@/components/CitrusSectionDivider';
import { CitrusSlice, CitrusSparkle, CitrusLeaf, CitrusWedge, CitrusBurst } from '@/components/icons/CitrusIcons';

const gmActions = [
  {
    title: "Stormy AI Assistant",
    description: "Get personalized advice and insights from your AI GM",
    icon: Narwhal,
    citrusIcon: CitrusSparkle,
    gradient: "from-citrus-sage to-citrus-orange",
    link: "/gm-office/stormy",
    hasNewInsight: false // Will be dynamic later
  },
  {
    title: "Make a Trade",
    description: "Propose, negotiate, and view pending offers with league managers.",
    icon: ArrowLeftRight,
    citrusIcon: CitrusWedge,
    gradient: "from-citrus-peach to-citrus-orange",
    link: "/trade-analyzer"
  },
  {
    title: "Free Agents",
    description: "Browse and claim players. View Top 5 Adds.",
    icon: Users,
    citrusIcon: CitrusSlice,
    gradient: "from-citrus-sage to-citrus-peach",
    link: "/free-agents"
  },
  {
    title: "Team Analytics",
    description: "Deep dive into your team's performance metrics",
    icon: BarChart3,
    citrusIcon: CitrusBurst,
    gradient: "from-citrus-orange to-citrus-sage",
    link: "/team-analytics"
  },
  {
    title: "Waiver Wire",
    description: "Manage waiver claims and priorities",
    icon: TrendingUp,
    citrusIcon: CitrusLeaf,
    gradient: "from-citrus-sage to-citrus-orange",
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
  const { userLeagueState } = useLeague();
  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Citrus Background */}
      <CitrusBackground density="medium" animated={true} />
      
      <Navbar />
      <main className="pt-24 pb-16 relative z-10">
        <div className="container mx-auto px-4">
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Left Sidebar - Roster Depth Widget */}
            <aside className="lg:w-64 lg:flex-shrink-0 order-2 lg:order-1">
              <div className="lg:sticky lg:top-24">
                <TeamIntelHub />
              </div>
            </aside>

            {/* Main Content */}
            <div className="flex-1 min-w-0 order-1 lg:order-2">
              <div className="max-w-3xl mx-auto text-center mb-8 relative">
                {/* Citrus Decorations */}
                <CitrusSlice className="absolute -top-6 -left-6 w-16 h-16 text-citrus-orange/15 rotate-12" />
                <CitrusLeaf className="absolute -top-4 -right-8 w-12 h-12 text-citrus-sage/15 -rotate-45" />
                
                <div className="flex items-center justify-center gap-3 mb-4">
                  <CitrusSparkle className="w-10 h-10 text-citrus-orange animate-pulse" />
                  <h1 className="text-4xl md:text-5xl font-varsity font-black text-citrus-forest uppercase tracking-tight">GM's Office</h1>
                  <CitrusSparkle className="w-10 h-10 text-citrus-sage animate-pulse" style={{ animationDelay: '0.3s' }} />
                </div>
                <p className="text-lg font-display text-citrus-charcoal">
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
              
              <CitrusSectionDivider />
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-3xl mx-auto">
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
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};


export default GMOffice;
