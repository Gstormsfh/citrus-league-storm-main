/**
 * SETTINGS-ENFORCEMENT (2026-08-16) — the rules that make commissioner
 * settings real. Each block pins one finding from the dynamic-settings
 * audit; the mutation that recreates the original bug is named in the
 * test so reverting the fix fails loudly.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveSlotConfig,
  validateSlotAssignments,
  resolveAddLimits,
  isPastTradeDeadline,
  evaluateGameLock,
} from '../leagueRules';

describe('resolveSlotConfig — the league shape, not a literal', () => {
  it('defaults match the historical hardcode exactly (legacy leagues unchanged)', () => {
    const cfg = resolveSlotConfig({});
    expect(cfg.slots).toEqual({ C: 2, LW: 2, RW: 2, D: 4, G: 2 });
    expect(cfg.utilCount).toBe(1);
    expect(cfg.irCount).toBe(3);
  });

  it('honors a custom commissioner config', () => {
    const cfg = resolveSlotConfig({ rosterSlots: { C: 3, LW: 3, RW: 3, D: 5, G: 1, UTIL: 2 } });
    expect(cfg.slots).toEqual({ C: 3, LW: 3, RW: 3, D: 5, G: 1 });
    expect(cfg.utilCount).toBe(2);
  });

  it('forward mode uses the F family, config-driven', () => {
    const cfg = resolveSlotConfig({ positionType: 'forward', rosterSlots: { F: 7, D: 3, G: 2 } });
    expect(cfg.slots).toEqual({ F: 7, D: 3, G: 2 });
  });

  it('garbage in the jsonb falls back to defaults, never NaN', () => {
    const cfg = resolveSlotConfig({ rosterSlots: { C: 'lots', D: -1, G: null } });
    expect(cfg.slots.C).toBe(2);
    expect(cfg.slots.D).toBe(4);
    expect(cfg.slots.G).toBe(2);
  });
});

describe('validateSlotAssignments — the 8-centers hole is closed', () => {
  const cfg = resolveSlotConfig({}); // 2-2-2-4-2, UTIL 1

  it('THE regression: more centers than the league allows REJECTS the save', () => {
    // Old behaviour: regex allowed slot-C-1..slot-C-8 regardless of
    // league config — 8 centers in a 2-C league saved fine.
    const a = {
      p1: 'slot-C-1', p2: 'slot-C-2', p3: 'slot-C-3',
    };
    const v = validateSlotAssignments(a, cfg);
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/exceeds|Too many/);
  });

  it('THE other regression: slot-UTIL-2 is legal when the league has 2 UTIL', () => {
    // Old behaviour: regex allowed only bare `slot-UTIL`; the second
    // UTIL starter in the app's own default config was silently
    // stripped on every save.
    const twoUtil = resolveSlotConfig({ rosterSlots: { UTIL: 2 } });
    const v = validateSlotAssignments({ p1: 'slot-UTIL', p2: 'slot-UTIL-2' }, twoUtil);
    expect(v.ok).toBe(true);
    expect(v.strip).toEqual([]);
  });

  it('a legal default lineup passes untouched', () => {
    const a = {
      c1: 'slot-C-1', c2: 'slot-C-2',
      l1: 'slot-LW-1', l2: 'slot-LW-2',
      r1: 'slot-RW-1', r2: 'slot-RW-2',
      d1: 'slot-D-1', d2: 'slot-D-2', d3: 'slot-D-3', d4: 'slot-D-4',
      g1: 'slot-G-1', g2: 'slot-G-2',
      u1: 'slot-UTIL',
      i1: 'ir-slot-1',
    };
    const v = validateSlotAssignments(a, cfg);
    expect(v.ok).toBe(true);
    expect(v.strip).toEqual([]);
  });

  it('malformed ids strip (legacy tolerance), they do not reject', () => {
    const v = validateSlotAssignments({ p1: 'slot-C-1', p2: 'banana' }, cfg);
    expect(v.ok).toBe(true);
    expect(v.strip).toEqual(['p2']);
  });

  it('a position outside the league family strips (slot-C in forward mode)', () => {
    const fwd = resolveSlotConfig({ positionType: 'forward' });
    const v = validateSlotAssignments({ p1: 'slot-C-1', p2: 'slot-F-1' }, fwd);
    expect(v.ok).toBe(true);
    expect(v.strip).toEqual(['p1']);
  });

  it('ir slots beyond the configured count strip', () => {
    const v = validateSlotAssignments({ p1: 'ir-slot-4' }, cfg);
    expect(v.strip).toEqual(['p1']);
  });
});

describe('resolveAddLimits — both spellings, because both exist in the wild', () => {
  it('THE regression: camelCase keys (what CreateLeague writes) now enforce', () => {
    expect(resolveAddLimits({ weeklyAddLimit: 4, seasonAddLimit: 40 }))
      .toEqual({ weeklyLimit: 4, seasonLimit: 40 });
  });

  it('snake_case keys still enforce', () => {
    expect(resolveAddLimits({ weekly_add_limit: 3 }))
      .toEqual({ weeklyLimit: 3, seasonLimit: null });
  });

  it('0 means unlimited (CreateLeague writes `|| 0` for no-limit)', () => {
    expect(resolveAddLimits({ weeklyAddLimit: 0, seasonAddLimit: 0 }))
      .toEqual({ weeklyLimit: null, seasonLimit: null });
  });

  it('snake_case wins when both exist (server-written canonical form)', () => {
    expect(resolveAddLimits({ weekly_add_limit: 2, weeklyAddLimit: 9 }).weeklyLimit).toBe(2);
  });
});

describe('isPastTradeDeadline — the key that finally fires', () => {
  it('THE regression: tradeDeadlineWeek (what CreateLeague writes) enforces', () => {
    expect(isPastTradeDeadline({ tradeDeadlineWeek: 18 }, new Date(), 19)).toBe(true);
    expect(isPastTradeDeadline({ tradeDeadlineWeek: 18 }, new Date(), 18)).toBe(false);
  });

  it('fails OPEN when the current week is unresolvable', () => {
    expect(isPastTradeDeadline({ tradeDeadlineWeek: 18 }, new Date(), null)).toBe(false);
  });

  it('legacy date form still enforces when present', () => {
    expect(isPastTradeDeadline({ trade_deadline: '2020-01-01' }, new Date('2020-06-01'), null)).toBe(true);
    expect(isPastTradeDeadline({ trade_deadline: '2099-01-01' }, new Date(), null)).toBe(false);
  });

  it('no deadline configured → never blocks', () => {
    expect(isPastTradeDeadline({}, new Date(), 25)).toBe(false);
  });
});

describe('evaluateGameLock — locked at puck drop, fail-open on bad data', () => {
  const NOON = Date.parse('2026-10-10T19:00:00Z');

  it('locks when the status says the game is live', () => {
    expect(evaluateGameLock(
      [{ home_team: 'EDM', away_team: 'CGY', status: 'Live' }], 'EDM', NOON,
    )).toBe(true);
  });

  it('locks when the listed start time has passed', () => {
    expect(evaluateGameLock(
      [{ home_team: 'EDM', away_team: 'CGY', status: 'scheduled', game_date: '2026-10-10', game_time: '18:00:00Z' }],
      'CGY', NOON,
    )).toBe(true);
  });

  it('does NOT lock before start time', () => {
    expect(evaluateGameLock(
      [{ home_team: 'EDM', away_team: 'CGY', status: 'scheduled', game_date: '2026-10-10', game_time: '23:00:00Z' }],
      'EDM', NOON,
    )).toBe(false);
  });

  it('other teams games never lock this player', () => {
    expect(evaluateGameLock(
      [{ home_team: 'TOR', away_team: 'MTL', status: 'live' }], 'EDM', NOON,
    )).toBe(false);
  });

  it('fails open on missing/garbage schedule data', () => {
    expect(evaluateGameLock(
      [{ home_team: 'EDM', away_team: 'CGY', status: null, game_date: null, game_time: null }],
      'EDM', NOON,
    )).toBe(false);
    expect(evaluateGameLock([], 'EDM', NOON)).toBe(false);
  });
});
