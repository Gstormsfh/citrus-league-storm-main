#!/usr/bin/env node
/**
 * SWEEP (2026-08-15) — the ONLY sanctioned way to build the web bundle
 * for the iOS shell. Exists because two silent failure modes were found
 * in the ordinary build when it lands inside Capacitor:
 *
 *  1. A build made without env vars inlines `undefined` for the
 *     Supabase URL/key and THROWS ON LOAD — a white screen for 100% of
 *     users. (Found shipped in a container build during the Aug 15
 *     sweep; nothing in the pipeline would have caught it.)
 *  2. A build without VITE_API_URL makes every API call relative,
 *     which works on Firebase Hosting (rewrites) and fails silently on
 *     capacitor://localhost (no rewrites).
 *
 * So this script: sets VITE_NATIVE=1 (index.html transforms key off it,
 * e.g. stripping the AdSense loader that is policy-prohibited inside a
 * native app), runs the staging-mode build, then ASSERTS the output —
 * refusing to hand Capacitor a bundle with either defect.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const run = spawnSync('npx', ['vite', 'build', '--mode', 'staging'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_NATIVE: '1' },
  shell: process.platform === 'win32',
});
if (run.status !== 0) process.exit(run.status ?? 1);

const assets = join(process.cwd(), 'dist', 'assets');
const js = readdirSync(assets).filter((f) => f.endsWith('.js'));
const blob = js.map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');
const indexHtml = readFileSync(join(process.cwd(), 'dist', 'index.html'), 'utf8');

const fail = (msg) => { console.error('\n✗ NATIVE BUILD REJECTED: ' + msg + '\n'); process.exit(1); };

if (!/https:\/\/[a-z0-9]+\.supabase\.co/.test(blob))
  fail('no Supabase URL baked into the bundle — env vars were missing at build time (this build white-screens on load).');
if (!process.env.VITE_API_URL)
  fail('VITE_API_URL is not set — every API call would fail against capacitor://localhost. Add it to .env.');
if (indexHtml.includes('adsbygoogle'))
  fail('AdSense loader survived into the native build — the VITE_NATIVE strip did not run.');

console.log('\n✓ native bundle verified: Supabase env baked, API origin set, ads stripped.\n');
