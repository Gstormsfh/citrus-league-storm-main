import { useEffect, useState } from 'react';
import { useLeague } from '@/contexts/LeagueContext';
import { leagueApi } from '@/api';
import { logger } from '@citrus/shared';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import Navbar from '@/components/Navbar';
import MobileMenuButton from '@/components/MobileMenuButton';
import { Badge } from '@/components/ui/badge';
import { Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  HockeyFooter,
  StormyChatTile,
  MascotPortrait,
  CrossedSticksIcon,
  SlateIcon,
  XGModelIcon,
  ShiftIcon,
  ScoreboardIcon,
  PuckIcon,
  CupIcon,
  PickemIcon,
} from '@/components/citrus2';
import { Narwhal } from '@/components/icons/Narwhal';
import { isPoolLeague, getPoolRoute, getPoolLabel } from '@/utils/leagueTypeHelpers';
import { usePlayoffChampion } from '@/hooks/usePlayoffChampion';
import { HeadlinesBanner } from '@/components/gm-office/HeadlinesBanner';
import { TeamIntelHub } from '@/components/gm-office/TeamIntelHub';
import { isGuestMode } from '@/utils/guestHelpers';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import LeagueNotifications from '@/components/matchup/LeagueNotifications';

interface GMAction {
  title: string;
  description: string;
  icon: React.ElementType;
  link: string;
  hasNewInsight?: boolean;
  /**
   * Optional micro-copy chip that sits in the top-right of the card.
   * Render shape: { label: short caps text, tone: 'orange' | 'sage' | 'cream' }
   */
  chip?: { label: string; tone: 'orange' | 'sage' | 'cream' };
}

const gmActions: GMAction[] = [
  {
    title: "Stormy AI Assistant",
    description: "Get personalized advice and insights from your AI GM.",
    icon: Narwhal,
    link: "/gm-office/stormy",
    hasNewInsight: false,
    chip: { label: 'Always-on', tone: 'orange' },
  },
  {
    title: "Make a Trade",
    description: "Propose, negotiate, and view pending offers with league managers.",
    icon: CrossedSticksIcon,
    link: "/trade-analyzer",
    chip: { label: 'Trade deck', tone: 'cream' },
  },
  {
    title: "Free Agents",
    description: "Browse and claim players. View this week's Top 5 Adds.",
    icon: SlateIcon,
    link: "/free-agents",
    chip: { label: 'Slate', tone: 'sage' },
  },
  {
    title: "Team Analytics",
    description: "Positional grades, stat impact, and matchup outlook.",
    icon: XGModelIcon,
    link: "/team-analytics",
    chip: { label: 'xG model', tone: 'orange' },
  },
  {
    title: "Waiver Wire",
    description: "Manage waiver claims, FAAB bids, and priorities.",
    icon: ShiftIcon,
    link: "/waiver-wire",
    chip: { label: 'Wire', tone: 'sage' },
  },
  {
    title: "Lineup Manager",
    description: "Set daily lineups and plan around positional limits.",
    icon: ScoreboardIcon,
    link: "/schedule-manager",
    chip: { label: 'Lineup', tone: 'cream' },
  }
];

const getPoolActions = (leagueType: string, leagueId: string): GMAction[] => [
  {
    title: "Make Picks",
    description: `Submit your ${getPoolLabel(leagueType)} picks for this week.`,
    icon: PickemIcon,
    link: getPoolRoute(leagueType, leagueId),
    chip: { label: 'This week', tone: 'orange' },
  },
  {
    title: "Standings",
    description: "See how you stack up against the competition.",
    icon: CupIcon,
    link: getPoolRoute(leagueType, leagueId, 'standings'),
    chip: { label: 'Leaderboard', tone: 'cream' },
  },
  {
    title: "Stormy AI Assistant",
    description: "Get personalized advice and insights from your AI GM.",
    icon: Narwhal,
    link: "/gm-office/stormy",
    chip: { label: 'Always-on', tone: 'orange' },
  },
];

