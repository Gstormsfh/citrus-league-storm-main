import { getTeamInfo } from '@/types/captracker';

/**
 * Round monogram chip showing an NHL team abbreviation, colored with the team's
 * real primary color from `getTeamInfo()`. License-clean (no logos), recognizable.
 */
export function TeamChip({
  abbrev,
  size = 'sm',
  className = '',
}: {
  abbrev: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const info = getTeamInfo(abbrev);
  const bg = info?.primaryColor || '#84A57D';
  const dim =
    size === 'lg'
      ? 'w-12 h-12 text-[12px]'
      : size === 'md'
      ? 'w-9 h-9 text-[10px]'
      : size === 'xs'
      ? 'w-5 h-5 text-[8px]'
      : 'w-7 h-7 text-[9px]';
  return (
    <div
      className={`${dim} rounded-full flex items-center justify-center font-jbmono font-bold text-white ring-1 ring-white/20 flex-shrink-0 ${className}`}
      style={{ background: bg }}
      title={info?.fullName || abbrev}
      aria-label={info?.fullName || abbrev}
    >
      {abbrev}
    </div>
  );
}

/**
 * Thin colored bar (vertical accent stripe) using a team's primary color.
 * Use when a full chip is too heavy — bracket rows, list separators.
 */
export function TeamColorBar({ abbrev, className = '' }: { abbrev: string; className?: string }) {
  const info = getTeamInfo(abbrev);
  return (
    <span
      className={`inline-block w-1.5 h-3 rounded-sm flex-shrink-0 ${className}`}
      style={{ background: info?.primaryColor || '#84A57D' }}
      aria-hidden="true"
    />
  );
}
