import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const sha = 'a'.repeat(40);
const league = '3fd3e70c-fa85-432f-b98a-b29ce43a519c';
const blocker = { league_id: league, league_name: 'Roster text', reason: 'draft in progress', at_time: '2026-09-12T22:40:00Z' };
const dispatch = {
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_WORKFLOW: 'Production Deploy',
  GITHUB_REF: 'refs/heads/master', GITHUB_SHA: sha, GITHUB_REPOSITORY: 'owner/repo',
  GITHUB_WORKFLOW_REF: 'owner/repo/.github/workflows/production-deploy.yml@refs/heads/master',
  PRODUCTION_DRAFT_EXCEPTION_SHA: sha, PRODUCTION_DRAFT_EXCEPTION_LEAGUE: league,
  PRODUCTION_DRAFT_EXCEPTION_REASON: 'User explicitly approved this release despite this known auto draft.',
};
function run(overrides = {}, blockers = [blocker], failure = false) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GITHUB_') && !key.startsWith('PRODUCTION_DRAFT_EXCEPTION_') && key !== 'OVERRIDE_DRAFT_FREEZE'));
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    globalThis.fetch = async (_url, options) => {
      const request = JSON.parse(options.body);
      console.log('FETCH_WINDOW=' + request.p_upcoming_hours);
      return { ok: ${!failure}, status: 503, statusText: 'unavailable', text: async () => 'unavailable', json: async () => ${JSON.stringify(blockers)} };
    };
    await import('./scripts/check_draft_freeze.ts');
  `], { cwd: new URL('..', import.meta.url), env: { ...env, SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-only', ...overrides }, encoding: 'utf8' });
  assert.equal(result.error, undefined);
  return { code: result.status, output: result.stdout + result.stderr };
}
test('ordinary push still blocks an active draft and allows clear state', () => {
  assert.equal(run({ GITHUB_EVENT_NAME: 'push' }).code, 1);
  assert.equal(run({ GITHUB_EVENT_NAME: 'push' }, []).code, 0);
});
test('valid exact-release exception retains RPC read and audit', () => {
  const result = run(dispatch);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /FETCH_WINDOW=4/);
  assert.match(result.output, /Draft exception audit:/);
  assert.match(result.output, /draft state is unchanged/);
  assert.doesNotMatch(result.output, /no draft running now/);
});
for (const [label, change] of [
  ['missing SHA', { PRODUCTION_DRAFT_EXCEPTION_SHA: '' }],
  ['wrong SHA', { PRODUCTION_DRAFT_EXCEPTION_SHA: 'b'.repeat(40) }],
  ['malformed SHA', { PRODUCTION_DRAFT_EXCEPTION_SHA: 'master' }],
  ['wrong league', { PRODUCTION_DRAFT_EXCEPTION_LEAGUE: '00000000-0000-0000-0000-000000000000' }],
  ['missing reason', { PRODUCTION_DRAFT_EXCEPTION_REASON: '' }],
  ['multiline reason', { PRODUCTION_DRAFT_EXCEPTION_REASON: 'approved\n::warning::inject' }],
  ['push leakage', { GITHUB_EVENT_NAME: 'push' }],
  ['engine leakage', { GITHUB_WORKFLOW: 'Deploy Draft Engine' }],
  ['wrong workflow file', { GITHUB_WORKFLOW_REF: 'owner/repo/.github/workflows/deploy-engine.yml@refs/heads/master' }],
  ['wrong ref', { GITHUB_REF: 'refs/heads/other' }],
  ['global bypass mixed with scoped exception', { OVERRIDE_DRAFT_FREEZE: '1' }],
]) test(`${label} fails closed before reading the database`, () => {
  const result = run({ ...dispatch, ...change });
  assert.equal(result.code, 2, result.output);
  assert.doesNotMatch(result.output, /FETCH_WINDOW=/);
});
test('production dispatch without exception inputs fails closed', () => {
  assert.equal(run({ ...dispatch, PRODUCTION_DRAFT_EXCEPTION_SHA: '', PRODUCTION_DRAFT_EXCEPTION_LEAGUE: '', PRODUCTION_DRAFT_EXCEPTION_REASON: '' }).code, 2);
});
test('additional blocker refuses the entire run', () => {
  const result = run(dispatch, [blocker, { ...blocker, league_id: 'other-league' }]);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /Additional draft blocker/);
});
test('database failure cannot be excepted', () => assert.equal(run(dispatch, [], true).code, 2));
test('engine dispatch without scoped inputs retains ordinary protection', () => {
  assert.equal(run({ GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_WORKFLOW: 'Deploy Draft Engine' }).code, 1);
});
test('workflow scopes inputs to dispatch and keeps API-first deployment dependencies', () => {
  const workflow = readFileSync(new URL('../.github/workflows/production-deploy.yml', import.meta.url), 'utf8');
  const engine = readFileSync(new URL('../.github/workflows/deploy-engine.yml', import.meta.url), 'utf8');
  assert.equal((workflow.match(/github.event_name == 'workflow_dispatch' && inputs\./g) || []).length, 3);
  assert.match(workflow, /needs: \[gate, deploy-api\]/);
  assert.match(workflow, /Test draft exception guard/);
  assert.doesNotMatch(engine, /PRODUCTION_DRAFT_EXCEPTION/);
});
