import { Link, useLocation } from 'react-router-dom';
import { Home, Calendar, Users, LineChart, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

const MobileBottomNav = () => {
  const location = useLocation();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Don't render on desktop
  if (!isMobile) {
    return null;
  }

  const navItems = [
    { icon: Home, label: 'Home', path: '/' },
    { icon: Calendar, label: 'Matchup', path: '/matchup' },
    { icon: Users, label: 'Roster', path: '/roster' },
    { icon: LineChart, label: 'Standings', path: '/standings' },
    { icon: User, label: 'Profile', path: '/profile' },
  ];

  return (
    <nav 
      className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border/50"
      style={{ 
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        paddingBottom: 'env(safe-area-inset-bottom)',
        boxShadow: '0 -2px 10px rgba(0, 0, 0, 0.1)',
        transform: 'translateZ(0)',
        willChange: 'transform',
        WebkitTransform: 'translateZ(0)',
      }}
    >
      <div className="flex h-14 items-center justify-around px-4">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path || 
            (item.path !== '/' && location.pathname.startsWith(item.path));
          const Icon = item.icon;
          
          return (
            <Link
              key={item.label}
              to={item.path}
              className={cn(
                "flex flex-col items-center justify-center h-full w-full text-xs font-medium transition-colors duration-200 min-w-[44px] min-h-[44px]",
                isActive ? "text-primary" : "text-muted-foreground"
              )}
            >
              <Icon className={cn("h-5 w-5 mb-0.5", isActive && "fill-primary/20")} />
              <span className="text-[10px]">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
};

export default MobileBottomNav;
