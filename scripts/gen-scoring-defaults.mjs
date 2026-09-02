// CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
// CATEGORY: ACTIVE
// Purpose:     Generate every non-TypeScript copy of the default scoring weights from the one source
// Last active: 2026-09-01
// Invoked:     npm run gen:scoring  (CI: npm run gen:scoring:check — fails when a generated file is stale)
// Reads:       packages/shared/src/constants/scoringDefaults.json
// Writes:      data-pipeline/scoring/scoring_defaults.py, docs/generated/SCORING_DEFAULTS.md
// ────────────────────────────────────────────────────────────
/**
 * Default scoring used to live in ~20 hand-synced homes (shared TS, a web
 * mirror, the CreateLeague form, two BASE_STATS, the commissioner form, the
 * server fallback, ~10 Python dicts and `.get()` fallbacks, Stormy's prompt,
 * three docs). A guard test proved they agreed on the day it was written,
 * not that there was one source — the next change was 20 edits again.
 *
 * Now: `packages/shared/src/constants/scoringDefaults.json` is the source.
 * TypeScript imports it directly. This script emits the two copies that
 * cannot import JSON from the shared package:
 *
 *   data-pipeline/scoring/scoring_defaults.py   every Python home imports it
 *   docs/generated/SCORING_DEFAULTS.md          every doc links to it
 *
 * Plain Node, no dependencies, deterministic output (LF line endings, stable
 * key order) so `--check` and `git diff --exit-code` are meaningful.
 *
 *   node scripts/gen-scoring-defaults.mjs          write the generated files
 *   node scripts/gen-scoring-defaults.mjs --check  exit 1 if any is stale
 *
 * The SQL homes (stat_catalog, the zero-UUID league_scoring_rules rows, the
 * leagues.scoring_settings column default, the projection-rebuild RPCs) are
 * deliberately NOT generated: they ship as migrations. See the docs table.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE_PATH = join(REPO_ROOT, 'packages/shared/src/constants/scoringDefaults.json');
export const PYTHON_OUT = join(REPO_ROOT, 'data-pipeline/scoring/scoring_defaults.py');
export const DOCS_OUT = join(REPO_ROOT, 'docs/generated/SCORING_DEFAULTS.md');

const SOURCE_REL = 'packages/shared/src/constants/scoringDefaults.json';
const GROUPS = new Set(['skater', 'goalie']);
const CATEGORIES = new Set(['Offense', 'Defense', 'Goalie']);
const FIELDS = ['key', 'id', 'name', 'abbr', 'group', 'category', 'points', 'optIn', 'suggested', 'pipelineKey', 'legacyBatchKey'];

// ── Validation ─────────────────────────────────────────────────────────
// The JSON is hand-edited; a malformed row would silently become a wrong
// weight downstream. Fail loudly here instead.

export function validate(source) {
  const problems = [];
  const p = source.provenance;
  if (!p || typeof p !== 'object') problems.push('provenance: missing');
  else {
    for (const f of ['standard', 'sourceUrl', 'effectiveDate', 'optInRationale']) {
      if (typeof p[f] !== 'string' || !p[f]) problems.push(`provenance.${f}: missing`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.effectiveDate ?? '')) problems.push('provenance.effectiveDate: not an ISO date');
    if (!Array.isArray(p.deviations)) problems.push('provenance.deviations: not an array');
  }
  if (!Array.isArray(source.stats) || source.stats.length === 0) {
    problems.push('stats: missing or empty');
    return problems;
  }
  const seen = { key: new Set(), id: new Set(), pipelineKey: new Set(), legacyBatchKey: new Set() };
  source.stats.forEach((stat, i) => {
    const where = `stats[${i}] (${stat?.key ?? '?'})`;
    for (const f of FIELDS) if (!(f in stat)) problems.push(`${where}: missing field "${f}"`);
    for (const f of Object.keys(stat)) if (!FIELDS.includes(f)) problems.push(`${where}: unknown field "${f}"`);
    for (const f of ['key', 'id', 'name', 'abbr']) {
      if (typeof stat[f] !== 'string' || !stat[f]) problems.push(`${where}: "${f}" must be a non-empty string`);
    }
    if (!GROUPS.has(stat.group)) problems.push(`${where}: group must be skater|goalie`);
    if (!CATEGORIES.has(stat.category)) problems.push(`${where}: category must be Offense|Defense|Goalie`);
    if (typeof stat.points !== 'number' || !Number.isFinite(stat.points)) problems.push(`${where}: points must be a finite number`);
    if (typeof stat.optIn !== 'boolean') problems.push(`${where}: optIn must be boolean`);
    if (stat.optIn) {
      if (stat.points !== 0) problems.push(`${where}: opt-in stats ship at 0 (points is ${stat.points})`);
      if (typeof stat.suggested !== 'number' || !Number.isFinite(stat.suggested)) problems.push(`${where}: opt-in stats need a numeric "suggested" weight`);
    } else if (stat.suggested !== null) {
      problems.push(`${where}: "suggested" is only for opt-in stats (use null)`);
    }
    for (const f of ['pipelineKey', 'legacyBatchKey']) {
      if (stat[f] !== null && (typeof stat[f] !== 'string' || !stat[f])) problems.push(`${where}: "${f}" must be a non-empty string or null`);
    }
    for (const f of ['key', 'id', 'pipelineKey', 'legacyBatchKey']) {
      const v = stat[f];
      if (v === null || v === undefined) continue;
      if (seen[f].has(v)) problems.push(`${where}: duplicate ${f} "${v}"`);
      seen[f].add(v);
    }
  });
  if (p && Array.isArray(p.deviations)) {
    for (const d of p.deviations) {
      if (!seen.key.has(d?.key)) problems.push(`provenance.deviations: unknown stat key "${d?.key}"`);
      if (typeof d?.note !== 'string' || !d.note) problems.push(`provenance.deviations[${d?.key}]: missing note`);
    }
  }
  return problems;
}

export function loadSource() {
  const source = JSON.parse(readFileSync(SOURCE_PATH, 'utf-8'));
  const problems = validate(source);
  if (problems.length > 0) {
    throw new Error(`${SOURCE_REL} is malformed:\n  - ${problems.join('\n  - ')}`);
  }
  return source;
}

// ── Formatting helpers ─────────────────────────────────────────────────

/** Python float literal: 6 → "6.0", 0.9 → "0.9", -3 → "-3.0". Every weight is a float downstream. */
const pyFloat = (n) => (Number.isInteger(n) ? `${n}.0` : `${n}`);
/** Python string literal with double quotes (the pipeline's house style). */
const pyStr = (s) => JSON.stringify(s);
/** Table cell: -3 → "−3" (typographic minus, matches Stormy's prompt). */
const cell = (n) => (n < 0 ? `−${Math.abs(n)}` : `${n}`);