const chipClasses = {
  orange: 'bg-pastel-orange/20 ring-1 ring-pastel-orange/40 text-pastel-orange-soft',
  sage: 'bg-pastel-sage/20 ring-1 ring-pastel-sage/40 text-pastel-sage-soft',
  cream: 'bg-white/10 ring-1 ring-white/20 text-pastel-cream',
};

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
    <div className="min-h-screen bg-pastel-surface text-pastel-cream relative">
      {/* Desktop Navbar - Hidden on mobile */}
      <div className="hidden lg:block">
        <Navbar />
      </div>

      {/* MOBILE: Compact sticky header */}
      <div className="lg:hidden sticky top-0 z-page-header bg-pastel-surface/95 backdrop-blur-xl border-b border-white/10 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between h-12 px-4">
          <div className="w-10" />
          <h1 className="text-lg font-bold text-pastel-cream">GM's Office</h1>
          <MobileMenuButton />
        </div>
      </div>

      <main className="w-full lg:pt-24 lg:pb-8 pb-app-chrome m-0 p-0 relative z-10">
        <div className="w-full m-0 p-0">
          <div className={cn(
            "flex flex-col lg:grid lg:gap-4 xl:gap-6 lg:px-4 xl:px-6 lg:mx-0 lg:w-screen lg:relative lg:left-1/2 lg:-translate-x-1/2",
            userLeagueState === 'active-user' && activeLeagueId
              ? "lg:grid-cols-[200px_1fr_280px] xl:grid-cols-[220px_1fr_340px]"
              : "lg:grid-cols-[200px_1fr] xl:grid-cols-[220px_1fr]"
          )}>
            {/* Main Content - Appears first on mobile */}
            <div className="min-w-0 px-2 lg:px-6 order-1 lg:order-2">

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

              {/* Champion / playoffs / season-complete banners */}
              {playoffChampion.status === 'completed' && activeLeagueId && (
                <div className="max-w-3xl mx-auto mb-4">
                  <Link
                    /* S-5 Entry 21 P-a fix (2026-08-09): `/playoffs/:leagueId` is not a route; correct is `/league/:leagueId/playoffs` (App.tsx:192). Same defect class as T11a Matchup.tsx fixes. */
                    to={`/league/${activeLeagueId}/playoffs`}
                    className="flex items-center justify-between gap-3 rounded-2xl ring-1 ring-amber-400/50 bg-gradient-to-r from-amber-500/15 to-yellow-500/10 px-4 py-3 hover:ring-amber-400/70 hover:bg-amber-500/15 transition-all shadow-[0_8px_24px_-12px_rgba(251,191,36,0.3)]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Trophy className="w-5 h-5 text-amber-400 shrink-0" aria-hidden="true" />
                      <span className="font-bold text-pastel-cream truncate">
                        {playoffChampion.championTeamName}, League Champion
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
                    /* S-5 Entry 21 P-a fix (2026-08-09): `/playoffs/:leagueId` is not a route; correct is `/league/:leagueId/playoffs` (App.tsx:192). Same defect class as T11a Matchup.tsx fixes. */
                    to={`/league/${activeLeagueId}/playoffs`}
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
                    className="flex items-center justify-between gap-3 rounded-2xl ring-1 ring-pastel-orange/40 bg-pastel-surface-tile px-4 py-3 shadow-[0_8px_24px_-12px_rgba(255,168,87,0.3)]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Trophy className="w-5 h-5 text-pastel-orange shrink-0" aria-hidden="true" />
                      <span className="font-bold text-pastel-cream truncate">
                        Season complete, rosters locked
                      </span>
                    </div>
                    <Badge className="bg-pastel-orange/20 ring-1 ring-pastel-orange/40 text-pastel-orange-soft text-[10px] font-jbmono uppercase tracking-[0.22em] font-bold shrink-0">
                      Read Only
                    </Badge>
                  </div>
                </div>
              )}

              {/* Headlines Banner — kept */}
              <div className="max-w-5xl mx-auto mb-6">
                <HeadlinesBanner />
              </div>

              {/* Section eyebrow — replaces the old CitrusSectionDivider with
                  something on-brand for citrus2 */}
              <div className="max-w-5xl mx-auto mb-4 flex items-center gap-3">
                <PuckIcon className="w-4 h-4 text-pastel-orange" strokeWidth={2} />
                <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold">
                  ✦ Command Stack
                </div>
                <div className="flex-1 h-px bg-gradient-to-r from-pastel-orange/40 to-transparent" />
              </div>

              {/* Action grid — six command-stack cards. Custom hockey
                  iconography, animated underglow on hover, optional caps chip
                  in the top-right. */}
              <TooltipProvider>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-5xl mx-auto mt-4">
                  {actions.map((action, index) => {
                    const isLocked = seasonComplete && LOCKED_ACTION_TITLES.has(action.title);
                    const ActionIcon = action.icon;
                    const cardInner = (
                      <div className={cn(
                        "h-full relative overflow-hidden rounded-2xl bg-pastel-surface-tile ring-1 ring-white/10 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]",
                        isLocked
                          ? "opacity-50 cursor-not-allowed grayscale"
                          : "transition-all duration-300 hover:-translate-y-0.5 hover:ring-pastel-orange/40 hover:shadow-[0_24px_60px_-16px_rgba(255,168,87,0.25)] cursor-pointer",
                      )}>
                        {/* Decorative orange glow corner — brightens on hover */}
                        <div aria-hidden="true" className="absolute -top-12 -right-12 w-44 h-44 bg-pastel-orange/10 rounded-full blur-3xl pointer-events-none transition-opacity duration-300 group-hover:bg-pastel-orange/25" />

                        {/* Sage accent corner — adds subtle dimensional warmth */}
                        <div aria-hidden="true" className="absolute -bottom-12 -left-12 w-40 h-40 bg-pastel-sage/[0.08] rounded-full blur-3xl pointer-events-none" />

                        {/* Top-right chip — micro-copy that frames the card's intent */}
                        {action.chip && (
                          <div className="absolute top-4 right-4 z-10">
                            <span className={cn(
                              'px-2 py-0.5 rounded-md text-[9px] font-jbmono uppercase tracking-[0.18em] font-bold',
                              chipClasses[action.chip.tone]
                            )}>
                              {action.chip.label}
                            </span>
                          </div>
                        )}

                        <div className="relative z-10 p-6 flex flex-col h-full">
                          {/* Hockey icon block — the visual centerpiece, NOT a
                              tinted square with a generic lucide. Custom SVG. */}
                          <div className="relative mb-5 inline-block">
                            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-pastel-orange/30 to-pastel-orange/10 ring-1 ring-pastel-orange/40 flex items-center justify-center transition-all duration-300 group-hover:scale-105 group-hover:ring-pastel-orange/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                              <ActionIcon className="h-7 w-7 text-pastel-orange" strokeWidth={1.75} />
                            </div>
                            {action.hasNewInsight && (
                              <span className="absolute -top-1.5 -right-1.5 bg-pastel-orange ring-2 ring-pastel-surface-tile text-pastel-surface text-[8px] font-jbmono uppercase tracking-[0.18em] font-bold px-1.5 py-0.5 rounded-md">
                                New
                              </span>
                            )}
                          </div>

                          <h3 className="font-calistoga text-xl text-pastel-cream leading-tight transition-colors group-hover:text-pastel-orange mb-2">
                            {action.title}
                          </h3>
                          <p className="text-sm text-white/55 leading-relaxed">
                            {action.description}
                          </p>

                          {/* Subtle "tap to open" footer that only appears on hover */}
                          {!isLocked && (
                            <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between">
                              <span className="font-jbmono text-[9px] uppercase tracking-[0.32em] text-white/55 group-hover:text-pastel-orange-soft transition-colors">
                                Tap to open
                              </span>
                              <span className="text-pastel-orange/60 group-hover:text-pastel-orange group-hover:translate-x-0.5 transition-all" aria-hidden="true">
                                →
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
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
                            Season complete, roster locked
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

            {/* Left Sidebar — TeamIntelHub kept; AdSpace REMOVED in favor of
                a Stormy mascot peek tile that sells the brand instead of
                renting it out. */}
            <aside className="w-full lg:w-auto order-2 lg:order-1">
              <div className="lg:sticky lg:top-24 space-y-4 lg:space-y-6">
                <TeamIntelHub />
                {/* Stormy preview tile — replaces the legacy AdSpace placeholder
                    with a real on-brand sample exchange. Tapping anywhere in
                    the rail's footer link drops you into the full assistant. */}
                <div className="space-y-3">
                  {/* Canonical Stormy portrait — same character treatment as
                      the homepage Roll Call. Big and present, doing her AGM
                      thing. The chat tile below sits her in conversation. */}
                  <MascotPortrait
                    id="stormy"
                    className="ring-1 ring-pastel-orange/30 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]"
                  />
                  {/* The canned exchange that used to live here — "Should I bench
                      McDavid for a back-to-back?" with a full answer — rendered in
                      YOU/STORMY bubbles with no "example" chrome, on a page the user
                      is signed in to, directly above "Open Full Assistant". It read
                      as Stormy having already looked at their roster. Removed
                      2026-08-26. The link below is the real thing. */}
                  <Link
                    to="/gm-office/stormy"
                    className="block text-center px-4 py-2.5 rounded-xl bg-pastel-orange/15 ring-1 ring-pastel-orange/30 hover:bg-pastel-orange/25 hover:ring-pastel-orange/50 transition-all font-jbmono text-[10px] uppercase tracking-[0.22em] font-bold text-pastel-orange-soft"
                  >
                    Open Full Assistant →
                  </Link>
                </div>
              </div>
            </aside>

            {/* Right Sidebar - Notifications (hidden on mobile) - Extends to edge */}
            {userLeagueState === 'active-user' && activeLeagueId && (
              <aside className="hidden lg:block order-3">
                <div className="lg:sticky lg:top-24 h-[calc(100vh-7rem)] bg-pastel-surface-tile ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] overflow-hidden">
                  <LeagueNotifications leagueId={activeLeagueId} />
                </div>
              </aside>
            )}
          </div>
        </div>
      </main>
      <HockeyFooter variant="app" />
    </div>
  );
};


export default GMOffice;
