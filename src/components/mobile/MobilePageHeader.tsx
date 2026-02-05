import { ReactNode, useState, useEffect } from 'react';
import { ChevronLeft, MoreHorizontal } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface MobilePageHeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  backPath?: string;
  rightAction?: ReactNode;
  centerContent?: ReactNode;
  className?: string;
  /** Large title style (iOS style) - default false for compact header */
  largeTitle?: boolean;
  /** Transparent background (for overlaying on content) */
  transparent?: boolean;
}

/**
 * MobilePageHeader - iOS-style page header
 * Compact by default to maximize content space
 */
const MobilePageHeader = ({
  title,
  subtitle,
  showBack = false,
  backPath,
  rightAction,
  centerContent,
  className,
  largeTitle = false,
  transparent = false,
}: MobilePageHeaderProps) => {
  const navigate = useNavigate();

  const handleBack = () => {
    if (backPath) {
      navigate(backPath);
    } else {
      navigate(-1);
    }
  };

  return (
    <div className={cn(
      "lg:hidden sticky top-0 z-40",
      !transparent && "bg-[#D4E8B8]/98 backdrop-blur-xl border-b border-citrus-sage/20",
      "pt-[env(safe-area-inset-top)]",
      className
    )}>
      {/* Compact header bar */}
      <div className="flex items-center justify-between h-12 px-4">
        {/* Left side - back button or spacer */}
        <div className="w-20 flex justify-start">
          {showBack ? (
            <Button
              variant="ghost"
              size="sm"
              className="touch-target ios-pressable text-citrus-sage font-semibold text-[15px] -ml-2 h-10 px-2"
              onClick={handleBack}
            >
              <ChevronLeft className="h-5 w-5" />
              <span className="sr-only">Back</span>
            </Button>
          ) : null}
        </div>
        
        {/* Center - title or custom content */}
        <div className="flex-1 flex items-center justify-center">
          {centerContent || (
            <div className="text-center">
              <h1 className="text-[17px] font-varsity font-bold text-citrus-forest truncate max-w-[200px]">
                {title}
              </h1>
              {subtitle && !largeTitle && (
                <p className="text-[11px] text-citrus-charcoal/60 font-display truncate">
                  {subtitle}
                </p>
              )}
            </div>
          )}
        </div>
        
        {/* Right side - action or spacer */}
        <div className="w-20 flex justify-end">
          {rightAction}
        </div>
      </div>

      {/* Large title below (optional - iOS style) */}
      {largeTitle && (
        <div className="px-4 pb-2">
          <h1 className="text-[28px] font-varsity font-black text-citrus-forest tracking-tight leading-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="text-[13px] text-citrus-charcoal/60 mt-0.5 font-display">
              {subtitle}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default MobilePageHeader;

/**
 * Hook to detect if current viewport is mobile
 */
export const useIsMobileView = () => {
  const [isMobile, setIsMobile] = useState(false);
  
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  
  return isMobile;
};

/**
 * Hook to detect if current device is mobile for conditional rendering
 */
export const useShowMobileHeader = () => {
  // Only show on screens smaller than lg breakpoint
  if (typeof window === 'undefined') return false;
  return window.innerWidth < 1024;
};
