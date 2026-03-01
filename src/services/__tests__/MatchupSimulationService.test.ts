import { describe, it, expect, vi } from 'vitest';

// Mock supabase client to avoid env var requirement in tests
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => Promise.resolve({ data: [], error: null })),
          })),
        })),
      })),
    })),
  },
}));

import { MatchupSimulationService } from '../MatchupSimulationService';

describe('MatchupSimulationService', () => {
  describe('formatWinProbability', () => {
    it('formats standard probabilities correctly', () => {
      expect(MatchupSimulationService.formatWinProbability(0.642)).toBe('64.2%');
      expect(MatchupSimulationService.formatWinProbability(0.123)).toBe('12.3%');
      expect(MatchupSimulationService.formatWinProbability(0.999)).toBe('99.9%');
    });

    it('returns 50/50 for near-even probabilities', () => {
      expect(MatchupSimulationService.formatWinProbability(0.5)).toBe('50/50');
      expect(MatchupSimulationService.formatWinProbability(0.498)).toBe('50/50');
      expect(MatchupSimulationService.formatWinProbability(0.503)).toBe('50/50');
    });

    it('does not return 50/50 for probabilities outside threshold', () => {
      expect(MatchupSimulationService.formatWinProbability(0.51)).not.toBe('50/50');
      expect(MatchupSimulationService.formatWinProbability(0.49)).not.toBe('50/50');
    });
  });

  describe('getConfidenceLevel', () => {
    it('returns Very High for extreme probabilities', () => {
      expect(MatchupSimulationService.getConfidenceLevel(0.90).label).toBe('Very High');
      expect(MatchupSimulationService.getConfidenceLevel(0.10).label).toBe('Very High');
    });

    it('returns High for strong probabilities', () => {
      expect(MatchupSimulationService.getConfidenceLevel(0.75).label).toBe('High');
      expect(MatchupSimulationService.getConfidenceLevel(0.25).label).toBe('High');
    });

    it('returns Moderate for moderate probabilities', () => {
      expect(MatchupSimulationService.getConfidenceLevel(0.65).label).toBe('Moderate');
      expect(MatchupSimulationService.getConfidenceLevel(0.35).label).toBe('Moderate');
    });

    it('returns Slight for near-even probabilities', () => {
      expect(MatchupSimulationService.getConfidenceLevel(0.56).label).toBe('Slight');
      expect(MatchupSimulationService.getConfidenceLevel(0.44).label).toBe('Slight');
    });

    it('returns Toss-Up for very close probabilities', () => {
      expect(MatchupSimulationService.getConfidenceLevel(0.52).label).toBe('Toss-Up');
      expect(MatchupSimulationService.getConfidenceLevel(0.50).label).toBe('Toss-Up');
    });

    it('uses the higher side for symmetry', () => {
      // P=0.3 should use P=0.7 for the level check
      const resultLow = MatchupSimulationService.getConfidenceLevel(0.30);
      const resultHigh = MatchupSimulationService.getConfidenceLevel(0.70);
      expect(resultLow.label).toBe(resultHigh.label);
    });
  });

  describe('getBrierRating', () => {
    it('returns Excellent for scores below 0.10', () => {
      expect(MatchupSimulationService.getBrierRating(0.05).label).toBe('Excellent');
      expect(MatchupSimulationService.getBrierRating(0.09).label).toBe('Excellent');
    });

    it('returns Good for scores between 0.10 and 0.15', () => {
      expect(MatchupSimulationService.getBrierRating(0.12).label).toBe('Good');
    });

    it('returns Adequate for scores between 0.15 and 0.20', () => {
      expect(MatchupSimulationService.getBrierRating(0.17).label).toBe('Adequate');
    });

    it('returns Poor for scores between 0.20 and 0.25', () => {
      expect(MatchupSimulationService.getBrierRating(0.22).label).toBe('Poor');
    });

    it('returns No Skill for scores above 0.25', () => {
      expect(MatchupSimulationService.getBrierRating(0.30).label).toBe('No Skill');
    });

    it('returns Pending for null', () => {
      expect(MatchupSimulationService.getBrierRating(null).label).toBe('Pending');
    });
  });

  describe('isStale', () => {
    it('returns false for recent simulations', () => {
      const recent = {
        simulatedAt: new Date().toISOString(),
      } as any;
      expect(MatchupSimulationService.isStale(recent, 60)).toBe(false);
    });

    it('returns true for old simulations', () => {
      const old = {
        simulatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
      } as any;
      expect(MatchupSimulationService.isStale(old, 60)).toBe(true);
    });

    it('uses configurable max age', () => {
      const thirtyMinAgo = {
        simulatedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      } as any;
      expect(MatchupSimulationService.isStale(thirtyMinAgo, 60)).toBe(false);
      expect(MatchupSimulationService.isStale(thirtyMinAgo, 20)).toBe(true);
    });
  });
});
