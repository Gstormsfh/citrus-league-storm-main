// IR slot count (2026-09-01, audit R8).
//
// The mobile list heads its Injured Reserve section "n/N" from this. N has
// to be the number the server enforces — resolveSlotConfig in
// server/src/lib/leagueRules.ts reads settings.rosterSlots.IR and falls
// back to 3 — or the label would promise a slot the save then strips.
import { describe, it, expect } from 'vitest';
import { DEFAULT_IR_SLOT_COUNT, irSlotIds, resolveIrSlotCount } from '../irSlots';

describe('resolveIrSlotCount mirrors the server rule', () => {
  it('reads the commissioner setting', () => {
    expect(resolveIrSlotCount({ C: 2, IR: 2 })).toBe(2);
    expect(resolveIrSlotCount({ IR: 0 })).toBe(0);
    expect(resolveIrSlotCount({ IR: 5 })).toBe(5);
  });

  it('falls back to 3 when the setting is absent or not a usable number', () => {
    expect(DEFAULT_IR_SLOT_COUNT).toBe(3);
    expect(resolveIrSlotCount(null)).toBe(3);
    expect(resolveIrSlotCount(undefined)).toBe(3);
    expect(resolveIrSlotCount({})).toBe(3);
    expect(resolveIrSlotCount({ C: 2, LW: 2 })).toBe(3);
    expect(resolveIrSlotCount({ IR: '2' })).toBe(3);
    expect(resolveIrSlotCount({ IR: -1 })).toBe(3);
    expect(resolveIrSlotCount({ IR: Number.NaN })).toBe(3);
    expect(resolveIrSlotCount({ IR: Number.POSITIVE_INFINITY })).toBe(3);
  });

  it('floors fractional settings the way the server does', () => {
    expect(resolveIrSlotCount({ IR: 2.9 })).toBe(2);
  });
});

describe('irSlotIds', () => {
  it('names the slots the page and server use, in order', () => {
    expect(irSlotIds(3)).toEqual(['ir-slot-1', 'ir-slot-2', 'ir-slot-3']);
    expect(irSlotIds(1)).toEqual(['ir-slot-1']);
  });

  it('is empty for zero or negative counts', () => {
    expect(irSlotIds(0)).toEqual([]);
    expect(irSlotIds(-2)).toEqual([]);
  });
});