const pyDict = (name, entries, comment) => {
  const lines = [];
  for (const line of comment.split('\n')) lines.push(`# ${line}`.trimEnd());
  lines.push(`${name} = {`);
  for (const [k, v] of entries) lines.push(`    ${pyStr(k)}: ${pyFloat(v)},`);
  lines.push('}');
  return lines.join('\n');
};

// ── Python module ──────────────────────────────────────────────────────

export function renderPython(source) {
  const { provenance, stats } = source;
  const skater = stats.filter((s) => s.group === 'skater');
  const goalie = stats.filter((s) => s.group === 'goalie');
  const optIn = stats.filter((s) => s.optIn);
  const deviations = provenance.deviations.map((d) => `    ${d.key}: ${d.note}`).join('\n');

  const header = `"""Default fantasy scoring weights — GENERATED FILE, DO NOT EDIT.

Source:     ${SOURCE_REL}
Generator:  scripts/gen-scoring-defaults.mjs  (npm run gen:scoring)
Freshness:  CI runs the generator and fails on any diff, so this file can
            never be stale on master. Edit the JSON, regenerate, commit both.

${provenance.standard} (${provenance.sourceUrl}), effective ${provenance.effectiveDate}.
${provenance.optInRationale}

Deviations from the standard:
${deviations}

Vocabularies (the pipeline speaks three):
    SKATER / GOALIE      canonical leagues.scoring_settings keys
                         (shots_on_goal, power_play_points, ...)
    SKATER_SHORT         per-game stat keys used by simulate_matchups /
                         projection_uncertainty / the monitoring audits
                         (sog, ppp, shp, pim, ...). Goalie keys are the same
                         in both vocabularies, so GOALIE serves both.
    LEGACY_BATCH_KEYS    the flat legacy vocabulary nightly_projection_batch
                         falls back to (blocked_shots, powerplay_points, ...).

Every dict maps stat -> points per unit as a float. Never mutate these; use
scoring_settings() when you need a mutable nested copy.
"""

SOURCE_URL = ${pyStr(provenance.sourceUrl)}
EFFECTIVE_DATE = ${pyStr(provenance.effectiveDate)}
`;

  const blocks = [
    pyDict('SKATER', skater.map((s) => [s.key, s.points]),
      'Skater weights, canonical keys. plus_minus is carried for parity with the\nTS constant; the pipeline has no per-game stat for it (see SKATER_SHORT).'),
    pyDict('GOALIE', goalie.map((s) => [s.key, s.points]),
      'Goalie weights, canonical keys (identical to the short vocabulary).'),
    pyDict('SKATER_SHORT', skater.filter((s) => s.pipelineKey).map((s) => [s.pipelineKey, s.points]),
      'Skater weights keyed by the pipeline\'s per-game stat names.'),
    pyDict('LEGACY_BATCH_KEYS', stats.filter((s) => s.legacyBatchKey).map((s) => [s.legacyBatchKey, s.points]),
      'Flat legacy vocabulary used by nightly_projection_batch.fetch_scoring_settings.'),
    pyDict('OPT_IN', optIn.map((s) => [s.key, s.suggested]),
      'Opt-in stats (0 by default) → the weight a commissioner is offered on enabling one.'),
  ];

  const footer = `

def scoring_settings() -> dict:
    """Fresh, mutable {"skater": {...}, "goalie": {...}} in canonical keys.

    For callers that merge league overrides into the defaults or hand the
    structure to code that mutates it. The module-level dicts stay pristine.
    """
    return {"skater": dict(SKATER), "goalie": dict(GOALIE)}
`;

  return `${header}\n${blocks.join('\n\n')}\n${footer}`;
}

