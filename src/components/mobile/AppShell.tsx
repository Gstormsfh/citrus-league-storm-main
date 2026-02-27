import { ReactNode, useEffect, useState } from 'react';
import MobileBottomNav from './MobileBottomNav';
import { cn } from '@/lib/utils';

interface AppShellProps {
  children: ReactNode;
  hideBottomNav?: boolean;
}

/**
 * AppShell - Wrapper component that provides iOS-style app layout
 * Pages handle their own safe area padding for content
 * This component only provides the bottom navigation
 */
const AppShell = ({ children, hideBottomNav = false }: AppShellProps) => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-[#D4E8B8]">
      {/* Main content area - pages handle their own padding */}
      <div className="flex-1 w-full ios-scroll">
        {children}
      </div>

      {/* Mobile bottom navigation - only on mobile */}
      {!hideBottomNav && isMobile && <MobileBottomNav />}
    </div>
  );
};

export default AppShell;

/**
 * Hook to detect if user is on a mobile device
 */
// eslint-disable-next-line react-refresh/only-export-components
export const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
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
// eslint-disable-next-line react-refresh/only-export-components
export const useIsStandalone = () => {
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const standalone = (window.navigator as any).standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches;
    setIsStandalone(standalone);
  }, []);

  return isStandalone;
};
