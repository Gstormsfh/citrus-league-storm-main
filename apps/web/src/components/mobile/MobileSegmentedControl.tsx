import { cn } from '@/lib/utils';

interface Segment {
  value: string;
  label: string;
  badge?: number;
}

interface MobileSegmentedControlProps {
  segments: Segment[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  fullWidth?: boolean;
}

/**
 * MobileSegmentedControl - iOS-style segmented control
 * Use this for tab-like selection on mobile
 */
const MobileSegmentedControl = ({
  segments,
  value,
  onChange,
  className,
  fullWidth = true,
}: MobileSegmentedControlProps) => {
  return (
    <div className={cn(
      "ios-segmented",
      fullWidth && "w-full",
      className
    )}>
      {segments.map((segment) => (
        <button
          key={segment.value}
          className={cn(
            "ios-segmented-item ios-pressable",
            value === segment.value && "ios-segmented-item-active text-citrus-forest",
            value !== segment.value && "text-citrus-charcoal/70"
          )}
          onClick={() => onChange(segment.value)}
        >
          <span className="truncate">{segment.label}</span>
          {segment.badge !== undefined && segment.badge > 0 && (
            <span className={cn(
              "ml-1.5 px-1.5 py-0.5 text-[10px] font-bold rounded-full min-w-[18px] text-center",
              value === segment.value 
                ? "bg-citrus-orange text-white" 
                : "bg-citrus-charcoal/10 text-citrus-charcoal/70"
            )}>
              {segment.badge > 99 ? '99+' : segment.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
};

export default MobileSegmentedControl;
