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
 *  5. Built with a stale VITE_APP_VERSION, every binary reports the SAME
 *     Sentry release. Build 2's errors and build 3's errors land in one
 *     bucket and nobody can tell which binary is crashing.
 *  6. Built with the PWA service worker, the shell precaches one build's
 *     hashed assets. Capacitor already ships those assets inside the .ipa,
 *     and a worker on top can keep serving the previous build's files after
 *     an App Store update has replaced them underneath.
 *
 * So: set VITE_NATIVE=1 (index.html transforms and the VitePWA `disable`
 * flag key off it), compute VITE_APP_VERSION from package.json plus the
 * Xcode build number, build, then ASSERT the output. A bundle with any of
 * the above defects is refused here rather than discovered by a tester.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

// ---------------------------------------------------------------------------
// RELEASE VERSION  (added 2026-09-03)
//
// apps/web/src/integrations/sentry/config.ts tags every event with
//     release: `citrus-fantasy@${import.meta.env.VITE_APP_VERSION}`
// A hardcoded VITE_APP_VERSION in root .env goes stale the moment the next
// binary ships, and then build 2 and build 3 report the SAME release: their
// errors land in one Sentry bucket and nobody can tell which binary crashes.
//
// So the native build computes it instead:
//     <apps/web/package.json version>+<CURRENT_PROJECT_VERSION>
// where CURRENT_PROJECT_VERSION is the Xcode build number in
// ios/App/App.xcodeproj/project.pbxproj (Info.plist resolves CFBundleVersion
// from it, so it is exactly the build number App Store Connect shows).
//
// It reaches Vite through process.env, the same way VITE_NATIVE does below.
// Vite's loadEnv() first collects VITE_* keys from the .env files and then
// copies every VITE_* key found in process.env over them (the final
// `for (const key in process.env)` loop in loadEnv, vite 5.4), so this value
// beats root .env. Plain `vite build` never runs this script and keeps the
// .env value as its fallback.
// ---------------------------------------------------------------------------
const PBXPROJ = join(WEB_DIR, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');

const readPackageVersion = () => {
  const pkgPath = join(WEB_DIR, 'package.json');
  const version = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
  if (!version) fail(`${pkgPath} has no "version" field; the Sentry release needs one.`);
  return version;
};

const readIosBuildNumber = () => {
  let pbx = '';
  try {
    pbx = readFileSync(PBXPROJ, 'utf8');
  } catch {
    fail(`cannot read the Xcode project at ${PBXPROJ}`);
  }
  const values = [...pbx.matchAll(/^\s*CURRENT_PROJECT_VERSION\s*=\s*"?([^";]+)"?\s*;/gm)].map((m) => m[1].trim());
  // The App target carries the build number once per build configuration
  // (Debug and Release). Xcode's General tab edits both; a hand edit may not,
  // and a Release binary tagged with the Debug number is worse than no tag.
  if (values.length < 2)
    fail(
      'expected CURRENT_PROJECT_VERSION in both the Debug and Release configurations of\n' +
        `${PBXPROJ}, found ${values.length}.`
    );
  if (new Set(values).size !== 1)
    fail(
      `CURRENT_PROJECT_VERSION disagrees between build configurations (${values.join(', ')}) in\n` +
        `${PBXPROJ}. Set the same build number on every configuration before building.`
    );
  return values[0];
};

const APP_VERSION = `${readPackageVersion()}+${readIosBuildNumber()}`;
// MUST match the template in apps/web/src/integrations/sentry/config.ts.
const SENTRY_RELEASE = `citrus-fantasy@${APP_VERSION}`;

console.log(`\n▸ native build: VITE_APP_VERSION=${APP_VERSION}  (Sentry release ${SENTRY_RELEASE})\n`);

const run = spawnSync('npx', ['vite', 'build', '--mode', MODE], {
  stdio: 'inherit',
  cwd: WEB_DIR,
  // NODE_ENV is forced here because the repo root .env carries
  // NODE_ENV=development and Vite 5 honours it on `vite build` when the
  // shell has not set one: the bundle then ships react-dom.development and
  // import.meta.env.PROD is false. That happened on 2026-09-03 (the
  // device build carried the dev warnings). Assertion 8 below refuses it.
  env: { ...process.env, NODE_ENV: 'production', VITE_NATIVE: '1', VITE_APP_VERSION: APP_VERSION },
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

// --- 6. The Sentry release tag is this build's, not the stale .env value ---
// config.ts writes `citrus-fantasy@${import.meta.env.VITE_APP_VERSION}` and
// esbuild folds the template into one string literal, so the exact tag has
// to be in the JS verbatim. If only the .env value got in, the process.env
// override above never reached Vite and every build would report the same
// release.
if (!blob.includes(SENTRY_RELEASE))
  fail(
    `Sentry release "${SENTRY_RELEASE}" is not in the bundle.\n\n` +
      'VITE_APP_VERSION did not reach Vite (or integrations/sentry/config.ts changed the\n' +
      'release template). Errors from this build would be filed under whatever release\n' +
      'the .env fallback produced, indistinguishable from the previous binary.'
  );

// --- 7. No service worker inside the native shell --------------------------
// vite.config.ts passes `disable: process.env.VITE_NATIVE === '1'` to VitePWA.
// Capacitor serves dist straight from the .ipa, so there is nothing for a
// worker to speed up, and its precache is a liability: it stores one build's
// hashed assets and can keep serving them after the App Store has replaced
// the files underneath (the .ipa swaps the bundle, the cache does not know).
const distDir = join(WEB_DIR, 'dist');
const swFiles = [
  'sw.js',
  'registerSW.js',
  ...readdirSync(distDir).filter((f) => /^workbox-.*\.js$/.test(f)),
].filter((f) => existsSync(join(distDir, f)));
if (swFiles.length > 0)
  fail(
    `service worker files survived into the native build: ${swFiles.join(', ')}.\n` +
      'VitePWA must be disabled when VITE_NATIVE=1 (see the VitePWA call in apps/web/vite.config.ts).'
  );
if (indexHtml.includes('registerSW') || indexHtml.includes('vite-plugin-pwa'))
  fail('index.html still injects the service worker registration script (vite-plugin-pwa:register-sw).');

// --- 8. A production bundle, not a development one ---------------------------
// The repo root .env sets NODE_ENV=development. Vite 5 copies a NODE_ENV it
// finds in an env file onto process.env when the shell has not set one, and
// then resolves package export conditions and process.env.NODE_ENV inlining
// against it. Measured 2026-09-03 on the device build: vendor chunk carried
// react-dom.development and the "Each child in a list should have a unique
// key" warning text; config.ts's `import.meta.env.PROD ? 0.1 : 1.0` had folded
// to 1. The spawn above forces NODE_ENV=production; this proves it took.
const devMarkers = ['react-dom.development', 'react.development', 'should have a unique "key" prop'];
const devHit = devMarkers.find((m) => blob.includes(m));
if (devHit)
  fail(
    `development bundle detected: "${devHit}" is in dist.\n` +
      'NODE_ENV must be "production" for the vite build (forced in the spawn env in this script).'
  );

console.log(
  '\n✓ native bundle verified\n' +
    `    backend    : ${dbIsProd ? 'PRODUCTION' : 'NON-PRODUCTION'}\n` +
    `    api origin : ${apiUrl}\n` +
    `    supabase   : ${supabaseRef}.supabase.co\n` +
    `    vite mode  : ${MODE}\n` +
    `    release    : ${SENTRY_RELEASE}\n` +
    '    ads        : stripped\n' +
    '    sw         : none (VitePWA disabled for native)\n'
);
