import { useEffect, useState } from 'react';
import { useLeague } from '@/contexts/LeagueContext';
import { leagueApi } from '@/api';
import { logger } from '@citrus/shared';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import Navbar from '@/components/Navbar';
import MobileMenuButton from '@/components/MobileMenuButton';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeftRight, Users, TrendingUp, Calendar, FileText, BarChart3, ListChecks, Bell, Target, History, Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';
import { HockeyFooter } from '@/components/citrus2';
import { Narwhal } from '@/components/icons/Narwhal';
import { isPoolLeague, getPoolRoute, getPoolLabel } from '@/utils/leagueTypeHelpers';
import { usePlayoffChampion } from '@/hooks/usePlayoffChampion';
import { HeadlinesBanner } from '@/components/gm-office/HeadlinesBanner';
import { TeamIntelHub } from '@/components/gm-office/TeamIntelHub';
import { isGuestMode } from '@/utils/guestHelpers';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import { CitrusSectionDivider } from '@/components/CitrusSectionDivider';
import { CitrusSlice, CitrusSparkle, CitrusLeaf, CitrusWedge, CitrusBurst } from '@/components/icons/CitrusIcons';
import { AdSpace } from '@/components/AdSpace';
import LeagueNotifications from '@/components/matchup/LeagueNotifications';

interface GMAction {
  title: string;
  description: string;
  icon: React.ElementType;
  citrusIcon: React.ElementType;
  gradient: string;
  link: string;
  hasNewInsight?: boolean;
}

