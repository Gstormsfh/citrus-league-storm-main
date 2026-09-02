import { getTeamInfo } from '@/types/captracker';
import { cn } from '@/lib/utils';

/**
 * Player monogram chip — license-clean stand-in for an NHL player's
 * headshot. Initials in cream over team primary color, jersey number
 * in a tabular monospace badge bottom-right. Differentiated from
 * <TeamChip /> by being squared (not round) and carrying both
 * identity (initials) and number.
 *
 * Use this everywhere a player appears in a list, table, hero card,
 * or comparison drawer. Never use a real photo (NHL licensing).
 */

export type PlayerMonogramSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface PlayerMonogramProps {
  /** Player full name — used to derive initials and aria-label */
  fullName: string;
  /** NHL team abbreviation (e.g. "EDM"). Drives the background color. */
  teamAbbrev?: string | null;
  /** Jersey number (e.g. 97). Optional — hidden when absent. */
  jerseyNumber?: string | number | null;
  /** Size preset. xs: 28px, sm: 40px, md: 56px, lg: 80px, xl: 112px. */
  size?: PlayerMonogramSize;
  /** Highlight ring (e.g. selected player in a comparison). */
  isHighlighted?: boolean;
  /** Sample-size badge — shown when player has insufficient data. */
  isLowSample?: boolean;
  /** Skeleton shimmer state for async loads. */
  isLoading?: boolean;
  /** Adds a subtle hover lift + ring brighten. Disabled by default to
   *  preserve table-row density; enable on hero/list cards. */
  interactive?: boolean;
  className?: string;
}

const SIZE_STYLES: Record<
  PlayerMonogramSize,
  { box: string; initials: string; jersey: string; jerseyOffset: string; rounded: string }
> = {
  xs: {
    box: 'w-7 h-7',
    initials: 'text-[10px]',
    jersey: 'text-[7px] px-1 py-px min-w-[14px]',
    jerseyOffset: '-bottom-0.5 -right-0.5',
    rounded: 'rounded-md',
  },
  sm: {
    box: 'w-10 h-10',
    initials: 'text-[13px]',
    jersey: 'text-[8px] px-1 py-px min-w-[16px]',
    jerseyOffset: '-bottom-1 -right-1',
    rounded: 'rounded-lg',
  },
  md: {
    box: 'w-14 h-14',
    initials: 'text-[18px]',
    jersey: 'text-[10px] px-1.5 py-0.5 min-w-[20px]',
    jerseyOffset: '-bottom-1.5 -right-1.5',
    rounded: 'rounded-xl',
  },
  lg: {
    box: 'w-20 h-20',
    initials: 'text-[26px]',
    jersey: 'text-[11px] px-2 py-0.5 min-w-[24px]',
    jerseyOffset: '-bottom-2 -right-2',
    rounded: 'rounded-2xl',
  },
  xl: {
    box: 'w-28 h-28',
    initials: 'text-[36px]',
    jersey: 'text-[13px] px-2.5 py-1 min-w-[28px]',
    jerseyOffset: '-bottom-2 -right-2',
    rounded: 'rounded-2xl',
  },
};

function deriveInitials(fullName: string): string {
  const cleaned = fullName.trim();
  if (!cleaned) return '??';
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  const first = parts[0][0] ?? '';
  const last = parts[parts.length - 1][0] ?? '';
  return (first + last).toUpperCase() || '??';
}

export function PlayerMonogram({
  fullName,
  teamAbbrev,
  jerseyNumber,
  size = 'sm',
  isHighlighted = false,
  isLowSample = false,
  isLoading = false,
  interactive = false,
  className,
}: PlayerMonogramProps) {
  const sizing = SIZE_STYLES[size];
  const teamInfo = teamAbbrev ? getTeamInfo(teamAbbrev) : null;
  const bg = teamInfo?.primaryColor || '#3E5A3E';
  const teamLabel = teamInfo?.fullName || teamAbbrev || 'Free agent';

  if (isLoading) {
    return (
      <div
        role="img"
        aria-label={`Loading player ${fullName || ''}`}
        className={cn(
          sizing.box,
          sizing.rounded,
          'bg-pastel-surface-high animate-pulse ring-1 ring-white/10 flex-shrink-0',
          className,
        )}
      />
    );
  }

  const initials = deriveInitials(fullName);
  const jerseyDisplay =
    jerseyNumber !== null && jerseyNumber !== undefined && jerseyNumber !== ''
      ? `#${jerseyNumber}`
      : null;

  return (
    <div
      role="img"
      aria-label={`${fullName}, ${teamLabel}${jerseyDisplay ? `, jersey ${jerseyDisplay}` : ''}${isLowSample ? ', limited sample size' : ''}`}
      title={`${fullName} · ${teamLabel}${jerseyDisplay ? ` · ${jerseyDisplay}` : ''}`}
      className={cn(
        'relative flex-shrink-0',
        sizing.box,
        sizing.rounded,
        'flex items-center justify-center',
        'ring-1',
        isHighlighted
          ? 'ring-pastel-orange/70 shadow-[0_0_24px_-6px_rgba(255,107,26,0.5)]'
          : 'ring-white/20',
        interactive &&
          'transition-all duration-200 hover:-translate-y-0.5 hover:ring-white/40',
        className,
      )}
      style={{ background: bg }}
    >
      <span
        className={cn(
          'font-jbmono font-black text-white tabular-nums tracking-tight pointer-events-none select-none',
          sizing.initials,
        )}
        style={{ textShadow: '0 1px 2px rgba(0,0,0,0.35)' }}
      >
        {initials}
      </span>

      {jerseyDisplay && size !== 'xs' && (
        <span
          className={cn(
            'absolute font-jbmono font-bold tabular-nums tracking-tight',
            'bg-pastel-surface text-pastel-cream',
            'ring-1 ring-white/15 rounded-full',
            'flex items-center justify-center',
            sizing.jersey,
            sizing.jerseyOffset,
          )}
        >
          {jerseyDisplay}
        </span>
      )}

      {isLowSample && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute -top-1 -right-1',
            'font-jbmono font-bold text-[8px] tracking-tight',
            'bg-pastel-butter text-pastel-surface',
            'rounded-full px-1 py-px ring-1 ring-pastel-surface',
          )}
          title="Limited sample: fewer than 20 GP"
        >
          SS
        </span>
      )}
    </div>
  );
}
