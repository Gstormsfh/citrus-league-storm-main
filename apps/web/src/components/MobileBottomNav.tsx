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

  // Build paths: adapt for pool vs fantasy leagues
  const leagueType = league?.activeLeagueFormat?.leagueType;
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
        return [profileTab];
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
        "bg-[#E8EED9]/98 backdrop-blur-xl",
        "border-t border-citrus-sage/30",
        "shadow-[0_-4px_20px_rgba(0,0,0,0.08)]"
      )}
      style={{
        paddingBottom: 'env(safe-area-inset-bottom)',
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
      }}
    >
      {/* iOS-style blur overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#E8EED9] to-[#E8EED9]/90 -z-10" />

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
                active && "bg-citrus-sage/20",
              )}
            >
              <div className={cn(
                "relative flex items-center justify-center w-7 h-7 rounded-lg transition-all duration-300",
                active && "bg-citrus-sage shadow-sm"
              )}>
                <Icon
                  className={cn(
                    "w-[18px] h-[18px] transition-colors duration-200",
                    active ? "text-[#E8EED9]" : "text-citrus-charcoal/70"
                  )}
                />
              </div>
              <span className={cn(
                "text-[11px] font-display font-semibold leading-tight transition-colors duration-200",
                active ? "text-citrus-forest" : "text-citrus-charcoal/60"
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
