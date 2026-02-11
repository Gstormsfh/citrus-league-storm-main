import { Link, useLocation } from 'react-router-dom';
import { Home, Calendar, Users, BarChart3, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEffect } from 'react';
import { useLeague } from '@/contexts/LeagueContext';
import { useAuth } from '@/contexts/AuthContext';

const MobileBottomNav = () => {
  const location = useLocation();
  const auth = useAuth();
  const league = useLeague();
  const user = auth?.user ?? null;
  const activeLeagueId = league?.activeLeagueId ?? null;

  // Prevent iOS rubber-band overscroll from shifting the fixed nav
  useEffect(() => {
    document.body.style.overscrollBehavior = 'none';
    document.documentElement.style.overscrollBehavior = 'none';
    return () => {
      document.body.style.overscrollBehavior = '';
      document.documentElement.style.overscrollBehavior = '';
    };
  }, []);

  const navItems = [
    { icon: Home, label: 'Home', path: '/' },
    { icon: Calendar, label: 'Matchup', path: activeLeagueId ? `/matchup/${activeLeagueId}` : '/matchup', requiresLeague: true },
    { icon: Users, label: 'Roster', path: '/roster', requiresLeague: true },
    { icon: BarChart3, label: 'Standings', path: '/standings', requiresLeague: true },
    { icon: User, label: user ? 'Profile' : 'Sign In', path: user ? '/profile' : '/auth' },
  ];

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  // Don't show on auth pages or certain routes
  const hideOnRoutes = ['/auth', '/draft-room'];
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
        /* GPU-promote without willChange to avoid iOS fixed-position drift */
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
      }}
    >
      {/* iOS-style blur overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#E8EED9] to-[#E8EED9]/90 -z-10" />

      <div className="flex items-center justify-around px-2 h-[4.5rem]">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);
          const disabled = item.requiresLeague && !activeLeagueId;

          let actualPath = item.path;
          if (item.requiresLeague && activeLeagueId) {
            actualPath = `${item.path}/${activeLeagueId}`;
          }

          return (
            <Link
              key={item.path}
              to={disabled ? '#' : actualPath}
              className={cn(
                "flex flex-col items-center justify-center gap-1 py-2 px-3 min-w-[64px] rounded-2xl transition-all duration-200",
                "ios-pressable",
                active && "bg-citrus-sage/20",
                disabled && "opacity-40 pointer-events-none"
              )}
              onClick={(e) => {
                if (disabled) e.preventDefault();
              }}
            >
              <div className={cn(
                "relative flex items-center justify-center w-8 h-8 rounded-xl transition-all duration-300",
                active && "bg-citrus-sage shadow-sm"
              )}>
                <Icon
                  className={cn(
                    "w-5 h-5 transition-colors duration-200",
                    active ? "text-[#E8EED9]" : "text-citrus-charcoal/70"
                  )}
                />
                {active && (
                  <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-citrus-orange" />
                )}
              </div>
              <span className={cn(
                "text-[10px] font-display font-semibold tracking-tight transition-colors duration-200",
                active ? "text-citrus-forest" : "text-citrus-charcoal/60"
              )}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Home indicator line (iPhone style) */}
      <div className="flex justify-center pb-1">
        <div className="w-32 h-1 rounded-full bg-citrus-charcoal/20" />
      </div>
    </nav>
  );
};

export default MobileBottomNav;
