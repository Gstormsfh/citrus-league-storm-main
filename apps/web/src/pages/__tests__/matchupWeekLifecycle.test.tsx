import React, { useEffect, useRef, useState } from 'react';
import { MemoryRouter, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useMatchupRouteLifetime } from '@/hooks/useMatchupRouteLifetime';
import { MatchupWeekBoundary } from '../MatchupWeekBoundary';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import ts from 'typescript';
import * as weekCalculator from '@/utils/weekCalculator';
import { syncLeagueFromUrl } from '../matchupUrlSync';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Execute the actual page loader effect, not a copy of its lock/commit logic.
// UI children, league/API boundaries and scoring payloads are fixtures. This
// isolates the asynchronous lifecycle without mocking the behavior under test.
const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../Matchup.tsx'), 'utf8');
const tree = ts.createSourceFile('Matchup.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effectText = '';
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect'
    && node.arguments[0]?.getText(tree).includes('const loadMatchupData = async ()')) effectText = node.arguments[0].getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree);
if (!effectText) throw new Error('Matchup loader effect not found');
const compiled = ts.transpileModule(`const effect = ${effectText};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const createEffect = new Function('scope', `with(scope) { ${compiled}; return effect; }`);
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
const league = { id: 'league', draft_status: 'completed', scoring_settings: null };
const fixture = (week: number) => ({ data: {
  matchup: { id: `matchup-${week}`, week_number: week, week_start_date: week === 1 ? '2026-09-28' : '2026-10-05', week_end_date: week === 1 ? '2026-10-04' : '2026-10-11' },
  userTeam: { id: 'home', name: `Home week ${week}`, roster: [{ id: week, projectedPoints: week === 1 ? -3 : 0 }], slotAssignments: {}, record: {}, dailyPoints: [week] },
  opponentTeam: { id: 'away', name: `Away week ${week}`, roster: [], slotAssignments: {}, record: {}, dailyPoints: [0] },
}, error: null });
let calls: number[];
let lookups: Map<number, ReturnType<typeof deferred<{ matchup: any }>>>;
let writes: string[];
let routeWindow: { location: { href: string } };
let replies: Map<number, ReturnType<typeof deferred<ReturnType<typeof fixture>>>>;
let ensureGate: ReturnType<typeof deferred<object>> | null;
let frozen: ReturnType<typeof deferred<{ data: [] }>> | null;
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

function Harness({ week }: { week: number }) {
  const [state, setState] = useState<Record<string, any>>({ SelectedWeek: 1, CurrentMatchup: null, Loading: true, Error: null });
  const refs = useRef<Record<string, { current: any }>>({});
  const loadingRef = useRef(false);
  const loadLifetimeRef = useMatchupRouteLifetime(loadingRef);
  const stable = useRef({
    ...weekCalculator, syncLeagueFromUrl, log: vi.fn(), logger: { error: vi.fn() }, navigate: vi.fn(), leagueContextLoading: false, hasProcessedNoLeague: { current: false },
    user: { id: 'user' }, userLeagueState: 'active-user', activeLeagueId: 'league',
    LeagueService: { getUserTeam: async () => ({ team: { id: 'home' } }), getUserLeagues: async () => ({ leagues: [league] }), getLeagueTeams: async () => ({ teams: [{ id: 'away' }] }) },
    MatchupService: {
      updateMatchupScores: async () => { writes.push('scores'); return { error: null }; },
      generateMatchupsForLeague: async () => { writes.push('generate'); return {}; },
      deleteAllMatchupsForLeague: async () => { writes.push('delete'); },
      getUserMatchup: async (_l: string, _u: string, w: number) => lookups.has(w) ? lookups.get(w)!.promise : { matchup: fixture(w).data.matchup },
      getMatchupData: (_l: string, _u: string, w: number) => { calls.push(w); return replies.get(w)!.promise; },
    },
    matchupApi: { ensureRosters: async (id: string) => { writes.push('ensure'); return id === 'matchup-1' && ensureGate ? ensureGate.promise : {}; }, getFrozenRosterBatch: async (id: string) => frozen && id === 'matchup-1' ? frozen.promise : { data: [] } },
    getDraftCompletionDate: () => new Date('2026-09-01'), fantasyWeekAnchorFor: () => new Date('2026-09-28'),
    getWeekEndDate: () => new Date('2026-10-11'), getWeekStartDate: () => new Date('2026-10-05'), getAvailableWeeks: () => [1, 2, 3], projectionSettings: () => ({}), getTodayMST: () => '2026-09-12',
    DEMO_LEAGUE_ID_FOR_GUESTS: 'demo', CACHE_TTL: 30000, profile: null,
    setTimeout, clearTimeout, window: routeWindow,
  });
  const scope = new Proxy({ ...stable.current, loadLifetimeRef, loadingRef, urlLeagueId: 'league', urlWeekId: String(week),
    selectedMatchupId: null, currentMatchup: state.CurrentMatchup, userTeam: { id: 'home' }, error: state.Error, loading: state.Loading,
  } as Record<string, any>, {
    has: (target, key) => typeof key === 'string' && (key in target || key.endsWith('Ref') || key.startsWith('set')),
    get: (target, key) => {
      if (typeof key !== 'string') return undefined;
      if (key in target) return target[key];
      if (key.endsWith('Ref')) return refs.current[key] ??= { current: key === 'loadingRef' ? false : null };
      if (key.startsWith('set')) return (value: unknown) => setState(previous => ({ ...previous, [key.slice(3)]: value }));
    },
  });
  // Match the real route dependency; recreating the effect on every setter would hide the bug.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(createEffect(scope), [week]);
  return <pre data-testid="state">{JSON.stringify(state)}</pre>;
}
const state = () => JSON.parse(screen.getByTestId('state').textContent!);
beforeEach(() => { vi.useFakeTimers(); calls = []; lookups = new Map(); writes = []; routeWindow = { location: { href: '' } }; replies = new Map([1,2,3].map(w => [w, deferred()])); frozen = null; ensureGate = null; });
afterEach(() => { vi.useRealTimers(); });

it('reproduces a route change dropped while the previous week is in flight', async () => {
  const view = render(<Harness week={1} />);
  await flush();
  expect(calls).toEqual([1]);
  view.rerender(<Harness week={2} />);
  await flush();
  replies.get(1)!.resolve(fixture(1));
  await flush();
  expect(calls).toEqual([1]);
  expect(state().CurrentMatchup.week_number).toBe(1);
  expect(state().SelectedWeek).toBe(1);
  expect(state().Error).toBeNull();
});

let navigate: ReturnType<typeof useNavigate>;
function RoutedHarness() {
  navigate = useNavigate();
  const { weekId } = useParams();
  return <MatchupWeekBoundary><Harness week={Number(weekId)} /></MatchupWeekBoundary>;
}
function renderRoutes() {
  return render(<MemoryRouter initialEntries={['/matchup/league/1']}><Routes>
    <Route path="/matchup/:leagueId/:weekId" element={<RoutedHarness />} />
  </Routes></MemoryRouter>);
}
const go = async (week: number) => { act(() => navigate(`/matchup/league/${week}`)); await flush(); };
function expectWeek(week: number) {
  expect(state().SelectedWeek).toBe(week);
  expect(state().CurrentMatchup).toEqual(fixture(week).data.matchup);
  expect(state().MyTeam).toEqual(fixture(week).data.userTeam.roster);
  expect(state().MyDailyPoints).toEqual([week]);
  expect(state().ViewingOpponentTeamName).toBe(`Away week ${week}`);
  expect(state().Error).toBeNull();
}
it('route boundary starts week2 despite week1 lock and ignores old response arriving last', async () => {
  renderRoutes(); await flush();
  await go(2);
  expect(calls).toEqual([1, 2]);
  expect(state().CurrentMatchup).toBeNull();
  replies.get(2)!.resolve(fixture(2)); await flush(); expectWeek(2);
  replies.get(1)!.resolve(fixture(1)); await flush(); expectWeek(2);
});
it('sequential next and previous keep complete payload coherent', async () => {
  renderRoutes(); await flush(); replies.get(1)!.resolve(fixture(1)); await flush(); expectWeek(1);
  await go(2); replies.get(2)!.resolve(fixture(2)); await flush(); expectWeek(2);
  await go(1); await flush(); expectWeek(1);
  expect(calls).toEqual([1, 2, 1]);
});
it('rapid1→2→3 ignores both obsolete response orders', async () => {
  renderRoutes(); await flush(); await go(2); await go(3);
  expect(calls).toEqual([1, 2, 3]);
  replies.get(2)!.resolve(fixture(2)); await flush();
  expect(state().CurrentMatchup).toBeNull();
  replies.get(3)!.resolve(fixture(3)); await flush(); expectWeek(3);
  replies.get(1)!.resolve(fixture(1)); await flush(); expectWeek(3);
});
it('missing week response cannot retain prior roster, dates or scores', async () => {
  renderRoutes(); await flush(); replies.get(1)!.resolve(fixture(1)); await flush(); expectWeek(1);
  await go(2);
  replies.get(2)!.resolve({ data: null, error: new Error('Week 2 has no matchup yet.') } as never);
  await flush();
  expect(state().CurrentMatchup).toBeNull();
  expect(state().MyTeam).toBeUndefined();
  expect(state().MyDailyPoints).toBeUndefined();
  expect(state().CachedDailyScores).toBeUndefined();
  expect(state().Error).toContain('week 2');
  await go(1); await flush(); expectWeek(1);
});

it('late frozen-roster completion and timeout cannot alter the new week', async () => {
  frozen = deferred();
  renderRoutes(); await flush(); replies.get(1)!.resolve(fixture(1)); await flush();
  expect(state().Loading).toBe(true); // main payload visible but old loader still owns its lock
  await go(2); replies.get(2)!.resolve(fixture(2)); await flush(); expectWeek(2);
  expect(state().Loading).toBe(false);
  const before = screen.getByTestId('state').textContent;
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(screen.getByTestId('state').textContent).toBe(before);
  frozen.resolve({ data: [] }); await flush();
  expect(screen.getByTestId('state').textContent).toBe(before);
});
it('both production routes install the same route-state boundary', () => {
  const app = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../App.tsx'), 'utf8');
  for (const path of ['/matchup/:leagueId/:weekId?', '/matchup']) {
    expect(app).toContain(`path="${path}" element={<MatchupWeekBoundary><ErrorBoundary><Matchup /></ErrorBoundary></MatchupWeekBoundary>}`);
  }
});

it.each([null, fixture(1).data.matchup])('obsolete lookup cannot initiate ensure/generate/delete after unmount (%s)', async matchup => {
  const oldLookup = deferred<{ matchup: any }>(); lookups.set(1, oldLookup);
  renderRoutes(); await flush(); await go(2);
  replies.get(2)!.resolve(fixture(2)); await flush(); expectWeek(2);
  const before = [...writes];
  oldLookup.resolve({ matchup }); await flush();
  expect(writes).toEqual(before);
  expect(calls).toEqual([2]);
  expectWeek(2);
});
it('obsolete playoff response cannot redirect the current route', async () => {
  renderRoutes(); await flush(); await go(2);
  replies.get(2)!.resolve(fixture(2)); await flush(); expectWeek(2);
  replies.get(1)!.resolve({ ...fixture(1), data: { ...fixture(1).data, isPlayoffWeek: true } } as never);
  await flush(); expect(routeWindow.location.href).toBe(''); expectWeek(2);
});
it('unmount clears both loader timers while keeping the current route functional', async () => {
  const view = renderRoutes(); await flush();
  expect(vi.getTimerCount()).toBe(2);
  await go(2); expect(vi.getTimerCount()).toBe(2);
  replies.get(2)!.resolve(fixture(2)); await flush(); expectWeek(2);
  expect(vi.getTimerCount()).toBe(0);
  view.unmount(); expect(vi.getTimerCount()).toBe(0);
});
it('StrictMode setup-cleanup-setup does not leave the new lifetime locked', async () => {
  render(<React.StrictMode><MemoryRouter initialEntries={['/matchup/league/1']}><Routes>
    <Route path="/matchup/:leagueId/:weekId" element={<RoutedHarness />} />
  </Routes></MemoryRouter></React.StrictMode>);
  await flush(); expect(calls).toEqual([1]);
  replies.get(1)!.resolve(fixture(1)); await flush(); expectWeek(1);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['resolve', 'reject'] as const)('nonfatal ensure-rosters catch cannot swallow route cancellation (%s)', async outcome => {
  ensureGate = deferred();
  renderRoutes(); await flush(); await go(2);
  replies.get(2)!.resolve(fixture(2)); await flush(); expectWeek(2);
  if (outcome === 'resolve') ensureGate.resolve({}); else ensureGate.reject(new Error('old request failed'));
  await flush(); expect(calls).toEqual([2]); expectWeek(2);
});
it('current-route ensure failure remains nonfatal', async () => {
  ensureGate = deferred(); renderRoutes(); await flush();
  ensureGate.reject(new Error('existing roster unavailable')); await flush();
  expect(calls).toEqual([1]); replies.get(1)!.resolve(fixture(1)); await flush(); expectWeek(1);
});
