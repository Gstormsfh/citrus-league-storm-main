import { Link, useLocation } from 'react-router-dom';
import { Home, Trophy, Users, Calendar, User, BarChart3, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import { CitrusSlice } from '@/components/icons/CitrusIcons';

/* 2026-08-19 visual audit — muted-text correction.
   text-citrus-charcoal is #5C5C5C, a soft charcoal designed for the
   original CREAM theme. At 20-70% opacity on the dark #1A2A20 tiles it
   composites to near-invisible (team codes on this page measured
   1.47:1). Remapped to cream at the alpha that preserves the intended
   hierarchy while clearing 4.5:1 on a dark tile. */


interface NavItem {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  requiresAuth?: boolean;
  requiresLeague?: boolean;
}

const MobileBottomNav = () => {
  const location = useLocation();
  const auth = useAuth();
  const league = useLeague();
  const user = auth?.user ?? null;
  const activeLeagueId = league?.activeLeagueId ?? null;

  // Define navigation items - iOS style with 5 main tabs
  const navItems: NavItem[] = [
    {
      path: '/',
      label: 'Home',
      icon: Home,
    },
    {
      path: '/matchup',
      label: 'Matchup',
      icon: Calendar,
      requiresLeague: true,
    },
    {
      path: '/roster',
      label: 'Roster',
      icon: Users,
      requiresLeague: true,
    },
    {
      path: '/standings',
      label: 'Standings',
      icon: BarChart3,
      requiresLeague: true,
    },
    {
      path: user ? '/profile' : '/auth',
      label: user ? 'Profile' : 'Sign In',
      icon: User,
    },
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
    <>
      {/* Bottom Navigation Bar */}
      <nav 
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50 lg:hidden",
          "bg-[#E8EED9]/95 backdrop-blur-xl",
          "border-t border-citrus-sage/30",
          "shadow-[0_-4px_20px_rgba(0,0,0,0.08)]"
        )}
        style={{
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {/* iOS-style blur effect overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#E8EED9] to-[#E8EED9]/90 -z-10" />
        
        <div className="flex items-center justify-around px-2 h-[4.5rem]">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            const disabled = item.requiresLeague && !activeLeagueId;
            
            // Build the actual path (with league ID if needed)
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
                  if (disabled) {
                    e.preventDefault();
                  }
                }}
              >
                {/* Icon container with iOS-style indicator */}
                <div className={cn(
                  "relative flex items-center justify-center w-8 h-8 rounded-xl transition-all duration-300",
                  active && "bg-citrus-sage shadow-sm"
                )}>
                  <Icon 
                    className={cn(
                      "w-5 h-5 transition-colors duration-200",
                      active ? "text-[#E8EED9]" : "text-pastel-cream/75"
                    )} 
                  />
                  
                  {/* Active indicator dot (iOS 17 style) */}
                  {active && (
                    <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-citrus-orange" />
                  )}
                </div>
                
                {/* Label */}
                <span className={cn(
                  "text-[10px] font-display font-semibold tracking-tight transition-colors duration-200",
                  active ? "text-pastel-cream" : "text-pastel-cream/70"
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
    </>
  );
};

export default MobileBottomNav;
