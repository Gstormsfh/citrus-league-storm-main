/** Contract tests execute the actual UI functions, not copies of their logic.
 * Run: node scripts/projection-review/test_ui.mjs
 * Optional real source: node scripts/projection-review/test_ui.mjs /path/canonical.json
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'UI script must exist');
// Remove only the boot request; event handlers and all production functions run.
const boot = script.lastIndexOf('(async()=>');
assert.ok(boot > 0, 'UI source-loading bootstrap must be identifiable');
const source = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : {
  revision: 'fixture-base', schedule: { COL: 84 },
  players: [{ player_id: '1', name: 'Review skater', team: 'COL', status: 'projected',
    rates: { goals: 0.1, assists: 0.2, plus_minus: -0.1 },
    exposure: { used: 83, roster_probability: 1 }, availability: { status: 'unknown', source: null }, role: {} },
  { player_id: '2', name: 'Unallocated goalie', team: 'COL', status: 'rates_only',
    rates: { wins: 0.5, saves: 25 }, exposure: { used: null, roster_probability: null }, availability: {}, role: {} }],
  teams: [{ team: 'COL', notes: [{ text: 'Imported note', row: 5, column: 18, authority: 'imported_scenario' }] }],
};
const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    value: '', textContent: '', innerHTML: '', disabled: false,
    classList: { toggle() {}, contains() { return false; } },
    addEventListener() {}, scrollIntoView() {},
  });
  return elements.get(id);
}
let fetchedContext = { kind: 'published_source', runtime_run_id: 'runtime-run', runtime_revision: 'runtime-v1', source_run_id: 'source-run', source_revision: source.revision };
let fetchedRevision = source.revision, fetchFails = false, downloads = 0, fetches = 0;
const context = vm.createContext({
  console, Blob, setTimeout() {},
  document: { querySelector: element, createElement: () => ({ click() { downloads++; } }) },
  window: { addEventListener() {} }, confirm: () => true,
  URL: { createObjectURL: () => 'blob:qa', revokeObjectURL() {} },
  fetch: async (url, options) => { assert.equal(url, '/api/review'); assert.equal(options.cache, 'no-store'); fetches++; return { ok: !fetchFails, json: async () => ({ source: { ...source, revision: fetchedRevision }, publication_context: { ...fetchedContext, source_revision: fetchedRevision } }) }; },
});
vm.runInContext(script.slice(0, boot), context, { filename: fileURLToPath(new URL('./index.html', import.meta.url)) });
const run = code => vm.runInContext(code, context);
context.fixture = structuredClone(source);
context.fixtureContext = structuredClone(fetchedContext);
run('base=copy(fixture);draft=copy(fixture);publicationContext=copy(fixtureContext);showPublicationContext()');
assert.match(element('#contextLabel').textContent, /unpublished draft/);
assert.deepEqual(JSON.parse(element('#publicationContext').textContent), fetchedContext);
assert.throws(() => run("reviewEnvelope({source:fixture,publication_context:{...fixtureContext,source_revision:'mismatch'}})"), /does not match/);
assert.equal(run("reviewEnvelope({source:fixture,publication_context:{kind:'local_draft'}}).publication_context.kind"), 'local_draft');
assert.equal(run('validate()'), null, 'valid source must not block all exports');
const target = source.players.findIndex(p => p.status === 'projected' && Object.keys(p.rates || {}).length && Number.isFinite(source.schedule[p.team]));
assert.ok(target >= 0, 'test source needs a projected player with scheduled team');
context.target = target;
const rate = Object.keys(source.players[target].rates)[0];
context.rate = rate;
run('draft.players[target].rates[rate]=null');
assert.match(run('validate()'), /finite number/, 'blank rate must block export');
run('draft=copy(base);draft.players[target].exposure.used=null');
assert.match(run('validate()'), /requires exposure/, 'projected null exposure must block');
run('draft=copy(base);draft.players[target].exposure.used=base.schedule[draft.players[target].team]+1');
assert.match(run('validate()'), /exceed/, 'exposure beyond schedule must block');
run('draft=copy(base);draft.players[target].exposure.used=0');
assert.equal(run('validate()'), null, 'explicit zero remains valid');
run('draft.players[target].rates={};draft.players[target].exposure.used=1');
assert.match(run('validate()'), /requires exposure and rates/, 'projected positive exposure requires rates');
run('draft.players[target].exposure.used=0');
assert.equal(run('validate()'), null, 'explicit zero allows absent rate map');
run('draft=copy(base);draft.players[target].exposure.roster_probability=1.1');
assert.match(run('validate()'), /valid range/, 'probability cannot exceed one');
const ratesOnly = source.players.find(p => p.status === 'rates_only' && Object.keys(p.rates || {}).length);
assert.ok(ratesOnly, 'test source needs a rates-only player');
context.previewPlayer = { ...structuredClone(ratesOnly), exposure: { ...ratesOnly.exposure, used: 10 } };
run('renderCounts(previewPlayer)');
assert.equal((element('#counts').innerHTML.match(/Unavailable/g) || []).length, Object.keys(ratesOnly.rates).length, 'adding exposure alone cannot manufacture forecast coverage');
run('draft=copy(base);draft.players[target].rates[rate]=0');
element('#reason').value = 'Contract QA only';
element('#evidence').value = 'Local fixture evidence';
const patch = JSON.parse(run('JSON.stringify(patch())'));
assert.equal(patch.base_revision, source.revision);
assert.deepEqual(Object.keys(patch), ['base_revision', 'reason', 'evidence', 'player_updates', 'team_updates'], 'publication context must not change strict patch keys');
assert.deepEqual(Object.keys(patch.player_updates[0].changes.rates), Object.keys(source.players[target].rates), 'changed rate exports the complete original map');
assert.equal(patch.player_updates[0].changes.rates[rate], 0);
assert.deepEqual(Object.keys(patch.player_updates[0].changes), ['rates'], 'unmodified sections must not appear');
run("draft.teams[0].notes[0].text='Reviewed text';draft.teams[0].notes.push({text:'New evidence',authority:'manual_review'})");
const teamPatch = JSON.parse(run('JSON.stringify(patch())')).team_updates[0];
assert.deepEqual(teamPatch.changes.notes[0], { ...source.teams[0].notes[0], text: 'Reviewed text' });
assert.deepEqual(teamPatch.changes.notes.slice(1, -1), source.teams[0].notes.slice(1), 'untouched notes are preserved');
assert.deepEqual(teamPatch.changes.notes.at(-1), { text: 'New evidence', authority: 'manual_review' });
const objectSource = run("field('source','availability','source',{url:'reference',as_of:'2026-09-12'})");
assert.match(objectSource, /read only/);
assert.ok(!objectSource.includes('<input'), 'object source metadata must not be edited as a string');
for (const [reason, evidence] of [['', 'Evidence'], ['Reason', '']]) {
  element('#reason').value = reason; element('#evidence').value = evidence;
  await element('#download').onclick();
  assert.equal(downloads, 0, 'reason and evidence are both mandatory');
}
element('#reason').value = 'Reason'; element('#evidence').value = 'Evidence';
const preserved = run('JSON.stringify(draft)');
fetchedRevision = 'different-revision';
await element('#download').onclick();
assert.equal(downloads, 0, 'stale source revision must block download');
assert.match(element('#status').textContent, /revision changed/);
assert.equal(run('JSON.stringify(draft)'), preserved, 'stale revision must preserve draft');
assert.equal(run('base.revision'), source.revision, 'base must remain fixed');
fetchedRevision = source.revision; fetchFails = true;
await element('#download').onclick();
assert.equal(downloads, 0, 'failed revision verification must fail closed');
assert.equal(run('JSON.stringify(draft)'), preserved);
fetchFails = false;
await element('#download').onclick();
assert.equal(downloads, 1, 'valid matching revision permits one local download');
assert.equal(fetches, 3, 'each valid export attempt checks source revision');
fetchedContext.runtime_revision = 'runtime-v2';
await element('#download').onclick();
assert.equal(downloads, 2, 'runtime-only change permits a source-valid patch download');
assert.match(element('#contextWarning').textContent, /compare-and-swap/);
assert.equal(run('publicationContext.runtime_revision'), 'runtime-v1', 'loaded runtime context stays immutable');
assert.equal(JSON.parse(element('#publicationContext').textContent).runtime_revision, 'runtime-v1');
assert.equal(run('JSON.stringify(base)'), JSON.stringify(source), 'source remains unchanged through all edits/exports');
console.log('PASS actual UI: validation, null/zero, coverage preview, complete rate map, note preservation, evidence requirements, stale/failed revision and valid download');
