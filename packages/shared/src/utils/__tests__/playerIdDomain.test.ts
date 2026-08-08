// KI-042 / task #61 (2026-08-08) — unit tests for playerIdDomain utility.
//
// Coverage:
//   - classifyPlayerId: numeric-int, numeric-string, uuid, invalid inputs
//   - coerceToNumericPlayerId: returns int OR null (never throws)
//   - assertNumericPlayerId: returns int OR throws with [KI-042] prefix
//   - partitionPlayerIds: correct partition across mixed-domain array

import { describe, it, expect } from 'vitest';
import {
  classifyPlayerId,
  coerceToNumericPlayerId,
  assertNumericPlayerId,
  partitionPlayerIds,
} from '../playerIdDomain';

describe('classifyPlayerId', () => {
  it('classifies numeric int as numeric', () => {
    expect(classifyPlayerId(8478000)).toBe('numeric');
    expect(classifyPlayerId(1)).toBe('numeric');
  });

  it('classifies numeric string as numeric', () => {
    expect(classifyPlayerId('8478000')).toBe('numeric');
    expect(classifyPlayerId('1')).toBe('numeric');
  });

  it('classifies uuid string as uuid (case-insensitive)', () => {
    expect(classifyPlayerId('550e8400-e29b-41d4-a716-446655440000')).toBe('uuid');
    expect(classifyPlayerId('550E8400-E29B-41D4-A716-446655440000')).toBe('uuid');
    expect(classifyPlayerId('11111111-2222-3333-4444-555555555555')).toBe('uuid');
  });

  it('classifies null/undefined as invalid', () => {
    expect(classifyPlayerId(null)).toBe('invalid');
    expect(classifyPlayerId(undefined)).toBe('invalid');
  });

  it('classifies empty/whitespace string as invalid', () => {
    expect(classifyPlayerId('')).toBe('invalid');
    expect(classifyPlayerId('   ')).toBe('invalid');
  });

  it('classifies zero and negative numbers as invalid (out of NHL id range)', () => {
    expect(classifyPlayerId(0)).toBe('invalid');
    expect(classifyPlayerId(-1)).toBe('invalid');
  });

  it('classifies non-finite numbers as invalid', () => {
    expect(classifyPlayerId(NaN)).toBe('invalid');
    expect(classifyPlayerId(Infinity)).toBe('invalid');
  });

  it('classifies non-numeric non-uuid strings as invalid', () => {
    expect(classifyPlayerId('abc123')).toBe('invalid');
    expect(classifyPlayerId('not-a-uuid')).toBe('invalid');
    expect(classifyPlayerId('8478000abc')).toBe('invalid');
    expect(classifyPlayerId('12345.67')).toBe('invalid'); // decimal, not int
  });

  it('trims whitespace before classification', () => {
    expect(classifyPlayerId('  8478000  ')).toBe('numeric');
    expect(classifyPlayerId('  550e8400-e29b-41d4-a716-446655440000  ')).toBe('uuid');
  });
});

describe('coerceToNumericPlayerId', () => {
  it('returns int for numeric int', () => {
    expect(coerceToNumericPlayerId(8478000)).toBe(8478000);
  });

  it('returns int for numeric string', () => {
    expect(coerceToNumericPlayerId('8478000')).toBe(8478000);
  });

  it('returns null for uuid string', () => {
    expect(coerceToNumericPlayerId('550e8400-e29b-41d4-a716-446655440000')).toBeNull();
  });

  it('returns null for null/undefined', () => {
    expect(coerceToNumericPlayerId(null)).toBeNull();
    expect(coerceToNumericPlayerId(undefined)).toBeNull();
  });

  it('returns null for invalid strings', () => {
    expect(coerceToNumericPlayerId('abc')).toBeNull();
    expect(coerceToNumericPlayerId('')).toBeNull();
  });

  it('never throws', () => {
    expect(() => coerceToNumericPlayerId('anything')).not.toThrow();
    expect(() => coerceToNumericPlayerId(NaN)).not.toThrow();
  });
});

describe('assertNumericPlayerId', () => {
  it('returns int for numeric int', () => {
    expect(assertNumericPlayerId(8478000, 'test')).toBe(8478000);
  });

  it('returns int for numeric string', () => {
    expect(assertNumericPlayerId('8478000', 'test')).toBe(8478000);
  });

  it('throws with [KI-042] prefix + context for uuid', () => {
    expect(() =>
      assertNumericPlayerId('550e8400-e29b-41d4-a716-446655440000', 'submitPick.playerId'),
    ).toThrow(/\[KI-042\] submitPick\.playerId: expected numeric NHL player_id, got uuid-domain/);
  });

  it('throws for null/undefined with context', () => {
    expect(() => assertNumericPlayerId(null, 'ctx')).toThrow(
      /\[KI-042\] ctx: expected numeric NHL player_id, got invalid-domain null/,
    );
    expect(() => assertNumericPlayerId(undefined, 'ctx')).toThrow(
      /\[KI-042\] ctx: expected numeric NHL player_id, got invalid-domain undefined/,
    );
  });

  it('throws for invalid strings', () => {
    expect(() => assertNumericPlayerId('abc', 'ctx')).toThrow(/\[KI-042\] ctx: .* invalid-domain/);
  });

  it('truncates long input in error message (defensive against huge strings)', () => {
    const longStr = 'x'.repeat(500);
    try {
      assertNumericPlayerId(longStr, 'test');
    } catch (err) {
      // Error message should include only first 40 chars of the raw value.
      const msg = (err as Error).message;
      expect(msg).toContain('[KI-042] test:');
      expect(msg.length).toBeLessThan(200); // not the full 500-char input
    }
  });
});

describe('partitionPlayerIds', () => {
  it('partitions mixed-domain array correctly', () => {
    const raws = [
      8478000,
      '8478001',
      '550e8400-e29b-41d4-a716-446655440000',
      '11111111-2222-3333-4444-555555555555',
      'abc',
      null,
      undefined,
      '',
    ];
    const result = partitionPlayerIds(raws);
    expect(result.numeric).toEqual([8478000, 8478001]);
    expect(result.uuid).toEqual([
      '550e8400-e29b-41d4-a716-446655440000',
      '11111111-2222-3333-4444-555555555555',
    ]);
    expect(result.invalid).toEqual(['abc', null, undefined, '']);
  });

  it('handles empty array', () => {
    const result = partitionPlayerIds([]);
    expect(result.numeric).toEqual([]);
    expect(result.uuid).toEqual([]);
    expect(result.invalid).toEqual([]);
  });

  it('handles all-numeric array (real-league happy path)', () => {
    const result = partitionPlayerIds([8478000, 8478001, 8478002]);
    expect(result.numeric).toEqual([8478000, 8478001, 8478002]);
    expect(result.uuid).toEqual([]);
    expect(result.invalid).toEqual([]);
  });

  it('handles all-uuid array (demo-league happy path)', () => {
    const uuids = [
      '550e8400-e29b-41d4-a716-446655440000',
      '11111111-2222-3333-4444-555555555555',
    ];
    const result = partitionPlayerIds(uuids);
    expect(result.numeric).toEqual([]);
    expect(result.uuid).toEqual(uuids);
    expect(result.invalid).toEqual([]);
  });
});