const gmActions: GMAction[] = [
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

const getPoolActions = (leagueType: string, leagueId: string): GMAction[] => [
  {
    title: "Make Picks",
    description: `Submit your ${getPoolLabel(leagueType)} picks for this week`,
    icon: Target,
    citrusIcon: CitrusSparkle,
    gradient: "from-citrus-sage to-citrus-green-medium",
    link: getPoolRoute(leagueType, leagueId),
  },
  {
    title: "Standings",
    description: "See how you stack up against the competition",
    icon: Trophy,
    citrusIcon: CitrusBurst,
    gradient: "from-citrus-green-light to-citrus-sage",
    link: getPoolRoute(leagueType, leagueId, 'standings'),
  },
  {
    title: "Stormy AI Assistant",
    description: "Get personalized advice and insights from your AI GM",
    icon: Narwhal,
    citrusIcon: CitrusSparkle,
    gradient: "from-citrus-sage to-citrus-green-medium",
    link: "/gm-office/stormy",
  },
];

const GMOffice = () => {
  const { userLeagueState, activeLeagueId, activeLeagueFormat } = useLeague();
  const leagueType = activeLeagueFormat?.leagueType;
  const isPool = isPoolLeague(leagueType) && !!activeLeagueId;
  const actions = isPool ? getPoolActions(leagueType!, activeLeagueId!) : gmActions;
  const playoffChampion = usePlayoffChampion(activeLeagueId, leagueType || null);

  // Season-complete state: once the regular season + playoffs are done, the
  // GM Office goes read-only for roster/lineup/trade/waiver actions.
  const [seasonComplete, setSeasonComplete] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!activeLeagueId || isPool) {
      setSeasonComplete(false);
      return;
    }
    leagueApi
      .getSeasonState(activeLeagueId)
      .then((res) => {
        if (!cancelled) setSeasonComplete(Boolean(res?.data?.complete));
      })
      .catch((err) => {
        logger.warn('[GMOffice] season-state fetch failed:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [activeLeagueId, isPool]);

  const LOCKED_ACTION_TITLES = new Set([
    'Make a Trade',
    'Free Agents',
    'Waiver Wire',
    'Lineup Manager',
  ]);
  return (
    <div className="min-h-screen bg-[#0F1F15] text-pastel-cream relative">
      {/* Desktop Navbar - Hidden on mobile */}
      <div className="hidden lg:block">
        <Navbar />
      </div>

      {/* MOBILE: Compact sticky header */}
      <div className="lg:hidden sticky top-0 z-40 bg-[#0F1F15]/95 backdrop-blur-xl border-b border-white/10 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between h-12 px-4">
          <div className="w-10" />
          <h1 className="text-lg font-bold text-pastel-cream">GM's Office</h1>
          <MobileMenuButton />
        </div>
      </div>

      <main className="w-full lg:pt-24 lg:pb-8 pb-[calc(5rem+env(safe-area-inset-bottom))] m-0 p-0 relative z-10">
        <div className="w-full m-0 p-0">
          <div className={cn(
            "flex flex-col lg:grid lg:gap-4 xl:gap-6 lg:px-4 xl:px-6 lg:mx-0 lg:w-screen lg:relative lg:left-1/2 lg:-translate-x-1/2",
            userLeagueState === 'active-user' && activeLeagueId
              ? "lg:grid-cols-[200px_1fr_260px] xl:grid-cols-[220px_1fr_280px]"
              : "lg:grid-cols-[200px_1fr] xl:grid-cols-[220px_1fr]"
          )}>
            {/* Main Content - Appears first on mobile */}
            <div className="min-w-0 px-2 lg:px-6 order-1 lg:order-2">
              {/* Compact page header */}
              <div className="hidden lg:block max-w-5xl mx-auto mb-4">
                <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-1.5">
                  ✦ Command Center
                </div>
                <h1 className="font-calistoga text-3xl text-pastel-cream leading-none">
                  {isPool ? `${getPoolLabel(leagueType!)} Pool Hub` : "GM's Office"}
                </h1>
                <p className="text-sm text-white/55 mt-2">
                  {isPool ? 'Your pool command center' : 'Your command center for team management and strategy'}
                </p>
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
              
              {playoffChampion.status === 'completed' && activeLeagueId && (
                <div className="max-w-3xl mx-auto mb-4">
                  <Link
                    to={`/playoffs/${activeLeagueId}`}
                    className="flex items-center justify-between gap-3 rounded-2xl ring-1 ring-amber-400/50 bg-gradient-to-r from-amber-500/15 to-yellow-500/10 px-4 py-3 hover:ring-amber-400/70 hover:bg-amber-500/15 transition-all shadow-[0_8px_24px_-12px_rgba(251,191,36,0.3)]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Trophy className="w-5 h-5 text-amber-400 shrink-0" />
                      <span className="font-bold text-pastel-cream truncate">
                        {playoffChampion.championTeamName} — League Champion
                      </span>
                    </div>
                    <span className="text-xs font-jbmono uppercase tracking-[0.22em] font-bold text-amber-300 shrink-0">
                      View Bracket
                    </span>
                  </Link>
                </div>
              )}
              {playoffChampion.status === 'in_progress' && activeLeagueId && (
                <div className="max-w-3xl mx-auto mb-4">
                  <Link
                    to={`/playoffs/${activeLeagueId}`}
                    className="flex items-center justify-between px-3 py-2 rounded-xl ring-1 ring-white/10 bg-white/5 text-sm hover:bg-white/10 transition-colors"
                  >
                    <span className="text-white/55">Playoffs in Progress</span>
                    <span className="font-medium text-pastel-orange">View Bracket</span>
                  </Link>
                </div>
              )}

              {seasonComplete && (
                <div className="max-w-3xl mx-auto mb-4">
                  <div
                    role="status"
                    aria-live="polite"
                    className="flex items-center justify-between gap-3 rounded-2xl ring-1 ring-pastel-orange/40 bg-[#1A2A20] px-4 py-3 shadow-[0_8px_24px_-12px_rgba(255,168,87,0.3)]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Trophy className="w-5 h-5 text-pastel-orange shrink-0" />
                      <span className="font-bold text-pastel-cream truncate">
                        Season Complete — Rosters Locked
                      </span>
                    </div>
                    <Badge className="bg-pastel-orange/20 ring-1 ring-pastel-orange/40 text-pastel-orange-soft text-[10px] font-jbmono uppercase tracking-[0.22em] font-bold shrink-0">
                      Read Only
                    </Badge>
                  </div>
                </div>
              )}

              <div className="max-w-3xl mx-auto mb-4">
                <HeadlinesBanner />
              </div>
              
              <CitrusSectionDivider />
              
              <TooltipProvider>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-5xl mx-auto mt-4">
                {actions.map((action, index) => {
                  const isLocked = seasonComplete && LOCKED_ACTION_TITLES.has(action.title);
                  const cardInner = (
                    <Card className={cn(
                      "h-full border-0 ring-1 ring-white/10 overflow-hidden relative bg-[#1A2A20] rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]",
                      isLocked
                        ? "opacity-50 cursor-not-allowed grayscale"
                        : "transition-all duration-300 hover:-translate-y-0.5 hover:ring-pastel-orange/40 hover:shadow-[0_24px_60px_-16px_rgba(255,168,87,0.25)] cursor-pointer",
                    )}>
                      {/* Decorative gradient corner glow */}
                      <div aria-hidden="true" className="absolute top-0 right-0 w-56 h-56 bg-pastel-orange/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none transition-opacity duration-300 group-hover:bg-pastel-orange/20" />

                      {/* Floating citrus icon — subtle */}
                      <action.citrusIcon aria-hidden="true" className="absolute top-3 right-3 w-10 h-10 text-pastel-orange/15 rotate-12 transition-all duration-300 group-hover:text-pastel-orange/30 group-hover:rotate-6" />

                      <CardHeader className="relative z-10 p-6">
                        <div className="relative mb-4">
                          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-pastel-orange/30 to-pastel-orange/10 ring-1 ring-pastel-orange/30 flex items-center justify-center transition-all duration-300 group-hover:scale-105 group-hover:ring-pastel-orange/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                            <action.icon className="h-7 w-7 text-pastel-orange" strokeWidth={2} />
                          </div>
                          {action.hasNewInsight && (
                            <Badge className="absolute -top-1.5 -right-1.5 bg-pastel-orange ring-1 ring-pastel-orange/40 text-[#0F1F15] text-[9px] font-jbmono uppercase tracking-[0.18em] font-bold px-2 py-0.5">
                              New
                            </Badge>
                          )}
                        </div>
                        <CardTitle className="font-calistoga text-xl text-pastel-cream leading-tight transition-colors group-hover:text-pastel-orange">{action.title}</CardTitle>
                        <CardDescription className="text-sm mt-2 text-white/55 leading-relaxed">
                          {action.description}
                        </CardDescription>
                      </CardHeader>
                    </Card>
                  );
                  if (isLocked) {
                    return (
                      <Tooltip key={action.title}>
                        <TooltipTrigger asChild>
                          <div
                            aria-disabled="true"
                            className="group"
                            style={{ animationDelay: `${index * 50}ms` }}
                          >
                            {cardInner}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          Season complete — roster locked
                        </TooltipContent>
                      </Tooltip>
                    );
                  }
                  return (
                    <Link
                      key={action.title}
                      to={action.link}
                      className="group"
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      {cardInner}
                    </Link>
                  );
                })}
              </div>
              </TooltipProvider>
            </div>

            {/* Left Sidebar - At bottom on mobile, left on desktop - Extends to edge */}
            <aside className="w-full lg:w-auto order-2 lg:order-1">
              <div className="lg:sticky lg:top-24 space-y-4 lg:space-y-6">
                <TeamIntelHub />
                <AdSpace size="300x250" label="GM Sponsor" />
              </div>
            </aside>

            {/* Right Sidebar - Notifications (hidden on mobile) - Extends to edge */}
            {userLeagueState === 'active-user' && activeLeagueId && (
              <aside className="hidden lg:block order-3">
                <div className="lg:sticky lg:top-24 h-[calc(100vh-7rem)] bg-[#1A2A20] ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] overflow-hidden">
                  <LeagueNotifications leagueId={activeLeagueId} />
                </div>
              </aside>
            )}
          </div>
        </div>
      </main>
      <HockeyFooter />
    </div>
  );
};


export default GMOffice;
