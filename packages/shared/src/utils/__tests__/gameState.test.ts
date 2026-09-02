import { describe, it, expect } from 'vitest';
import {
  normalizeGameState,
  isIntermission,
  secondsRemaining,
  periodOrdinal,
  isFinalMinute,
  finalFlag,
  gameStateLabel,
} from '../gameState';

describe('normalizeGameState', () => {
  it.each([
    ['live', 'live'], ['LIVE', 'live'], ['  Live  ', 'live'],
    ['in_progress', 'live'], ['in progress', 'live'], ['inprogress', 'live'],
    ['crit', 'live'], ['intermission', 'live'],
  ] as const)('%s -> live', (raw, want) => {
    expect(normalizeGameState(raw)).toBe(want);
  });

  it.each(['final', 'FINAL', 'off', 'completed', 'complete'])('%s -> final', (raw) => {
    expect(normalizeGameState(raw)).toBe('final');
  });

  it.each(['scheduled', 'Scheduled', 'preview', 'fut', 'pre', 'upcoming'])('%s -> scheduled', (raw) => {
    expect(normalizeGameState(raw)).toBe('scheduled');
  });

  it.each(['postponed', 'ppd', 'cancelled', 'canceled', 'suspended'])('%s -> postponed', (raw) => {
    expect(normalizeGameState(raw)).toBe('postponed');
  });

  // The load-bearing case. An unreadable status must NOT become "scheduled":
  // claiming a game has not started is a statement about the world, and this
  // module's whole contract is that it never makes one it cannot support.
  it.each([null, undefined, '', '   ', 'delayed', 'weather', '???', '0'])(
    'unrecognised (%s) -> unknown, never scheduled',
    (raw) => {
      expect(normalizeGameState(raw as string | null | undefined)).toBe('unknown');
    },
  );
});

describe('secondsRemaining', () => {
  it.each([
    ['20:00', 1200], ['10:32', 632], ['1:00', 60], ['0:59', 59], ['0:00', 0],
  ] as const)('%s -> %i', (raw, want) => {
    expect(secondsRemaining(raw)).toBe(want);
  });

  // 'INT' is "no clock", not "zero seconds". The difference is what decides
  // whether the final-minute treatment fires during an intermission.
  it.each(['INT', 'int', null, undefined, '', 'Final', '12', '1:5', '1:60', '100:00', '-1:00'])(
    'no clock for %s',
    (raw) => {
      expect(secondsRemaining(raw as string | null | undefined)).toBeNull();
    },
  );

  it('INT is not zero', () => {
    expect(secondsRemaining('INT')).toBeNull();
    expect(secondsRemaining('0:00')).toBe(0);
  });
});

describe('isIntermission', () => {
  it.each(['INT', 'int', ' Int '])('%s is an intermission', (raw) => {
    expect(isIntermission(raw)).toBe(true);
  });
  it.each(['10:32', '', null, undefined, 'INTERMISSION'])('%s is not', (raw) => {
    expect(isIntermission(raw as string | null | undefined)).toBe(false);
  });
});

describe('periodOrdinal', () => {
  it.each([['1st', 1], ['2nd', 2], ['3rd', 3], ['OT', 4], ['ot', 4], ['SO', 5]] as const)(
    '%s -> %i', (raw, want) => expect(periodOrdinal(raw)).toBe(want),
  );
  // nhl_shots.period carries a bare integer; an older ingest may have left
  // one in nhl_games.period too.
  it.each([['1', 1], ['4', 4], ['9', 9]] as const)('bare integer %s -> %i', (raw, want) => {
    expect(periodOrdinal(raw)).toBe(want);
  });
  it.each([null, undefined, '', '0', '10', '3rd period', 'shootout', '1.5'])(
    'unreadable (%s) -> null', (raw) => expect(periodOrdinal(raw as string | null | undefined)).toBeNull(),
  );
});

