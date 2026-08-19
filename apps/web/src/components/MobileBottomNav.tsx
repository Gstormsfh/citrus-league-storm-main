import { Link, useLocation } from 'react-router-dom';
import { Swords, Users, BarChart3, User, Search, Target, Newspaper, Trophy, Home } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEffect } from 'react';
import { useLeague } from '@/contexts/LeagueContext';
import { useAuth } from '@/contexts/AuthContext';
import { isPoolLeague, getPoolRoute } from '@/utils/leagueTypeHelpers';

const MobileBottomNav = () => {
  const location = useLocation();
  const auth = useAuth();
  const league = useLeague();
  const user = auth?.user ?? null;
  const activeLeagueId = league?.activeLeagueId ?? null;

  // Prevent iOS rubber-band overscroll from shifting the fixed nav.
  // SCROLL FIX (2026-08-17): gate on TOUCH devices, not window width —
  // the old innerWidth<1024 check fired on narrow DESKTOP windows and
  // planted overscroll-behavior:none on body/html, which (combined with
  // body being a scroll container) stopped mouse-wheel scroll chaining
  // dead. Rubber-banding only exists on touch devices; only they need
  // the guard, and only on the root element.
  useEffect(() => {
    // matchMedia is universal in real browsers but absent in jsdom (and
    // some ancient webviews) — feature-detect so the nav can never crash.
    const isTouch = typeof window.matchMedia === 'function'
      && window.matchMedia('(pointer: coarse)').matches;
    if (isTouch) {
      document.documentElement.style.overscrollBehavior = 'none';
    }
    return () => {
      document.documentElement.style.overscrollBehavior = '';
    };
  }, []);

  // Build paths: adapt for pool vs fantasy leagues.
  // Read from activeLeagueFormat first, fall back to raw settings JSONB —
  // covers the window where activeLeagueFormat resolves stale ('fantasy' default)
  // while the real settings.leagueType is already set.
  const leagueType = (league?.activeLeagueFormat?.leagueType && league.activeLeagueFormat.leagueType !== 'fantasy')
    ? league.activeLeagueFormat.leagueType
    : ((league?.activeLeague?.settings as Record<string, unknown> | undefined)?.leagueType as string | undefined)
      ?? league?.activeLeagueFormat?.leagueType;
  const isPool = isPoolLeague(leagueType) && !!activeLeagueId;

  // Pool-type-specific mobile tabs
  const getPoolNavItems = () => {
    if (!activeLeagueId || !leagueType) return [];
    const poolRoute = getPoolRoute(leagueType, activeLeagueId);
    const standingsRoute = getPoolRoute(leagueType, activeLeagueId, 'standings');

    const profileTab = { icon: User, label: user ? 'Profile' : 'Sign In', path: user ? '/profile' : '/auth' };

    switch (leagueType) {
      case 'pickem':
        return [
          { icon: Target, label: 'Picks', path: poolRoute },
          { icon: BarChart3, label: 'Standings', path: standingsRoute },
          { icon: Newspaper, label: 'News', path: '/news' },
          profileTab,
        ];
      case 'survivor':
        return [
          { icon: Target, label: 'My Pick', path: poolRoute },
          { icon: BarChart3, label: 'Standings', path: standingsRoute },
          { icon: Newspaper, label: 'News', path: '/news' },
          profileTab,
        ];
      case 'confidence-pool':
        return [
          { icon: Target, label: 'Rank', path: poolRoute },
          { icon: BarChart3, label: 'Standings', path: standingsRoute },
          { icon: Newspaper, label: 'News', path: '/news' },
          profileTab,
        ];
      case 'playoff-bracket-pickem':
        return [
          { icon: Trophy, label: 'Pool Home', path: `/pool/playoff-hub?league=${activeLeagueId}` },
          { icon: Target, label: 'My Picks', path: poolRoute },
          { icon: BarChart3, label: 'NHL Bracket', path: '/nhl/playoffs' },
          profileTab,
        ];
      case 'playoff-confidence-pool':
        return [
          { icon: Trophy, label: 'Pool Home', path: `/pool/playoff-hub?league=${activeLeagueId}` },
          { icon: Target, label: 'My Picks', path: poolRoute },
          { icon: BarChart3, label: 'NHL Bracket', path: '/nhl/playoffs' },
          profileTab,
        ];
      case 'playoff-roster-pool':
        return [
          { icon: Trophy, label: 'Pool Home', path: `/pool/playoff-hub?league=${activeLeagueId}` },
          { icon: Users, label: 'My Roster', path: poolRoute },
          { icon: BarChart3, label: 'NHL Bracket', path: '/nhl/playoffs' },
          profileTab,
        ];
      default:
        // Unknown pool type — show playoff-friendly tabs instead of just Profile
        return [
          { icon: Trophy, label: 'Playoffs', path: '/nhl/playoffs' },
          { icon: Target, label: 'Picks', path: poolRoute },
          { icon: BarChart3, label: 'Standings', path: standingsRoute },
          profileTab,
        ];
    }
  };

  // REGULAR-SEASON NAV (2026-08-17): the old default branch was the
  // playoff-era nav (Playoffs / Create-a-playoff-pool) — a manager in a
  // fantasy league had NO mobile route to their matchup, roster, or
  // standings. Now: an active fantasy league gets the same five tabs as
  // the desktop Navbar; everyone else gets a season-neutral default with
  // zero playoff branding.
  const navItems = isPool
    ? getPoolNavItems()
    : (user && activeLeagueId)
      ? [
          { icon: Trophy, label: 'League', path: `/league/${activeLeagueId}?league=${activeLeagueId}` },
          { icon: Swords, label: 'Matchup', path: '/matchup' },
          { icon: Users, label: 'Roster', path: '/roster' },
          // 2026-08-18 launch audit: this tab was labelled "Players" but
          // pointed at /free-agents, while a real /players section now
          // exists with the full advanced-metrics dashboard. Desktop has
          // both; mobile had only the mislabelled one, so the two navs
          // disagreed about what "Players" means. Say what it is.
          { icon: Search, label: 'Free Agents', path: '/free-agents' },
          { icon: BarChart3, label: 'Standings', path: '/standings' },
        ]
      : [
          { icon: Home, label: 'Home', path: '/' },
          { icon: Target, label: 'Create', path: '/create-league' },
          { icon: Newspaper, label: 'News', path: '/news' },
          { icon: User, label: user ? 'Profile' : 'Sign In', path: user ? '/profile' : '/auth' },
        ];

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    // Match on the base segment (e.g. /matchup, /roster)
    const base = '/' + path.split('/')[1];
    return location.pathname.startsWith(base);
  };

  // Don't show on auth pages, draft room, or setup flows.
  //
  // ARCHITECT 2026-08-11 (DESIGN_LOBBY_CAMPAIGN L4 / inbox E123). The comment
  // above has claimed "draft room" since this file was written, but the array
  // never contained a draft path. This component is mounted globally
  // (App.tsx:251) and its wrapper is `fixed bottom-0 ... z-50 lg:hidden` over
  // an h-16 row, so on EVERY viewport under 1024px a 65px opaque bar rendered
  // across the bottom of the draft room. Verified live on staging at
  // /draft-v2/ada00013-0000-4000-8000-000000000001 (innerWidth 958): nav
  // present, rect height 65, z-index 50, covering the pick-history table, and
  // offering "Create a playoff pool" to someone mid-draft.
  //
  // The three draft routes are App.tsx:199 (/draft-room), :200 (/draft) and
  // :202 (/draft-v2/:leagueId/:draftId?). '/draft' alone would cover all three
  // through startsWith and no other route in App.tsx begins with "draft";
  // all three are listed anyway so this array stays greppable by route name.
  const hideOnRoutes = [
    '/auth', '/profile-setup', '/verify-email', '/reset-password',
    '/draft', '/draft-v2', '/draft-room',
  ];
  if (hideOnRoutes.some(route => location.pathname.startsWith(route))) {
    return null;
  }

  return (
    <nav
      className={cn(
        "fixed bottom-0 left-0 right-0 z-50 lg:hidden",
        "bg-pastel-surface/98 backdrop-blur-xl",
        "border-t border-white/10",
        "shadow-[0_-8px_32px_-8px_rgba(0,0,0,0.4)]"
      )}
      style={{
        paddingBottom: 'env(safe-area-inset-bottom)',
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
      }}
    >
      {/* Dark gradient overlay for depth */}
      <div className="absolute inset-0 bg-gradient-to-t from-pastel-surface to-[#152821]/90 -z-10" />

      <div className="flex items-center justify-around px-1 h-16">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);

          return (
            <Link
              key={item.label}
              to={item.path}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 py-1.5 px-2 min-w-[56px] min-h-[48px] rounded-xl transition-all duration-200",
                "ios-pressable touch-target",
                active && "bg-pastel-orange/15",
              )}
            >
              <div className={cn(
                "relative flex items-center justify-center w-7 h-7 rounded-lg transition-all duration-300",
                active && "bg-pastel-orange shadow-[0_4px_12px_-4px_rgba(255,107,26,0.5)]"
              )}>
                <Icon
                  className={cn(
                    "w-[18px] h-[18px] transition-colors duration-200",
                    active ? "text-white" : "text-white/55"
                  )}
                  strokeWidth={active ? 2.5 : 2}
                />
              </div>
              <span className={cn(
                "text-[10px] font-bold leading-tight transition-colors duration-200 tracking-tight",
                active ? "text-pastel-cream" : "text-white/55"
              )}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
};

export default MobileBottomNav;
