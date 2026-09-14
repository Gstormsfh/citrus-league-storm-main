import React, { useEffect } from 'react';
import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Match the existing matchup lifecycle harness: execute the actual page
// callbacks, with external context/API boundaries supplied by the test.
const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../Roster.tsx'), 'utf8');
const tree = ts.createSourceFile('Roster.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect = '', dependencies = '', loader = '';
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect'
    && node.arguments[0]?.getText(tree).includes('[Roster] Error in initial load:')) {
    effect = node.arguments[0].getText(tree);
    dependencies = node.arguments[1].getText(tree);
  }
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'loadRoster'
    && node.initializer && ts.isCallExpression(node.initializer)) loader = node.initializer.arguments[0].getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree);
if (!effect || !dependencies || !loader) throw new Error('Roster lifecycle callbacks not found');
function compile(expression: string) {
  const js = ts.transpileModule(`const result = ${expression};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function('scope', `with(scope) { ${js}; return result; }`);
}
const makeEffect = compile(effect), makeDependencies = compile(dependencies), makeLoader = compile(loader);
type Readiness = { authLoading: boolean; user: { id: string } | null; leagueLoading: boolean; userLeagueState: string };
const pending: Readiness = { authLoading: true, user: null, leagueLoading: true, userLeagueState: 'guest' };
const toast = vi.fn();
function Harness({ state, read }: { state: Readiness; read: (kind: string) => void }) {
  const scope = { ...state, isChangingLeague: false, toast, loadRoster: () => read(state.userLeagueState) };
  useEffect(makeEffect(scope), makeDependencies(scope));
  return null;
}

it('does not read demo data while auth is pending; a resolved guest loads normally', () => {
  const read = vi.fn();
  const view = render(<Harness state={pending} read={read} />);
  expect(read).not.toHaveBeenCalled();
  view.rerender(<Harness state={{ ...pending, authLoading: false }} read={read} />);
  expect(read.mock.calls).toEqual([['guest']]);
});

it('waits for a signed-in user’s league and never dispatches a provisional guest read', () => {
  const read = vi.fn();
  const view = render(<Harness state={pending} read={read} />);
  const signed = { ...pending, authLoading: false, user: { id: 'signed-user' } };
  view.rerender(<Harness state={signed} read={read} />);
  view.rerender(<Harness state={{ ...signed, leagueLoading: false }} read={read} />);
  expect(read).not.toHaveBeenCalled();
  view.rerender(<Harness state={{ ...signed, leagueLoading: false, userLeagueState: 'active-user' }} read={read} />);
  expect(read.mock.calls).toEqual([['active-user']]);
});

it('retains the resolved signed-in no-league demo path', () => {
  const read = vi.fn();
  render(<Harness state={{ authLoading: false, user: { id: 'new-user' }, leagueLoading: false, userLeagueState: 'logged-in-no-league' }} read={read} />);
  expect(read.mock.calls).toEqual([['logged-in-no-league']]);
});

it('manual/background loader calls also stop before reads or state changes while unresolved', async () => {
  for (const state of [pending, { ...pending, authLoading: false, user: { id: 'signed-user' } },
    { ...pending, authLoading: false, user: { id: 'signed-user' }, leagueLoading: false }]) {
    const read = vi.fn();
    const setLoading = vi.fn(), setRoster = vi.fn();
    const load = makeLoader({ ...state, setLoading, setRoster, PlayerService: { getAllPlayers: read } });
    await expect(load()).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
    expect(setLoading).not.toHaveBeenCalled();
    expect(setRoster).not.toHaveBeenCalled();
  }
});
