import { cn } from '@/lib/utils';

interface PlayerAvatarProps {
  name: string;
  position: string;
  jerseyNumber?: number;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const positionColors: Record<string, { bg: string; border: string; text: string }> = {
  C: { bg: 'from-citrus-sage/22 to-[#7CB518]/16', border: 'border-citrus-sage', text: 'text-pastel-cream' },
  LW: { bg: 'from-[#7CB518]/22 to-citrus-sage/16', border: 'border-[#7CB518]/70', text: 'text-pastel-cream' },
  RW: { bg: 'from-citrus-orange/16 to-citrus-peach/22', border: 'border-citrus-orange/60', text: 'text-pastel-cream' },
  D: { bg: 'from-blue-200/28 to-blue-300/18', border: 'border-blue-400/60', text: 'text-blue-200' },
  G: { bg: 'from-purple-200/28 to-purple-300/18', border: 'border-purple-400/60', text: 'text-purple-200' },
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
        <span className={cn(sizing.number, "text-white/85 font-display font-bold leading-none relative z-10 -mt-px")}>
          #{jerseyNumber}
        </span>
      )}
    </div>
  );
}
