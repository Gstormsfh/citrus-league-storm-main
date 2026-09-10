import { describe, expect, it } from 'vitest';
import { organizeMatchupData } from '../matchupUtils';
import type { MatchupPlayer } from '../types';

// The comparison view draws the LEAGUE'S slots. Until 2026-09-10 it drew a
// fixed individual-position list whatever the league was, so an F/D/G
// league saw C/LW/RW rows with nobody in them.

const p = (id: number, position: string): MatchupPlayer =>
  ({ id, name: `P${id}`, position, team: 'EDM', points: 0 } as unknown as MatchupPlayer);

const rows = (groups: ReturnType<typeof organizeMatchupData>) =>
  groups.flatMap((g) => g.userPlayers.map(() => g.position));

describe('organizeMatchupData — the slot plan comes from the league', () => {
  it('draws F rows, not C/LW/RW rows, for an F/D/G league', () => {
    const groups = organizeMatchupData([], [], {}, {}, 'forward');
    const positions = groups.map((g) => g.position);
    expect(positions).toEqual(['F', 'D', 'G', 'Util']);
    expect(groups[0].userPlayers).toHaveLength(6);
  });

  it('honours a commissioner roster shape: 3 C, 5 D, 2 UTIL', () => {
    const groups = organizeMatchupData([], [], {}, {}, 'individual', {
      C: 3, LW: 2, RW: 2, D: 5, G: 2, UTIL: 2, BENCH: 4, IR: 2,
    });
    const byPos = Object.fromEntries(groups.map((g) => [g.position, g.userPlayers.length]));
    expect(byPos).toEqual({ C: 3, LW: 2, RW: 2, D: 5, G: 2, Util: 2 });
  });

  it('seats a centre in an F slot when an F/D/G league has no slot assignments', () => {
    // AI teams carry null slot ids; the auto-assign must speak the league's slots.
    const groups = organizeMatchupData([p(1, 'C'), p(2, 'D')], [], {}, {}, 'forward');
    const f = groups.find((g) => g.position === 'F')!;
    const d = groups.find((g) => g.position === 'D')!;
    expect(f.userPlayers[0]?.id).toBe(1);
    expect(d.userPlayers[0]?.id).toBe(2);
    expect(groups.find((g) => g.position === 'C')).toBeUndefined();
  });

  it('reads a real F/D/G slot assignment (slot-F-3) into the third F row', () => {
    const groups = organizeMatchupData([p(7, 'LW')], [], { '7': 'slot-F-3' }, {}, 'forward');
    const f = groups.find((g) => g.position === 'F')!;
    expect(f.userPlayers.map((x) => x?.id ?? null)).toEqual([null, null, 7, null, null, null]);
  });

  it('still draws the classic 2C/2LW/2RW/4D/2G/UTIL plan by default', () => {
    expect(rows(organizeMatchupData([], [], {}, {}))).toEqual([
      'C', 'C', 'LW', 'LW', 'RW', 'RW', 'D', 'D', 'D', 'D', 'G', 'G', 'Util',
    ]);
  });
});
