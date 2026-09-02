import { cn } from '@/lib/utils';

/* 2026-08-19 visual audit — muted-text correction.
   text-citrus-charcoal is #5C5C5C, a soft charcoal designed for the
   original CREAM theme. At 20-70% opacity on the dark #1A2A20 tiles it
   composites to near-invisible (team codes on this page measured
   1.47:1). Remapped to cream at the alpha that preserves the intended
   hierarchy while clearing 4.5:1 on a dark tile. */


interface PlayerAvatarProps {
  name: string;
  position: string;
  jerseyNumber?: number;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const positionColors: Record<string, { bg: string; border: string; text: string }> = {
  C: { bg: 'from-citrus-sage/40 to-[#7CB518]/30', border: 'border-citrus-sage', text: 'text-pastel-cream' },
  LW: { bg: 'from-[#7CB518]/40 to-citrus-sage/30', border: 'border-[#7CB518]/70', text: 'text-pastel-cream' },
  RW: { bg: 'from-citrus-orange/30 to-citrus-peach/40', border: 'border-citrus-orange/60', text: 'text-pastel-cream' },
  D: { bg: 'from-blue-200/50 to-blue-300/30', border: 'border-blue-400/60', text: 'text-pastel-cream' },
  G: { bg: 'from-purple-200/50 to-purple-300/30', border: 'border-purple-400/60', text: 'text-pastel-cream' },
};

const sizeMap = {
  xs: { container: 'w-6 h-6', initials: 'text-[8px]', number: 'text-[6px]' },
  sm: { container: 'w-8 h-8', initials: 'text-[10px]', number: 'text-[7px]' },
  md: { container: 'w-10 h-10', initials: 'text-xs', number: 'text-[8px]' },
  lg: { container: 'w-14 h-14', initials: 'text-sm', number: 'text-[9px]' },
};

function getInitials(name: string): string {
  const parts = name.split(' ');
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

function getPositionKey(position: string): string {
  const p = position?.toUpperCase() || '';
  if (['C', 'CENTRE', 'CENTER'].includes(p)) return 'C';
  if (['LW', 'LEFT WING', 'L'].includes(p)) return 'LW';
  if (['RW', 'RIGHT WING', 'R'].includes(p)) return 'RW';
  if (['D', 'DEFENCE', 'DEFENSE', 'LD', 'RD'].includes(p)) return 'D';
  if (['G', 'GOALIE'].includes(p)) return 'G';
  return 'C';
}

export default function PlayerAvatar({ name, position, jerseyNumber, size = 'md', className }: PlayerAvatarProps) {
  const posKey = getPositionKey(position);
  const colors = positionColors[posKey] || positionColors.C;
  const sizing = sizeMap[size];
  const initials = getInitials(name);

  return (
    <div
      className={cn(
        sizing.container,
        "rounded-full flex-shrink-0 flex flex-col items-center justify-center",
        `bg-gradient-to-br ${colors.bg}`,
        `border-2 ${colors.border}`,
        "shadow-sm relative overflow-hidden",
        className,
      )}
    >
      {/* Subtle texture */}
      <div className="absolute inset-0 opacity-10" style={{
        backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.3) 2px, rgba(255,255,255,0.3) 4px)',
      }} />

      {/* Initials */}
      <span className={cn(sizing.initials, colors.text, "font-varsity font-bold leading-none relative z-10")}>
        {initials}
      </span>

      {/* Jersey number (only show on md and lg) */}
      {jerseyNumber !== undefined && jerseyNumber > 0 && (size === 'md' || size === 'lg') && (
        <span className={cn(sizing.number, "text-pastel-cream/65 font-display font-bold leading-none relative z-10 -mt-px")}>
          #{jerseyNumber}
        </span>
      )}
    </div>
  );
}