// ── Docs table ─────────────────────────────────────────────────────────

export function renderDocs(source) {
  const { provenance, stats } = source;
  const row = (s) => `| ${s.name} (${s.abbr}) | \`${s.key}\` | ${s.category} | ${cell(s.points)} | ${s.optIn ? 'yes' : ''} | ${s.optIn ? cell(s.suggested) : ''} |`;
  const skater = stats.filter((s) => s.group === 'skater').map(row).join('\n');
  const goalie = stats.filter((s) => s.group === 'goalie').map(row).join('\n');
  const deviations = provenance.deviations
    .map((d) => `- **${stats.find((s) => s.key === d.key)?.name ?? d.key}** — ${d.note}`)
    .join('\n');

  return `# Default Fantasy Scoring

<!-- GENERATED FILE — DO NOT EDIT. Source: ${SOURCE_REL}. Regenerate with \`npm run gen:scoring\`; CI fails when this table is stale. -->

${provenance.standard} ([source](${provenance.sourceUrl})), effective **${provenance.effectiveDate}**.

The numbers below are the only copy anyone should read or quote. Every code home derives from the same JSON: \`DEFAULT_SCORING\` in \`@citrus/shared\`, the CreateLeague and commissioner forms, the server-side creation fallback, Stormy's system prompt (spliced in at module load), and \`data-pipeline/scoring/scoring_defaults.py\` (generated).

## Skaters

| Stat | Key | Category | Default | Opt-in | Suggested when enabled |
|---|---|---|---|---|---|
${skater}

## Goalies

| Stat | Key | Category | Default | Opt-in | Suggested when enabled |
|---|---|---|---|---|---|
${goalie}

${provenance.optInRationale}

## Deviations from the standard

${deviations}

## What is NOT generated

The SQL homes still carry literals and ship as migrations: \`stat_catalog\`, the zero-UUID \`league_scoring_rules\` rows, the \`leagues.scoring_settings\` column default, and the projection-rebuild RPCs (see \`supabase/migrations/20260901150000_industry_standard_default_scoring.sql\`). A change to the JSON is not complete until the matching migration lands.
`;
}

// ── CLI ────────────────────────────────────────────────────────────────

export function renderAll(source = loadSource()) {
  return [
    { path: PYTHON_OUT, content: renderPython(source) },
    { path: DOCS_OUT, content: renderDocs(source) },
  ];
}

/** Returns the generated files that differ from what is on disk (empty when fresh). */
export function staleFiles(source = loadSource()) {
  return renderAll(source).filter(({ path, content }) => {
    if (!existsSync(path)) return true;
    return readFileSync(path, 'utf-8').replace(/\r\n/g, '\n') !== content;
  });
}

function main(argv) {
  const check = argv.includes('--check');
  const source = loadSource();
  if (check) {
    const stale = staleFiles(source);
    if (stale.length > 0) {
      console.error('Generated scoring defaults are STALE. Run `npm run gen:scoring` and commit:');
      for (const { path } of stale) console.error(`  - ${relative(REPO_ROOT, path)}`);
      process.exit(1);
    }
    console.log('Generated scoring defaults are fresh.');
    return;
  }
  for (const { path, content } of renderAll(source)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf-8');
    console.log(`wrote ${relative(REPO_ROOT, path)}`);
  }
}

// Only run the CLI when executed directly, so the guard test can import the
// renderers without side effects. Compared as realpaths: Node resolves the
// ESM entry through symlinks but leaves process.argv[1] as typed.
const samePath = (a, b) => {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
};
const invokedDirectly = Boolean(process.argv[1]) && samePath(fileURLToPath(import.meta.url), process.argv[1]);
if (invokedDirectly) main(process.argv.slice(2));
