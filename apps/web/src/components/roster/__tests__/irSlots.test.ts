// IR slot count (2026-09-01, audit R8).
//
// The mobile list heads its Injured Reserve section "n/N" from this. N has
// to be the number the server enforces — resolveSlotConfig in
// server/src/lib/leagueRules.ts reads settings.rosterSlots.IR and falls
// back to 3 — or the label would promise a slot the save then strips.
import { describe, it, expect } from 'vitest';
import { DEFAULT_IR_SLOT_COUNT, irSlotIds, resolveIrSlotCount, shouldMoveOffIr } from '../irSlots';

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

// IR ELIGIBILITY (2026-09-03, WORLD_CLASS_READINESS gap B).
//
// The server now refuses a NEW IR placement for a player the NHL does not
// list IR/LTIR (validateIrPlacements in server/src/lib/leagueRules.ts) and
// tolerates an occupant who healed after he was placed. The rows carry the
// second half of that rule: a tolerated occupant is still an illegal roster,
// and "Move off IR" on his row is the door. The flag is the one the page has
// gated IR on since the column arrived (migration 20260103151931), and only
// an explicit false means healthy.
describe('shouldMoveOffIr mirrors the server rule for a tolerated occupant', () => {
  it('true only for an explicit is_ir_eligible=false', () => {
    expect(shouldMoveOffIr({ is_ir_eligible: false })).toBe(true);
  });

  it('false for a player the NHL lists IR/LTIR', () => {
    expect(shouldMoveOffIr({ is_ir_eligible: true })).toBe(false);
  });

  it('false when the flag was never sent: unknown is not healthy', () => {
    expect(shouldMoveOffIr({})).toBe(false);
    expect(shouldMoveOffIr({ is_ir_eligible: undefined })).toBe(false);
  });
});
