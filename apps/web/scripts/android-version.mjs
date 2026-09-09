#!/usr/bin/env node
/**
 * ONE VERSION, TWO STORES (2026-09-09, Play Store prep).
 *
 * The iOS build number (CURRENT_PROJECT_VERSION in project.pbxproj) and
 * marketing version (MARKETING_VERSION) are the source of truth for the
 * binary's identity: build-native.mjs already derives the Sentry release from
 * them. Android carries its own copies in android/app/build.gradle
 * (versionCode, versionName), and two hand-edited numbers drift the first
 * time someone bumps one and forgets the other. Play then rejects an upload
 * whose versionCode did not increase, or Sentry files two stores' crashes
 * under one release.
 *
 * `npm run android:sync` runs this after the bundle is built: it copies the
 * Xcode numbers into build.gradle and refuses to continue if the Xcode
 * project disagrees with itself. Nothing else edits build.gradle's versions.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PBXPROJ = join(WEB_DIR, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
const GRADLE = join(WEB_DIR, 'android', 'app', 'build.gradle');

const fail = (msg) => {
  console.error(`\n✗ android-version: ${msg}\n`);
  process.exit(1);
};

const unique = (pbx, key) => {
  const values = [...pbx.matchAll(new RegExp(`^\\s*${key}\\s*=\\s*"?([^";]+)"?\\s*;`, 'gm'))].map((m) => m[1].trim());
  if (values.length < 2) fail(`expected ${key} in both Debug and Release of ${PBXPROJ}, found ${values.length}`);
  if (new Set(values).size !== 1) fail(`${key} disagrees between configurations (${values.join(', ')}) in ${PBXPROJ}`);
  return values[0];
};

const pbx = readFileSync(PBXPROJ, 'utf8');
const build = unique(pbx, 'CURRENT_PROJECT_VERSION');
const marketing = unique(pbx, 'MARKETING_VERSION');
if (!/^\d+$/.test(build)) fail(`CURRENT_PROJECT_VERSION must be an integer for Play's versionCode, got "${build}"`);

let gradle = readFileSync(GRADLE, 'utf8');
const before = gradle;
gradle = gradle.replace(/^(\s*versionCode\s+)\d+\s*$/m, `$1${build}`);
gradle = gradle.replace(/^(\s*versionName\s+)"[^"]*"\s*$/m, `$1"${marketing}"`);
if (!/^\s*versionCode\s+\d+\s*$/m.test(gradle) || !/^\s*versionName\s+"[^"]*"\s*$/m.test(gradle)) {
  fail(`could not find versionCode/versionName in ${GRADLE}`);
}
if (gradle !== before) writeFileSync(GRADLE, gradle);
console.log(`\n▸ android: versionCode ${build}, versionName ${marketing} (from the Xcode project)${gradle !== before ? '' : ' - already in sync'}\n`);
