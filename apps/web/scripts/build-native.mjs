#!/usr/bin/env node
/**
 * The ONLY sanctioned way to build the web bundle for the iOS shell.
 *
 * It exists because a native build has failure modes an ordinary web build
 * does not, and every one of them is silent on device:
 *
 *  1. Built without env vars, the bundle inlines `undefined` for the Supabase
 *     URL/key and THROWS ON LOAD — a white screen for 100% of users.
 *  2. Built without VITE_API_URL, every API call is relative. That works on
 *     Firebase Hosting (rewrites) and dies on capacitor://localhost, which has
 *     no rewrites and no origin to be relative to.
 *  3. Built with a PRODUCTION api origin but a STAGING database (or the
 *     reverse), the app loads, authenticates against one backend and reads
 *     from another. Nothing errors; the data is just wrong.
 *  4. Built with the AdSense loader still in index.html — prohibited by App
 *     Store policy inside a native app.
 *
 * So: set VITE_NATIVE=1 (index.html transforms key off it), build, then ASSERT
 * the output. A bundle with any of the above defects is refused here rather
 * than discovered by a tester.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// WHERE ENV FILES ACTUALLY LIVE  (fixed 2026-08-25, second pass)
//
// apps/web/vite.config.ts sets:
//     envDir: path.resolve(__dirname, '../../')
// so Vite reads .env* from the MONOREPO ROOT — NOT from apps/web.
//
// Both the original check and its first fix looked in apps/web and then told
// you to "add it to .env", naming a file Vite never reads. Following that
// instruction produces a correctly-written file and an identical failure,
// which is about as hostile as an error message gets. Every message below
// prints the absolute path it actually looked at.
//
// If envDir changes in vite.config.ts, change ENV_DIR here to match.
// ---------------------------------------------------------------------------
const WEB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..'); // apps/web
const ENV_DIR = resolve(WEB_DIR, '..', '..'); // monorepo root — MUST match vite.config.ts envDir

// Which backend is "production". Both are public by design — the Supabase ref
// and the API origin are visible in every shipped bundle — so pinning them
// here leaks nothing and lets us reject an incoherent pairing.
const PRODUCTION_SUPABASE_REF = 'iezwazccqqrhrjupxzvf';
const PRODUCTION_API_ORIGINS = [
  'https://citrusfantasysports.com',
  'https://www.citrusfantasysports.com',
];

// NOTE ON MODE: vite.config.ts destructures `mode` and never uses it, so the
// mode's ONLY effect is which .env files Vite loads.
//
// This used to be 'staging', which meant the iOS binary quietly loaded
// .env.staging and pointed at the STAGING Supabase project — the opposite of
// what a TestFlight build wants, and invisible in the output. Nothing else
// keys off it: import.meta.env.DEV is false and PROD is true in either mode
// (vite build sets NODE_ENV=production regardless of --mode), so the only
// other observable difference is Sentry's `environment` tag, which should say
// production for a shipped binary anyway.
//
// Set NATIVE_BUILD_MODE=staging for a deliberate staging build — it will also
// need ALLOW_NON_PROD_NATIVE=1 from the check further down.
const MODE = process.env.NATIVE_BUILD_MODE || 'production';

// Vite's own precedence, lowest → highest.
const ENV_FILES = ['.env', '.env.local', `.env.${MODE}`, `.env.${MODE}.local`];

const readEnvFile = (f) => {
  try {
    return readFileSync(join(ENV_DIR, f), 'utf8').replace(/^\uFEFF/, '');
  } catch {
    return '';
  }
};

/** Last file to define the key wins, exactly as Vite resolves it. */
const fromEnvFiles = (key) => {
  let found = '';
  for (const f of ENV_FILES) {
    const m = readEnvFile(f).match(new RegExp(`^\\s*${key}\\s*=\\s*(.*?)\\s*$`, 'm'));
    const v = m?.[1]?.replace(/^["']|["']$/g, '') ?? '';
    if (v) found = v;
  }
  return found;
};

const fail = (msg) => {
  console.error('\n✗ NATIVE BUILD REJECTED: ' + msg + '\n');
  process.exit(1);
};

const envHelp =
  `Vite loads env files from ${ENV_DIR}\n` +
  `  (envDir in apps/web/vite.config.ts — files in apps/web/ are IGNORED)\n` +
  `  For mode "${MODE}" it reads, lowest priority first:\n` +
  ENV_FILES.map((f) => `    ${join(ENV_DIR, f)}`).join('\n');

const run = spawnSync('npx', ['vite', 'build', '--mode', MODE], {
  stdio: 'inherit',
  cwd: WEB_DIR,
  env: { ...process.env, VITE_NATIVE: '1' },
  shell: process.platform === 'win32',
});
if (run.status !== 0) process.exit(run.status ?? 1);

const assets = join(WEB_DIR, 'dist', 'assets');
const js = readdirSync(assets).filter((f) => f.endsWith('.js'));
const blob = js.map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');
const indexHtml = readFileSync(join(WEB_DIR, 'dist', 'index.html'), 'utf8');

// --- 1. Supabase reached the bundle, and exactly one project did -----------
const refs = [...new Set([...blob.matchAll(/https:\/\/([a-z0-9]{15,})\.supabase\.co/g)].map((m) => m[1]))];

if (refs.length === 0)
  fail(
    'no Supabase URL baked into the bundle — this build white-screens on load.\n\n' +
      'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY were not set at build time.\n\n' +
      envHelp
  );
if (refs.length > 1)
  fail(`the bundle references more than one Supabase project (${refs.join(', ')}). Refusing an ambiguous build.`);

const supabaseRef = refs[0];
const dbIsProd = supabaseRef === PRODUCTION_SUPABASE_REF;

// --- 2. An API origin was set, and it survived into the bundle -------------
const apiUrl = (process.env.VITE_API_URL || fromEnvFiles('VITE_API_URL') || '').replace(/\/+$/, '');

if (!apiUrl)
  fail(
    'VITE_API_URL is not set — every API call would be relative, and nothing is\n' +
      'relative to capacitor://localhost. The app would load and then fail every request.\n\n' +
      envHelp
  );
if (!blob.includes(apiUrl))
  fail(
    `VITE_API_URL (${apiUrl}) never made it into the bundle — the build did not pick up your env.\n\n` + envHelp
  );

const apiIsProd = PRODUCTION_API_ORIGINS.includes(apiUrl);

// --- 3. The API origin and the database must describe the SAME world -------
// This is the check that would have caught the 2026-08-25 near-miss: root
// .env.staging pointed at the staging project while the intent was a
// production TestFlight build. Auth against one backend, data from another,
// no error anywhere.
if (apiIsProd !== dbIsProd)
  fail(
    'backend mismatch — the API origin and the Supabase project disagree.\n\n' +
      `  API origin      : ${apiUrl}  (${apiIsProd ? 'PRODUCTION' : 'non-production'})\n` +
      `  Supabase project: ${supabaseRef}  (${dbIsProd ? 'PRODUCTION' : 'non-production'})\n\n` +
      'A build that authenticates against one backend and reads from the other\n' +
      'fails silently — it renders the wrong data rather than erroring.\n\n' +
      envHelp
  );

// --- 4. A non-production build must be deliberate --------------------------
// TestFlight goes to real testers. Shipping them a staging build is a mistake
// worth making someone type an env var to make.
if (!dbIsProd && process.env.ALLOW_NON_PROD_NATIVE !== '1')
  fail(
    `this build targets a NON-PRODUCTION backend (${supabaseRef} / ${apiUrl}).\n\n` +
      'If that is intentional, re-run with ALLOW_NON_PROD_NATIVE=1.\n' +
      'If it is not, point the env files at production before building.\n\n' +
      envHelp
  );

// --- 5. AdSense must not survive into a native binary ----------------------
if (indexHtml.includes('adsbygoogle'))
  fail('AdSense loader survived into the native build — the VITE_NATIVE strip did not run.');

console.log(
  '\n✓ native bundle verified\n' +
    `    backend    : ${dbIsProd ? 'PRODUCTION' : 'NON-PRODUCTION'}\n` +
    `    api origin : ${apiUrl}\n` +
    `    supabase   : ${supabaseRef}.supabase.co\n` +
    `    vite mode  : ${MODE}\n` +
    '    ads        : stripped\n'
);
