import { MASCOTS, type MascotId } from '@/constants/mascots';

/**
 * Decorative mascot floater that peeks from a corner of its parent container.
 * Use sparingly to add Citrus brand personality to cards, sections, and CTAs
 * without overwhelming the content.
 *
 * Parent container should be `relative overflow-hidden` for the peek effect.
 *
 * Sleeper does this constantly — Sleeperbot peeks from the bottom corner of
 * cards, lurks in the seam between sections, etc. It's a huge part of why
 * their UI feels branded vs. generic.
 */
export function MascotPeek({
  id,
  position = 'top-right',
  size = 'md',
  className = '',
}: {
  id: MascotId;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  /** Visual size — `sm` 56px, `md` 80px, `lg` 112px */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const mascot = MASCOTS[id];
  const dim =
    size === 'lg' ? 'w-28 h-28' : size === 'md' ? 'w-20 h-20' : 'w-14 h-14';

  // Half-overlap the corner for the peek effect
  const placement = {
    'top-right': 'absolute -top-4 -right-4 rotate-[12deg]',
    'top-left': 'absolute -top-4 -left-4 -rotate-[12deg]',
    'bottom-right': 'absolute -bottom-4 -right-4 rotate-[6deg]',
    'bottom-left': 'absolute -bottom-4 -left-4 -rotate-[6deg]',
  }[position];

  return (
    <img
      src={mascot.image}
      alt=""
      aria-hidden="true"
      className={`${placement} ${dim} object-cover rounded-full ring-2 ring-white/10 pointer-events-none opacity-90 group-hover:opacity-100 group-hover:scale-105 transition-all duration-300 z-0 ${className}`}
      loading="lazy"
    />
  );
}
