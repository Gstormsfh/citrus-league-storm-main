import { Link, useLocation } from 'react-router-dom';
import { Swords, Users, BarChart3, User, Search, Target, Newspaper, Trophy } from 'lucide-react';
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

  // Prevent iOS rubber-band overscroll from shifting the fixed nav (mobile only)
  useEffect(() => {
    const isMobile = window.innerWidth < 1024;
    if (isMobile) {
      document.body.style.overscrollBehavior = 'none';
      document.documentElement.style.overscrollBehavior = 'none';
    }
    return () => {
      document.body.style.overscrollBehavior = '';
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

  const navItems = isPool
    ? getPoolNavItems()
    : [
        // Playoff-first mobile nav — season-long items accessible via direct URL.
        { icon: Trophy, label: 'Playoffs', path: '/nhl/playoffs' },
        { icon: Target, label: 'Create', path: '/create-league?type=playoff' },
        { icon: Newspaper, label: 'News', path: '/news' },
        { icon: User, label: user ? 'Profile' : 'Sign In', path: user ? '/profile' : '/auth' },
      ];

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    // Match on the base segment (e.g. /matchup, /roster)
    const base = '/' + path.split('/')[1];
    return location.pathname.startsWith(base);
  };

  // Don't show on auth pages, draft room, or setup flows
  const hideOnRoutes = ['/auth', '/profile-setup', '/verify-email', '/reset-password'];
  if (hideOnRoutes.some(route => location.pathname.startsWith(route))) {
    return null;
  }

  return (
    <nav
      className={cn(
        "fixed bottom-0 left-0 right-0 z-50 lg:hidden",
        "bg-pastel-surface/95 backdrop-blur-xl",
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
                active ? "text-pastel-cream" : "text-white/45"
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