describe('isFinalMinute', () => {
  it('fires in the third with a minute or less on a real clock', () => {
    expect(isFinalMinute('live', '3rd', '1:00')).toBe(true);
    expect(isFinalMinute('live', '3rd', '0:12')).toBe(true);
    expect(isFinalMinute('live', 'OT', '0:30')).toBe(true);
    expect(isFinalMinute('live', 'SO', '0:05')).toBe(true);
  });

  it('does not fire before the third, however little time is left', () => {
    expect(isFinalMinute('live', '1st', '0:04')).toBe(false);
    expect(isFinalMinute('live', '2nd', '0:00')).toBe(false);
  });

  it('does not fire above a minute', () => {
    expect(isFinalMinute('live', '3rd', '1:01')).toBe(false);
    expect(isFinalMinute('live', '3rd', '19:59')).toBe(false);
  });

  // The intermission trap: the scraper freezes timeRemaining at the last
  // whistle and writes 'INT'. Treating that as a clock would light the
  // urgency treatment for the whole intermission.
  it('never fires on an intermission or a missing clock', () => {
    expect(isFinalMinute('live', '3rd', 'INT')).toBe(false);
    expect(isFinalMinute('live', '3rd', null)).toBe(false);
    expect(isFinalMinute('live', '3rd', undefined)).toBe(false);
  });

  it('never fires when the game is not live', () => {
    for (const s of ['final', 'scheduled', 'postponed', 'unknown'] as const) {
      expect(isFinalMinute(s, '3rd', '0:30')).toBe(false);
    }
  });

  it('never fires when the period is unreadable', () => {
    expect(isFinalMinute('live', null, '0:30')).toBe(false);
    expect(isFinalMinute('live', 'garbage', '0:30')).toBe(false);
  });
});

describe('finalFlag', () => {
  it('reads OT and SO off the period the scraper left behind', () => {
    expect(finalFlag('final', 'OT')).toBe('OT');
    expect(finalFlag('final', '4')).toBe('OT');
    expect(finalFlag('final', 'SO')).toBe('SO');
    expect(finalFlag('final', '5')).toBe('SO');
  });

  it('regulation finals carry no flag', () => {
    expect(finalFlag('final', '3rd')).toBeNull();
  });

  // 681 finals from 2025 were written by the schedule loader and never
  // touched in-game, so period is NULL. Whether they went to overtime is not
  // knowable from this table, and a guess dressed as an F/OT is the exact
  // fabrication this module refuses.
  it('a final with no period is a plain Final, never a guessed OT', () => {
    expect(finalFlag('final', null)).toBeNull();
    expect(finalFlag('final', undefined)).toBeNull();
    expect(finalFlag('final', '')).toBeNull();
  });

  it('only finals get a flag', () => {
    for (const s of ['live', 'scheduled', 'postponed', 'unknown'] as const) {
      expect(finalFlag(s, 'OT')).toBeNull();
    }
  });
});

describe('gameStateLabel', () => {
  it('prints clock then period while a game is on', () => {
    expect(gameStateLabel('live', '2nd', '10:32')).toBe('10:32 2nd');
  });

  it('prints the intermission rather than a frozen clock', () => {
    expect(gameStateLabel('live', '2nd', 'INT')).toBe('INT 2nd');
    expect(gameStateLabel('live', null, 'INT')).toBe('Intermission');
  });

  it('never invents a clock it does not have', () => {
    expect(gameStateLabel('live', '3rd', null)).toBe('3rd');
    expect(gameStateLabel('live', null, '4:01')).toBe('4:01');
    expect(gameStateLabel('live', null, null)).toBe('Live');
    expect(gameStateLabel('live', '3rd', 'garbage')).toBe('3rd');
  });

  it('finals carry their flag when the table knows it', () => {
    expect(gameStateLabel('final', 'OT', null)).toBe('Final/OT');
    expect(gameStateLabel('final', 'SO', null)).toBe('Final/SO');
    expect(gameStateLabel('final', '3rd', null)).toBe('Final');
    expect(gameStateLabel('final', null, null)).toBe('Final');
  });

  it('scheduled and postponed say so', () => {
    expect(gameStateLabel('scheduled', null, null)).toBe('Scheduled');
    expect(gameStateLabel('postponed', null, null)).toBe('Postponed');
  });

  it('an unreadable state says it is unreadable, and carries no em dash', () => {
    const s = gameStateLabel('unknown', null, null);
    expect(s).toBe('Status unavailable');
    expect(s).not.toMatch(/—/);
  });

  // House rule (ops/stormy-voice): no em dashes in user-facing strings.
  it('no label anywhere contains an em dash', () => {
    const cases: Array<[Parameters<typeof gameStateLabel>[0], string | null, string | null]> = [
      ['live', '2nd', '10:32'], ['live', '2nd', 'INT'], ['live', null, null],
      ['final', 'OT', null], ['final', null, null],
      ['scheduled', null, null], ['postponed', null, null], ['unknown', null, null],
    ];
    for (const [s, p, t] of cases) expect(gameStateLabel(s, p, t)).not.toMatch(/—/);
  });
});
