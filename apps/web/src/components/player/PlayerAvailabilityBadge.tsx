import { availabilityDescription, availabilityLabel, currentPlayerAvailability, type PlayerAvailability } from '@citrus/shared';
import { badgeVariants } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** Current dated evidence only; fantasy IR eligibility remains a separate rule. */
export function PlayerAvailabilityBadge({ availability, className }: {
  availability?: PlayerAvailability | null;
  className?: string;
}) {
  const current = currentPlayerAvailability(availability);
  // NO PILL FOR NO EVIDENCE (2026-09-14). The resolver is right that absence
  // from a feed is not "healthy" — but a pill reading "Unknown" on every
  // player without a report is the majority of the league wearing a badge
  // that says nothing. Unknown, fresh or expired, renders nothing here; the
  // details card still explains expired evidence where a reader asked.
  if (current.status === 'unknown') return null;
  const description = availabilityDescription(current);
  const color = current.status === 'healthy' ? 'bg-green-700 text-white'
    : current.status === 'suspended' ? 'bg-orange-500 text-white'
    : current.status === 'day_to_day' ? 'bg-yellow-500 text-black'
    : 'bg-red-500 text-white';
  return <span title={description} aria-label={description}
    data-availability-status={current.status}
    className={cn(badgeVariants({ variant: 'outline' }), 'text-[10px] leading-tight px-1 py-0 shrink-0', color, className)}>
    {availabilityLabel(current)}
  </span>;
}
