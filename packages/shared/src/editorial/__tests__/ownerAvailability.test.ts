import { describe, expect, it } from 'vitest';
import ownerSet from './fixtures/ownerAvailability20260912.json';
import { canonicalEditorialContext } from '../canonicalContext';

describe('complete owner-maintained injury baseline, September 12', () => {
  it('explains every marked injury with its source/date and without truncation or new return promises', () => {
    expect(ownerSet).toHaveLength(13);
    expect(ownerSet.filter(p => p.context.availability.status === 'out')).toHaveLength(10);
    for (const player of ownerSet) {
      const result = canonicalEditorialContext(player, player.context, new Date('2026-09-13T18:00:00Z'));
      expect(result.availabilityExplanation, player.name).toContain(player.name);
      const adopted = 'confirmation_scope' in player.context.availability.source;
      expect(result.availabilityExplanation, player.name).toContain(adopted ? 'Owner-maintained availability baseline' : 'Reviewed availability record');
      expect(result.availabilityExplanation, player.name).toContain(player.context.availability.as_of);
      if (adopted) expect(result.availabilityExplanation, player.name).toContain('Return timing is unconfirmed');
      expect(result.availabilityExplanation, player.name).not.toContain('…');
      expect(result.availability?.authority).toBe('reviewed_report');
      expect(result.analysis, player.name).not.toContain('note: Current availability');
    }
  });
  it('expires old evidence and reflects a changed published reason without changing code or rates', () => {
    const player = ownerSet[0];
    expect(canonicalEditorialContext(player, player.context, new Date('2026-09-20')).availabilityExplanation).toBeUndefined();
    const context = structuredClone(player.context);
    context.revision = 'new-publication';
    context.availability.reason = 'Owner updated the working injury context; return timing remains unknown.';
    const result = canonicalEditorialContext(player, context, new Date('2026-09-13'));
    expect(result.availabilityExplanation).toContain(context.availability.reason);
    expect(result.revision).toBe('new-publication');
    expect(player.context.availability.reason).not.toBe(context.availability.reason);
  });
});
