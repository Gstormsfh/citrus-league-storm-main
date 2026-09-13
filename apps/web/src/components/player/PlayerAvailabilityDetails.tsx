import { availabilityDescription, currentPlayerAvailability, type CanonicalProjectionContext, type PlayerAvailability } from '@citrus/shared';
import { canonicalEditorialContext } from '@citrus/shared/editorial';

/** Shared by modal entry points and the full dashboard. Data comes from the
 * refreshed published index; no injury text or return dates are bundled here. */
export function PlayerAvailabilityDetails({ playerId, name, context, availability }: {
  playerId: string | number;
  name: string;
  context?: CanonicalProjectionContext | null;
  availability?: PlayerAvailability | null;
}) {
  const current = currentPlayerAvailability(availability);
  if (!availability || current.status === 'healthy') return null;
  if (current.status === 'unknown' && !current.stale) return null;
  const canonical = current.revision === context?.revision
    ? canonicalEditorialContext({ id: playerId, name }, context).availabilityExplanation : null;
  const explanation = canonical || `${name}: ${availabilityDescription(current)}`;
  return <section aria-label="Availability explanation" className="rounded-xl border border-white/10 bg-pressbox-tile p-3 text-pressbox-text">
    <h3 className="text-sm font-semibold">{current.status === 'suspended' ? 'Suspension context' : 'Availability context'}</h3>
    <p className="mt-1 text-sm leading-relaxed text-pressbox-text/75">{explanation}</p>
  </section>;
}
