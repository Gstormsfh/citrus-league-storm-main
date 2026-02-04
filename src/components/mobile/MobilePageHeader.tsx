import { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface MobilePageHeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  backPath?: string;
  rightAction?: ReactNode;
  className?: string;
  /** Large title style (iOS style) - default true on mobile */
  largeTitle?: boolean;
}

/**
 * MobilePageHeader - iOS-style page header with large title support
 * Use this component at the top of pages for consistent mobile styling
 */
const MobilePageHeader = ({
  title,
  subtitle,
  showBack = false,
  backPath,
  rightAction,
  className,
  largeTitle = true,
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
      "lg:hidden px-4 pt-2 pb-3",
      className
    )}>
      {/* Navigation row (back button + right action) */}
      {(showBack || rightAction) && (
        <div className="flex items-center justify-between h-11 -mx-2 mb-1">
          {showBack ? (
            <Button
              variant="ghost"
              size="sm"
              className="touch-target ios-pressable text-citrus-sage font-semibold text-[15px] -ml-1"
              onClick={handleBack}
            >
              <ChevronLeft className="h-5 w-5 mr-0.5" />
              Back
            </Button>
          ) : (
            <div />
          )}
          
          {rightAction && (
            <div className="flex items-center">
              {rightAction}
            </div>
          )}
        </div>
      )}

      {/* Large title - iOS style */}
      {largeTitle ? (
        <div className="pt-1">
          <h1 className="text-[28px] font-varsity font-black text-citrus-forest tracking-tight leading-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="text-[15px] text-citrus-charcoal/60 mt-0.5 font-display">
              {subtitle}
            </p>
          )}
        </div>
      ) : (
        // Compact title for inline headers
        <div className="flex items-center justify-center h-11">
          <h1 className="text-[17px] font-varsity font-bold text-citrus-forest">
            {title}
          </h1>
        </div>
      )}
    </div>
  );
};

export default MobilePageHeader;

/**
 * Hook to detect if current device is mobile for conditional rendering
 */
export const useShowMobileHeader = () => {
  // Only show on screens smaller than lg breakpoint
  if (typeof window === 'undefined') return false;
  return window.innerWidth < 1024;
};
