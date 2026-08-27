// CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
// CATEGORY: ACTIVE
// Purpose:     Refuse `supabase db push` against production; force an explicit --db-url
// Last active: 2026-08-27
// Invoked:     npm run db:push -- --db-url "<url>" [extra supabase flags]
// Reads:       argv, CITRUS_PROD_PUSH_ACK, supabase/.temp/project-ref
// Writes:      (spawns supabase db push against a non-prod target)
// ────────────────────────────────────────────────────────────
/**
 * `supabase db push` with no --db-url targets whatever the repo is linked to.
 * This repo links to iezwazccqqrhrjupxzvf, which is production. One forgotten
 * flag reaches it. Guarding by hand every time is not a control, so this is the
 * sanctioned entry point: it refuses the production ref outright and refuses to
 * run at all without an explicit target.
 *
 * Incident path: set CITRUS_PROD_PUSH_ACK to the production ref, exactly. That
 * cannot happen by forgetting a flag -- it takes typing the prod ref on purpose.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PROD_REF = 'iezwazccqqrhrjupxzvf';
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const die = (...lines) => {
  console.error(`\n  REFUSED: ${lines[0]}\n`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  console.error('');
  process.exit(1);
};

const argv = process.argv.slice(2);

// --db-url <url> or --db-url=<url>
const flagIndex = argv.findIndex((a) => a === '--db-url' || a.startsWith('--db-url='));
if (flagIndex === -1) {
  die(
    'no --db-url given.',
    'A bare `supabase db push` targets the linked project, which is production.',
    'Pass the target explicitly:',
    '',
    '  npm run db:push -- --db-url "postgresql://...<branch or local>..."',
  );
}
const dbUrl = argv[flagIndex].startsWith('--db-url=')
  ? argv[flagIndex].slice('--db-url='.length)
  : argv[flagIndex + 1];

if (!dbUrl || dbUrl.startsWith('--')) die('--db-url was given with no value.');

const ack = process.env.CITRUS_PROD_PUSH_ACK === PROD_REF;

if (dbUrl.includes(PROD_REF) && !ack) {
  die(
    `--db-url points at production (${PROD_REF}).`,
    'Migrations reach production through the reviewed path, not through db push.',
    `Incident override: CITRUS_PROD_PUSH_ACK=${PROD_REF}`,
  );
}

// The link file is the other way prod gets hit: it is what a bare push resolves to.
const refFile = join(REPO_ROOT, 'supabase', '.temp', 'project-ref');
if (existsSync(refFile)) {
  const linked = readFileSync(refFile, 'utf8').trim();
  if (linked === PROD_REF && !ack) {
    console.error(
      `\n  NOTE: this repo is linked to production (${PROD_REF}).` +
        `\n  Proceeding only because --db-url names a different target.\n`,
    );
  }
}

if (ack) {
  console.error(`\n  CITRUS_PROD_PUSH_ACK set. Pushing to PRODUCTION (${PROD_REF}).\n`);
}

const r = spawnSync('supabase', ['db', 'push', ...argv], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(r.status ?? 1);
