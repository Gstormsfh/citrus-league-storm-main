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
// VITE_API_URL RESOLUTION (fixed 2026-08-25).
//
// This used to test `process.env.VITE_API_URL`, which Node only populates from
// the actual shell environment — it never reads .env files; Vite does that
// itself and inlines the value at build time. So a correctly configured .env
// build was rejected with an error instructing you to "Add it to .env", which
// you already had. The check was looking in the wrong place.
//
// Resolve from the shell first, then the .env files Vite itself would load for
// this mode (staging), and then assert the value actually reached the bundle —
// which is the only thing that really proves the native build can talk to the
// API at all.
const readEnvFile = (file) => {
  try {
    return readFileSync(join(process.cwd(), file), 'utf8');
  } catch {
    return '';
  }
};
const apiUrl =
  process.env.VITE_API_URL ||
  ['.env.staging.local', '.env.staging', '.env.local', '.env']
    .map((f) => readEnvFile(f).match(/^\s*VITE_API_URL\s*=\s*(.+?)\s*$/m)?.[1])
    .find(Boolean) ||
  '';

if (!apiUrl)
  fail('VITE_API_URL is not set — every API call would fail against capacitor://localhost. Set it in apps/web/.env.');
if (!blob.includes(apiUrl.replace(/\/+$/, '')))
  fail(`VITE_API_URL (${apiUrl}) never made it into the bundle — the build did not pick up your env. Every API call would fail on device.`);
if (indexHtml.includes('adsbygoogle'))
  fail('AdSense loader survived into the native build — the VITE_NATIVE strip did not run.');

console.log('\n✓ native bundle verified: Supabase env baked, API origin set, ads stripped.\n');
