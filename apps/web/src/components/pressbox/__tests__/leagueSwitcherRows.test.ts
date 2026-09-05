import { describe, it, expect } from 'vitest';
import { leagueSwitcherRows, switcherLine } from '../leagueSwitcherRows';

const fantasy = (id: string, name: string, draft_status: string | null) => ({ id, name, settings: {}, draft_status });

describe('leagueSwitcherRows', () => {
  it('keeps the context order and marks the active league', () => {
    const rows = leagueSwitcherRows(
      [fantasy('a', 'Finalsz', 'completed'), fantasy('b', 'Puck Heads Dynasty', 'pending'), fantasy('c', 'Beer League', 'in_progress')],
      'b',
    );
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(rows.map((r) => r.active)).toEqual([false, true, false]);
    expect(rows.map((r) => r.line)).toEqual(['Season Active', 'Draft Pending', 'Drafting now']);
  });

  it('draws one initial, the same fallback crest the header draws', () => {
    expect(leagueSwitcherRows([fantasy('a', 'finalsz', null)], null)[0].initial).toBe('F');
    expect(leagueSwitcherRows([fantasy('a', '', null)], null)[0].initial).toBe('?');
  });

  it('a pool names its game, not a draft state', () => {
    const { line } = switcherLine({ id: 'p', name: "Office Pick'em", settings: { leagueType: 'pickem' }, draft_status: null });
    expect(line.toLowerCase()).toContain('pool');
    expect(line).not.toContain('Draft');
  });

  it('no active id marks nothing', () => {
    expect(leagueSwitcherRows([fantasy('a', 'A', 'completed')], null).some((r) => r.active)).toBe(false);
    expect(leagueSwitcherRows([fantasy('a', 'A', 'completed')], 'zzz').some((r) => r.active)).toBe(false);
  });
});
