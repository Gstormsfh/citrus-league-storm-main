/** Actual production reader against a disposable localhost PostgREST fixture. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { AnalyticsPublicationService, type MetricSelector } from '../server/src/services/AnalyticsPublicationService';

const base = new URL(process.env.CITRUS_LOCAL_PUBLICATION_URL ?? '');
assert(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) && base.protocol === 'http:');
assert(base.port && !base.username && !base.password && base.pathname === '/');
const token = await readFile(process.env.CITRUS_LOCAL_PUBLICATION_TOKEN_FILE!, 'utf8');
const claims = JSON.parse(Buffer.from(token.trim().split('.')[1], 'base64url').toString());
assert.equal(claims.iss, 'citrus-local-integration');
assert.equal(claims.role, 'service_role');
const expected = JSON.parse(await readFile(process.argv[2], 'utf8'));
const batch = expected[1];
const keys = ['metric', 'variant', 'unit', 'season', 'game_type', 'population', 'feature_version', 'model_version'];
const selector = Object.fromEntries(keys.map(key => [key, batch[key]])) as unknown as MetricSelector;
const db = createClient(base.toString(), token.trim(), { auth: { persistSession: false, autoRefreshToken: false } });
const reader = new AnalyticsPublicationService(db);
const result = await reader.readLatest(selector, 48 * 60 * 60 * 1000);
assert(result);
assert.equal(result.batchId, batch.id);
assert.equal(result.values.length, batch.expected_entities);
const desired = expected[2].map((row: { entity_id: number; value: number | null; availability: string; reason: string }) =>
  ({ entityId: row.entity_id, value: row.value, availability: row.availability, reason: row.reason }));
assert.deepEqual(result.values, desired);
assert.equal(result.sourceObservedAt, batch.validation.freshness_observed_at);
const stale = await reader.readLatest(selector, 1);
assert(stale?.values.every(row => row.availability === 'unavailable' && row.value === null && row.reason === 'stale_source'));
console.log(JSON.stringify({ batch_id: result.batchId, values: result.values.length,
  available: result.values.filter(row => row.availability === 'available').length,
  withheld: result.values.filter(row => row.availability === 'unavailable').length,
  stale_policy_verified: true, actual_reader: 'AnalyticsPublicationService' }));
