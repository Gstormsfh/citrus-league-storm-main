import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingAnalyticsConfig } from './check-web-analytics-config.mjs';
test('detects the omitted project ID that compiled live analytics out', () => {
  const env = { VITE_FIREBASE_API_KEY: 'test-key', VITE_FIREBASE_APP_ID: 'test-app', VITE_FIREBASE_MEASUREMENT_ID: 'test-measurement' };
  assert.deepEqual(missingAnalyticsConfig(env), ['VITE_FIREBASE_PROJECT_ID']);
  assert.deepEqual(missingAnalyticsConfig({ ...env, VITE_FIREBASE_PROJECT_ID: 'verified-project' }), []);
});
