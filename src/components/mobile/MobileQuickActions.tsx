import { ReactNode, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { ArrowLeftRight, Trash2, Star, Info } from 'lucide-react';

interface QuickAction {
  id: string;
  label: string;
  icon: ReactNode;
  color: 'red' | 'blue' | 'green' | 'orange' | 'gray';
  onClick: () => void;
}

interface MobileQuickActionsProps {
  children: ReactNode;
  actions: QuickAction[];
  className?: string;
}

const colorClasses = {
  red: 'bg-red-500',
  blue: 'bg-blue-500',
  green: 'bg-citrus-sage',
  orange: 'bg-citrus-orange',
  gray: 'bg-gray-500',
};

/**
 * MobileQuickActions - iOS-style swipe-to-reveal actions
 * Wrap any row/card component to add swipeable actions
 */
const MobileQuickActions = ({
  children,
  actions,
  className,
}: MobileQuickActionsProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [startX, setStartX] = useState(0);
  const [currentX, setCurrentX] = useState(0);
  
  const actionWidth = 72; // Width of each action button
  const maxSwipe = actions.length * actionWidth;

  const handleTouchStart = (e: React.TouchEvent) => {
    setStartX(e.touches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const diff = startX - e.touches[0].clientX;
    const newX = Math.max(0, Math.min(diff, maxSwipe));
    setCurrentX(newX);
  };

  const handleTouchEnd = () => {
    // Snap to open or closed based on swipe distance
    if (currentX > maxSwipe / 3) {
      setCurrentX(maxSwipe);
      setIsOpen(true);
    } else {
      setCurrentX(0);
      setIsOpen(false);
    }
  };

  const handleActionClick = (action: QuickAction) => {
    action.onClick();
    // Close after action
    setCurrentX(0);
    setIsOpen(false);
  };

  const closeActions = () => {
    setCurrentX(0);
    setIsOpen(false);
  };

  return (
    <div className={cn("relative overflow-hidden", className)}>
      {/* Background actions */}
      <div className="absolute right-0 top-0 bottom-0 flex">
        {actions.map((action) => (
          <button
            key={action.id}
            className={cn(
              "flex flex-col items-center justify-center w-[72px] h-full text-white ios-pressable",
              colorClasses[action.color]
            )}
            onClick={() => handleActionClick(action)}
          >
            {action.icon}
            <span className="text-[10px] font-medium mt-1">{action.label}</span>
          </button>
        ))}
      </div>

      {/* Main content - swipeable */}
      <div
        ref={containerRef}
        className="relative bg-white transition-transform duration-200 ease-out"
        style={{
          transform: `translateX(-${currentX}px)`,
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={isOpen ? closeActions : undefined}
      >
        {children}
      </div>
    </div>
  );
};

export default MobileQuickActions;

/**
 * Pre-configured action sets for common use cases
 */
// eslint-disable-next-line react-refresh/only-export-components
export const PlayerCardActions = {
  roster: (onDrop: () => void, onTrade: () => void, onInfo: () => void): QuickAction[] => [
    {
      id: 'info',
      label: 'Info',
      icon: <Info className="h-5 w-5" />,
      color: 'blue',
      onClick: onInfo,
    },
    {
      id: 'trade',
      label: 'Trade',
      icon: <ArrowLeftRight className="h-5 w-5" />,
      color: 'orange',
      onClick: onTrade,
    },
    {
      id: 'drop',
      label: 'Drop',
      icon: <Trash2 className="h-5 w-5" />,
      color: 'red',
      onClick: onDrop,
    },
  ],
  
  freeAgent: (onAdd: () => void, onWatch: () => void, onInfo: () => void): QuickAction[] => [
    {
      id: 'info',
      label: 'Info',
      icon: <Info className="h-5 w-5" />,
      color: 'blue',
      onClick: onInfo,
    },
    {
      id: 'watch',
      label: 'Watch',
      icon: <Star className="h-5 w-5" />,
      color: 'orange',
      onClick: onWatch,
    },
    {
      id: 'add',
      label: 'Add',
      icon: <ArrowLeftRight className="h-5 w-5" />,
      color: 'green',
      onClick: onAdd,
    },
  ],
};
