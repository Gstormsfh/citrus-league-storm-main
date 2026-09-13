import { describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { expectedMatchupProjections, expectedProjectionFields } from '../matchupExpectedProjections';
import { organizeMatchupData } from '@/components/matchup/matchupUtils';
import { PlayerCard } from '@/components/matchup/PlayerCard';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { MatchupPlayer } from '@/components/matchup/types';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import captures from './fixtures/matchup-captured-projections.json';

// Expected totals were independently computed in Python from captured category
// values × saved league weights, not by the application scorer or renderer.
describe('captured Test and Finalsz projection reconciliation', () => {
  for (const capture of captures) {
    it(`${capture.name}: all saved active rows fit the configured slots and sum to the weekly forecast`, () => {
      const raw = new Map(Object.entries(capture.projections).map(([date, rows]) => [date, new Map(Object.entries(rows).map(([id, row]) => [Number(id), row]))]));
      const expected = expectedMatchupProjections(raw, capture.scoring);
      for (const team of capture.teams) {
        let weekly = 0;
        for (const [date, roster] of Object.entries(team.days)) {
          const active = roster.filter(p => p.isStarter);
          const players = active.map(p => ({ ...p, points: 0, ...expectedProjectionFields(p, expected.projections.get(date)?.get(p.id)) })) as unknown as MatchupPlayer[];
          const slots = Object.fromEntries(active.map(p => [p.id, p.slot]));
          const visible = organizeMatchupData(players, [], slots, {}, 'individual', capture.slots).flatMap(g => g.userPlayers).filter((p): p is MatchupPlayer => p !== null);
          expect(visible.map(p => p.id).sort()).toEqual(active.map(p => p.id).sort());
          weekly += visible.reduce((sum, p) => sum + (p.daily_projection?.total_projected_points ?? p.goalieProjection?.total_projected_points ?? 0), 0);
        }
        expect(weekly).toBeCloseTo(team.expectedWeekly, 10);
      }
    });
  }

  it('renders a saved Oct3 skater forecast instead of TBD, leaving earned points separate', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-13T04:45:00Z'));
    try {
      const c = captures[0];
      const raw = new Map([['2026-10-03', new Map(Object.entries(c.projections['2026-10-03']).map(([id, row]) => [Number(id), row]))]]);
      const expected = expectedMatchupProjections(raw, c.scoring);
      const saved = c.teams[0].days['2026-10-03'].find(p => p.id === 8477951)!;
      const projection = expected.projections.get('2026-10-03')!.get(saved.id)!;
      const player = { ...saved, points: 0, daily_total_points: 0, ...expectedProjectionFields(saved, projection), games: [{ game_date: '2026-10-03', status: 'scheduled', home_team: saved.team, away_team: 'TOR' }], stats: {}, gamesRemaining: 1 } as unknown as MatchupPlayer;
      const { container } = render(<TooltipProvider><PlayerCard player={player} isUserTeam selectedDate="2026-10-03" /></TooltipProvider>);
      expect(container.textContent).toContain('6.8');
      expect(container.textContent).not.toContain('TBD');
      expect(player.daily_total_points).toBe(0);
      cleanup();
    } finally { vi.useRealTimers(); }
  });

  it('preserves zero, signed negative, missing, and unconditional goalie exposure', () => {
    for (const total of [0, -2.75]) {
      const raw = { is_goalie: false, total_projected_points: total };
      expect(expectedProjectionFields({ position: 'C' }, raw).daily_projection).toBe(raw);
    }
    const goalie = { is_goalie: true, total_projected_points: 3.25, projected_gp: 0.4, projection_basis: 'unconditional' };
    expect(expectedProjectionFields({ position: 'G' }, goalie).goalieProjection).toBe(goalie);
    expect(expectedProjectionFields({ position: 'G' }, undefined)).toEqual({ daily_projection: undefined, goalieProjection: undefined });
  });
});

// Execute actual saved-roster selectors so the helper cannot pass while the
// page bypasses it. API and earned-stat boundaries remain captured/fixture data.
it('actual page selectors attach date forecasts for both starters and benches', () => {
  const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../pages/Matchup.tsx'), 'utf8');
  const tree = ts.createSourceFile('Matchup.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const selectors = new Map<string, string>();
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ['myStarters', 'myBench', 'opponentStarters', 'opponentBench'].includes(node.name.getText(tree)) && node.initializer && ts.isCallExpression(node.initializer)) {
      selectors.set(node.name.getText(tree), node.initializer.arguments[0].getText(tree));
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  expect(selectors.size).toBe(4);
  const c = captures[0];
  const date = '2026-10-03';
  const raw = new Map([[date, new Map(Object.entries(c.projections[date]).map(([id, row]) => [Number(id), row]))]]);
  const expected = expectedMatchupProjections(raw, c.scoring);
  const scope = {
    selectedDate: date, expectedProjectionFields, projectionsByDate: expected.projections,
    frozenRostersByDate: new Map([[date, { myRoster: c.teams[0].days[date], oppRoster: c.teams[1].days[date] }]]),
    dailyStatsByDate: new Map([[date, new Map([[8477951, { daily_total_points: -1.5 }]])]]),
  };
  for (const [name, callback] of selectors) {
    const compiled = ts.transpileModule(`const select = ${callback};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const result = new Function('scope', `with(scope) { ${compiled}; return select(); }`)(scope) as MatchupPlayer[];
    const roster = c.teams[name.startsWith('my') ? 0 : 1].days[date];
    expect(result.map(p => p.id)).toEqual(roster.filter(p => p.isStarter === name.endsWith('Starters')).map(p => p.id));
    for (const player of result) {
      const projection = expected.projections.get(date)?.get(Number(player.id));
      expect(player.daily_projection ?? player.goalieProjection).toBe(projection);
      if (player.id === 8477951) expect(player.daily_total_points).toBe(-1.5);
    }
  }
});
