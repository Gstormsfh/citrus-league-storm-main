import { ReactNode, useEffect, useState } from 'react';
import MobileBottomNav from './MobileBottomNav';
import { cn } from '@/lib/utils';

interface AppShellProps {
  children: ReactNode;
  hideBottomNav?: boolean;
}

/**
 * AppShell - Wrapper component that provides iOS-style app layout
 * Handles safe areas, bottom navigation, and responsive behavior
 */
const AppShell = ({ children, hideBottomNav = false }: AppShellProps) => {
  const [isMobile, setIsMobile] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Check if running as iOS standalone app
    const checkStandalone = () => {
      const standalone = (window.navigator as any).standalone === true ||
        window.matchMedia('(display-mode: standalone)').matches;
      setIsStandalone(standalone);
    };

    // Check screen size for mobile
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };

    checkStandalone();
    checkMobile();

    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return (
    <div 
      className={cn(
        "min-h-screen flex flex-col bg-[#D4E8B8]",
        "ios-scroll",
        // Add padding for safe areas when in standalone mode
        isStandalone && "pt-[env(safe-area-inset-top)]"
      )}
    >
      {/* Main content area */}
      <main className={cn(
        "flex-1 w-full",
        // Ensure content doesn't get hidden behind bottom nav on mobile
        isMobile && !hideBottomNav && "pb-safe"
      )}>
        {children}
      </main>

      {/* Mobile bottom navigation */}
      {!hideBottomNav && <MobileBottomNav />}
    </div>
  );
};

export default AppShell;

/**
 * Hook to detect if user is on a mobile device
 */
export const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      // Check both screen width and touch capability
      const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const isSmallScreen = window.innerWidth < 1024;
      setIsMobile(isTouchDevice && isSmallScreen);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return isMobile;
};

/**
 * Hook to detect if app is running in standalone mode (added to home screen)
 */
export const useIsStandalone = () => {
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const standalone = (window.navigator as any).standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches;
    setIsStandalone(standalone);
  }, []);

  return isStandalone;
};
