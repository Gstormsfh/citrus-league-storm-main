/** Actual reader + controlled faults on real loopback responses; no serving export. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { AnalyticsPublicationService, type MetricSelector } from '../../server/src/services/AnalyticsPublicationService';

const base = new URL(process.argv[2]);
assert(base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname));
assert(base.port && !base.username && !base.password && base.pathname === '/' && !base.search && !base.hash);
const tokens: Record<string, string> = JSON.parse(await readFile(process.argv[3], 'utf8'));
const claims = JSON.parse(Buffer.from(tokens.service_role.split('.')[1], 'base64url').toString());
assert.equal(claims.iss, 'citrus-local-integration');
assert.equal(claims.role, 'service_role');
const candidate = JSON.parse(await readFile(process.argv[4], 'utf8'));
const batch = candidate[1];
assert.equal(batch.metric, 'disposable_local_development_game_xg_diagnostic');
assert.equal(batch.population, 'eligible_validation_game_events_not_players_or_full_season_actuals');
assert.equal(candidate[0].payload.model_accepted, false);
assert.equal(candidate[0].payload.foundation_accepted, false);
assert.equal(candidate[0].payload.publishable, false);
const selector: MetricSelector = {
  metric: batch.metric, variant: batch.variant, unit: batch.unit, season: batch.season,
  game_type: batch.game_type, population: batch.population,
  feature_version: batch.feature_version, model_version: batch.model_version,
};
const expected = candidate[2].map((row: {
  entity_id: number; value: number | null; availability: string; reason: string;
}) => ({ entityId: row.entity_id, value: row.value, availability: row.availability, reason: row.reason }));
const clock = Date.parse(batch.data_cutoff) + 1000;
const maxAge = 48 * 60 * 60 * 1000;
const requests: { mode: string; path: string; offset: number; status: number }[] = [];
type Mode = 'none' | 'truncated' | 'duplicate' | 'invalid-value' | 'wrong-version' | 'failed-page';
function reader(mode: Mode = 'none', now = clock) {
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    assert.equal(url.origin, base.origin, 'Reader request left explicit loopback fixture');
    const response = await fetch(input, { ...init, redirect: 'error' });
    const offset = Number(url.searchParams.get('offset') ?? 0);
    requests.push({ mode, path: url.pathname, offset, status: response.status });
    const valuesPage = url.pathname.endsWith('/analytics_metric_values');
    const target = expected.length > 500 ? 500 : 0;
    const alter = valuesPage && offset === target && mode !== 'none' && mode !== 'wrong-version';
    const wrongVersion = mode === 'wrong-version' && url.pathname.endsWith('/analytics_publications');
    if (!alter && !wrongVersion) return response;
    assert(response.ok, 'Fault must be applied to a successful real response');
    const body = await response.json();
    if (mode === 'failed-page') return new Response(JSON.stringify({ message: 'synthetic local page failure' }), {
      status: 503, headers: { 'content-type': 'application/json' },
    });
    if (mode === 'truncated') { assert(body.length > 0); body.pop(); }
    if (mode === 'duplicate') { assert(body.length > 1); body[1] = body[0]; }
    if (mode === 'invalid-value') { assert(body.length > 0); body[0].availability = 'available'; body[0].value = null; }
    if (wrongVersion) {
      assert(body.batch || body[0]?.batch);
      (body.batch ?? body[0].batch).model_version = 'synthetic-detached-version';
    }
    const headers = new Headers(response.headers);
    headers.delete('content-length'); headers.delete('content-encoding');
    return new Response(JSON.stringify(body), { status: response.status, headers });
  };
  const db = createClient(base.toString(), tokens.service_role, {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport },
  });
  return new AnalyticsPublicationService(db, () => now);
}

const actual = await reader().readLatest(selector, maxAge);
assert(actual);
assert.equal(actual.batchId, batch.id);
assert.deepEqual(actual.values, expected);
assert.equal(actual.sourceObservedAt, batch.validation.freshness_observed_at);
for (const value of actual.values) {
  assert.equal(Math.floor(value.entityId / 1_000_000), selector.season);
  assert.equal(Math.floor(value.entityId / 10_000) % 100, selector.game_type === 'regular' ? 2 : 3);
}
const staleClock = Math.max(clock, Date.parse(actual.sourceObservedAt) + maxAge + 1);
const stale = await reader('none', staleClock).readLatest(selector, maxAge);
assert(stale?.values.every(v => v.value === null && v.availability === 'unavailable' && v.reason === 'stale_source'));
for (const key of ['metric', 'variant', 'unit', 'population', 'feature_version', 'model_version'] as const) {
  assert.equal(await reader().readLatest({ ...selector, [key]: 'nonexistent-local-scope' }, maxAge), null);
}
assert.equal(await reader().readLatest({ ...selector, season: 1900 }, maxAge), null);
const faults: Record<string, string> = {};
for (const mode of ['truncated', 'duplicate', 'invalid-value', 'wrong-version', 'failed-page'] as const) {
  await assert.rejects(reader(mode).readLatest(selector, maxAge), error => {
    assert(error instanceof Error);
    const expectedText = { truncated: 'Incomplete', duplicate: 'Duplicate', 'invalid-value': 'availability',
      'wrong-version': 'variant/version', 'failed-page': 'read failed' }[mode];
    assert(error.message.includes(expectedText), error.message);
    faults[mode] = error.message;
    return true;
  });
}
console.log(JSON.stringify({ status: 'passed-local-reader-diagnostic-only', batch_id: actual.batchId,
  game_values: actual.values.length, available: actual.values.filter(v => v.availability === 'available').length,
  withheld: actual.values.filter(v => v.availability === 'unavailable').length,
  exact_database_value_roundtrip: true, stale_withheld: true, seven_wrong_scopes_absent: true,
  faults, requests, model_accepted: false, publishable: false }));
