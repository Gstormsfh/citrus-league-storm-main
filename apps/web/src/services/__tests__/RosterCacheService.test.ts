import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =============================================================================
// Import (no external mocks needed — RosterCacheService is a pure in-memory cache)
// =============================================================================

import { RosterCacheService } from '../RosterCacheService';

// =============================================================================
// Tests
// =============================================================================

describe('RosterCacheService', () => {
  beforeEach(() => {
    RosterCacheService.clearCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const sampleLineup = {
    starters: ['p1', 'p2', 'p3'],
    bench: ['p4', 'p5'],
    ir: ['p6'],
    slotAssignments: { p1: 'slot-C-1', p2: 'slot-LW-1', p3: 'slot-D-1' },
  };

  // ---------------------------------------------------------------------------
  // set / get
  // ---------------------------------------------------------------------------
  describe('set and get', () => {
    it('stores and retrieves a lineup', () => {
      RosterCacheService.set('team-1', 'league-1', sampleLineup);

      const result = RosterCacheService.get('team-1', 'league-1');

      expect(result).not.toBeNull();
      expect(result?.starters).toEqual(['p1', 'p2', 'p3']);
      expect(result?.bench).toEqual(['p4', 'p5']);
      expect(result?.ir).toEqual(['p6']);
      expect(result?.slotAssignments).toEqual(sampleLineup.slotAssignments);
    });

    it('returns null for non-existent key', () => {
      const result = RosterCacheService.get('team-999', 'league-999');

      expect(result).toBeNull();
    });

    it('sets timestamp on cached entry', () => {
      const before = Date.now();
      RosterCacheService.set('team-1', 'league-1', sampleLineup);
      const after = Date.now();

      const result = RosterCacheService.get('team-1', 'league-1');

      expect(result?.timestamp).toBeGreaterThanOrEqual(before);
      expect(result?.timestamp).toBeLessThanOrEqual(after);
    });

    it('overwrites existing cache entry', () => {
      RosterCacheService.set('team-1', 'league-1', sampleLineup);

      const newLineup = {
        starters: ['p10'],
        bench: ['p11'],
        ir: [],
        slotAssignments: { p10: 'slot-C-1' },
      };
      RosterCacheService.set('team-1', 'league-1', newLineup);

      const result = RosterCacheService.get('team-1', 'league-1');

      expect(result?.starters).toEqual(['p10']);
    });
  });

  // ---------------------------------------------------------------------------
  // TTL expiration
  // ---------------------------------------------------------------------------
  describe('TTL expiration', () => {
    it('returns null when entry has expired (> 2 minutes)', () => {
      vi.useFakeTimers();

      RosterCacheService.set('team-1', 'league-1', sampleLineup);

      // Advance past 2-minute TTL
      vi.advanceTimersByTime(2 * 60 * 1000 + 1);

      const result = RosterCacheService.get('team-1', 'league-1');

      expect(result).toBeNull();
    });

    it('returns data within TTL window', () => {
      vi.useFakeTimers();

      RosterCacheService.set('team-1', 'league-1', sampleLineup);

      // Advance within TTL
      vi.advanceTimersByTime(60 * 1000);

      const result = RosterCacheService.get('team-1', 'league-1');

      expect(result).not.toBeNull();
      expect(result?.starters).toEqual(sampleLineup.starters);
    });
  });

  // ---------------------------------------------------------------------------
  // clearCache
  // ---------------------------------------------------------------------------
  describe('clearCache', () => {
    it('clears specific team cache when both teamId and leagueId provided', () => {
      RosterCacheService.set('team-1', 'league-1', sampleLineup);
      RosterCacheService.set('team-2', 'league-1', {
        starters: ['p100'],
        bench: [],
        ir: [],
        slotAssignments: {},
      });

      RosterCacheService.clearCache('team-1', 'league-1');

      expect(RosterCacheService.get('team-1', 'league-1')).toBeNull();
      expect(RosterCacheService.get('team-2', 'league-1')).not.toBeNull();
    });

    it('clears all entries for a league when only leagueId provided', () => {
      RosterCacheService.set('team-1', 'league-1', sampleLineup);
      RosterCacheService.set('team-2', 'league-1', {
        starters: ['p100'],
        bench: [],
        ir: [],
        slotAssignments: {},
      });
      RosterCacheService.set('team-3', 'league-2', {
        starters: ['p200'],
        bench: [],
        ir: [],
        slotAssignments: {},
      });

      RosterCacheService.clearCache(undefined, 'league-1');

      expect(RosterCacheService.get('team-1', 'league-1')).toBeNull();
      expect(RosterCacheService.get('team-2', 'league-1')).toBeNull();
      expect(RosterCacheService.get('team-3', 'league-2')).not.toBeNull();
    });

    it('clears all caches when no arguments provided', () => {
      RosterCacheService.set('team-1', 'league-1', sampleLineup);
      RosterCacheService.set('team-2', 'league-2', {
        starters: ['p100'],
        bench: [],
        ir: [],
        slotAssignments: {},
      });

      RosterCacheService.clearCache();

      expect(RosterCacheService.get('team-1', 'league-1')).toBeNull();
      expect(RosterCacheService.get('team-2', 'league-2')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Cache key isolation
  // ---------------------------------------------------------------------------
  describe('cache key isolation', () => {
    it('keeps separate caches for different teams in same league', () => {
      RosterCacheService.set('team-A', 'league-1', sampleLineup);
      RosterCacheService.set('team-B', 'league-1', {
        starters: ['x1'],
        bench: ['x2'],
        ir: [],
        slotAssignments: {},
      });

      const a = RosterCacheService.get('team-A', 'league-1');
      const b = RosterCacheService.get('team-B', 'league-1');

      expect(a?.starters).toEqual(sampleLineup.starters);
      expect(b?.starters).toEqual(['x1']);
    });

    it('keeps separate caches for same team in different leagues', () => {
      RosterCacheService.set('team-1', 'league-A', sampleLineup);
      RosterCacheService.set('team-1', 'league-B', {
        starters: ['y1'],
        bench: [],
        ir: [],
        slotAssignments: {},
      });

      const la = RosterCacheService.get('team-1', 'league-A');
      const lb = RosterCacheService.get('team-1', 'league-B');

      expect(la?.starters).toEqual(sampleLineup.starters);
      expect(lb?.starters).toEqual(['y1']);
    });
  });
});
