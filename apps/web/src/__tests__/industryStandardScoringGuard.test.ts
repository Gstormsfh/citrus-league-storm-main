/**
 * INDUSTRY-STANDARD SCORING (2026-09-01) — the single-source guard.
 *
 * Default scoring used to live in ~20 hand-synced homes, and the first
 * version of this suite pinned each of them by grepping source files for
 * `goals: 6`. That proved the copies agreed on the day it was written, not
 * that there was one source — the next change was still 20 edits.
 *
 * Now there is ONE source, `packages/shared/src/constants/scoringDefaults.json`
 * (typed as `SCORING_DEFAULTS` in `@citrus/shared`). Every TypeScript home
 * derives from it, and `scripts/gen-scoring-defaults.mjs` generates the
 * Python module and the docs table. This suite proves three things:
 *
 *   (a) the source still carries the expected values — the one literal pin
 *       left in the codebase, so a change to the JSON is a deliberate,
 *       reviewed edit here too;
 *   (b) every consumer derives from the source — a repo-wide scan fails on
 *       any file that restates the default set, with a short allowlist of
 *       files whose literals are intentional;
 *   (c) the generated files are fresh — the generator runs in `--check`
 *       mode against the committed output.
 *
 * If (a) fails after an intentional change: update EXPECTED, run
 * `npm run gen:scoring`, ship the DB migration (the SQL homes still carry
 * literals), and you are done. If (b) fails: delete the literal and import
 * the constant — do not extend the allowlist without a reason in the table.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SCORING as SHARED_DEFAULTS,
  SCORING_DEFAULTS,
  defaultLeagueStats,
  describeScoringDefaults,
  getDefaultSettings as sharedGetDefaultSettings,
} from '@citrus/shared';
import { DEFAULT_SCORING as WEB_DEFAULTS } from '@/utils/scoringUtils';
import { getDefaultSettings as webGetDefaultSettings } from '@/types/leagueTypes';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '../../../..');
const repo = (p: string) => readFileSync(resolve(REPO_ROOT, p), 'utf-8');

// ── (a) the pin ──────────────────────────────────────────────────────
// G6 A4 PPP2 SOG0.9 BLK1 / W5 SO5 SV0.6 GA-3; SHP/HIT/PIM/+/- opt-in at 0.
const EXPECTED = {
  skater: {
    goals: 6,
    assists: 4,
    power_play_points: 2,
    short_handed_points: 0,
    shots_on_goal: 0.9,
    blocks: 1,
    hits: 0,
    penalty_minutes: 0,
    plus_minus: 0,
  },
  goalie: {
    wins: 5,
    shutouts: 5,
    saves: 0.6,
    goals_against: -3,
  },
};

// The weight a commissioner is offered on toggling an opt-in stat on.
const EXPECTED_OPT_IN = {
  short_handed_points: 2,
  hits: 0.5,
  penalty_minutes: 0.5,
  plus_minus: 2,
};

describe('(a) the source carries the industry-standard defaults', () => {
  it('SCORING_DEFAULTS and the derived DEFAULT_SCORING equal the expected set', () => {
    expect(SCORING_DEFAULTS.skater).toEqual(EXPECTED.skater);
    expect(SCORING_DEFAULTS.goalie).toEqual(EXPECTED.goalie);
    expect(SHARED_DEFAULTS).toEqual(EXPECTED);
    expect(SCORING_DEFAULTS.optIn).toEqual(EXPECTED_OPT_IN);
  });

  it('provenance: Yahoo-aligned, effective 2026-09-01, +/- deviation documented', () => {
    expect(SCORING_DEFAULTS.provenance.sourceUrl).toBe('https://help.yahoo.com/kb/SLN6815');
    expect(SCORING_DEFAULTS.provenance.effectiveDate).toBe('2026-09-01');
    const plusMinus = SCORING_DEFAULTS.provenance.deviations.find((d) => d.key === 'plus_minus');
    expect(plusMinus?.note).toMatch(/cannot model plus\/minus/);
  });

  it('opt-in stats ship at 0 and every stat is exactly one of enabled / opt-in', () => {
    for (const stat of SCORING_DEFAULTS.stats) {
      if (stat.optIn) {
        expect(stat.points, `${stat.key} is opt-in and must ship at 0`).toBe(0);
        expect(stat.suggested, `${stat.key} needs a suggested weight`).toBeTypeOf('number');
      } else {
        expect(stat.suggested, `${stat.key} is not opt-in`).toBeNull();
      }
    }
    const keys = SCORING_DEFAULTS.stats.map((s) => s.key).sort();
    expect(keys).toEqual([...Object.keys(EXPECTED.skater), ...Object.keys(EXPECTED.goalie)].sort());
  });

  it('the prompt-ready description reads the source, not prose', () => {
    expect(describeScoringDefaults()).toBe(
      '**Skaters:** G 6 | A 4 | PPP 2 | SOG 0.9 | BLK 1 (SHP/HIT/PIM/+/- are opt-in, 0 by default)\n' +
      '**Goalies:** W 5 | SO 5 | SV 0.6 | GA −3',
    );
  });
});

// ── (b) every consumer derives ───────────────────────────────────────

describe('(b) every consumer derives from the source', () => {
  it('the web mirror re-exports the shared constant (same object, no copy)', () => {
    expect(WEB_DEFAULTS).toBe(SHARED_DEFAULTS);
  });

  it('league-settings stat rows derive: enabled stats carry the weight, opt-ins ship disabled with the suggestion', () => {
    const rows = defaultLeagueStats();
    expect(rows).toHaveLength(SCORING_DEFAULTS.stats.length);
    for (const stat of SCORING_DEFAULTS.stats) {
      const row = rows.find((r) => r.id === stat.id);
      expect(row, `row for ${stat.key}`).toBeDefined();
      expect(row).toEqual({
        id: stat.id,
        name: stat.name,
        points: stat.optIn ? EXPECTED_OPT_IN[stat.key as keyof typeof EXPECTED_OPT_IN] : stat.points,
        default: !stat.optIn,
        category: stat.category,
        enabled: !stat.optIn,
      });
    }
    // Both league-type modules (shared canonical, web legacy) hand out the same rows.
    expect(sharedGetDefaultSettings('fantasy').stats).toEqual(rows);
    expect(webGetDefaultSettings('fantasy').stats).toEqual(rows);
    // Fresh objects per call — the CreateLeague form mutates its rows.
    expect(defaultLeagueStats()[0]).not.toBe(rows[0]);
  });

  // Each home must reference the source symbol it derives from. This is the
  // positive half; the literal scan below is the negative half.
  const DERIVING_HOMES: Array<[string, string]> = [
    ['packages/shared/src/utils/scoring.ts', 'SCORING_DEFAULTS.skater'],
    ['packages/shared/src/types/league.ts', 'defaultLeagueStats()'],
    ['apps/web/src/types/leagueTypes.ts', 'defaultLeagueStats()'],
    ['apps/web/src/pages/CreateLeague.tsx', 'defaultLeagueStats()'],
    ['apps/web/src/pages/Profile.tsx', 'SCORING_DEFAULTS.stats'],
    ['apps/web/src/utils/scoringUtils.ts', "DEFAULT_SCORING as SHARED_DEFAULT_SCORING } from '@citrus/shared'"],
    ['server/src/services/LeagueService.ts', 'DEFAULT_SCORING.skater'],
    ['server/src/lib/stormy/systemPrompt.ts', '${describeScoringDefaults()}'],
    ['data-pipeline/scoring/simulate_matchups.py', 'from data_pipeline.scoring.scoring_defaults import'],
    ['data-pipeline/scoring/calculate_matchup_scores.py', 'scoring_defaults.scoring_settings()'],
    ['data-pipeline/projections/run_daily_projections.py', 'scoring_defaults.scoring_settings()'],
    ['data-pipeline/projections/calculate_daily_projections.py', 'scoring_defaults.SKATER["goals"]'],
    ['data-pipeline/projections/projection_uncertainty.py', 'DEFAULT_SCORING_WEIGHTS = SKATER_SHORT'],
    ['data-pipeline/projections/nightly_projection_batch.py', 'scoring_defaults.LEGACY_BATCH_KEYS'],
    ['data-pipeline/projections/quantify_uncertainty_impact.py', 'DEFAULT_SCORING_WEIGHTS[s]'],
    ['data-pipeline/monitoring/baseline_competitor_audit.py', 'SCORING = SKATER_SHORT'],
    ['data-pipeline/monitoring/matchup_winprob_audit.py', 'SKATER_SHORT["goals"]'],
    ['scripts/utilities/backtest_vopa_model.py', 'scoring_defaults.scoring_settings()'],
  ];

  it.each(DERIVING_HOMES)('%s derives (%s)', (path, token) => {
    expect(repo(path)).toContain(token);
  });

  it('no file outside the allowlist restates the default set', () => {
    const offenders = scanForRestatedDefaults();
    const report = offenders
      .map((o) => `  ${o.path}\n${o.hits.map((h) => `      ${h.stat} @ line ${h.line}: ${h.text}`).join('\n')}`)
      .join('\n');
    expect(
      offenders,
      `These files restate the default scoring set. Import SCORING_DEFAULTS / DEFAULT_SCORING (TS) or ` +
        `data_pipeline.scoring.scoring_defaults (Python) instead, or add an allowlist entry WITH a reason:\n${report}`,
    ).toEqual([]);
  });
});

// ── (c) generated files are fresh ────────────────────────────────────

describe('(c) the generated copies are fresh', () => {
  it('scripts/gen-scoring-defaults.mjs --check passes against the committed files', () => {
    const result = spawnSync(process.execPath, ['scripts/gen-scoring-defaults.mjs', '--check'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it('the generated Python module carries the expected weights', () => {
    const py = repo('data-pipeline/scoring/scoring_defaults.py');
    for (const [key, value] of Object.entries(EXPECTED.skater)) {
      expect(py).toContain(`"${key}": ${Number.isInteger(value) ? `${value}.0` : value},`);
    }
    for (const [key, value] of Object.entries(EXPECTED.goalie)) {
      expect(py).toContain(`"${key}": ${Number.isInteger(value) ? `${value}.0` : value},`);
    }
    expect(py).toContain('"blocked_shots": 1.0,'); // nightly batch's legacy vocabulary
    expect(py).toContain('"sog": 0.9,');           // the pipeline's short vocabulary
  });
});

// ── regression pins that ride along (not scoring homes) ──────────────

describe('regression pins from the 2026-09-01 scoring review', () => {
  it('every ROS consumer that rescores goalies feeds goals-against', () => {
    // The draft board hard-coded goals_against: 0 while rescoring ROS rows
    // under league settings — under a negative GA weight that overstated a
    // 55-start goalie by hundreds of points. The route must serve the column
    // and the board must use it.
    expect(repo('server/src/routes/players.ts')).toContain('projected_shutouts_ros, projected_ga_ros');
    expect(repo('apps/web/src/pages/DraftRoom.tsx')).toContain('goals_against: p.projected_ga_ros || 0');
    expect(repo('server/src/services/TeamAnalyticsService.ts')).toContain('num(p.projected_ga_ros)');
  });

  it('the stale-cache fuse stays blown: CACHE_VERSION never drops below the post-scoring-change era', () => {
    const proj = repo('data-pipeline/projections/calculate_daily_projections.py');
    const m = proj.match(/^CACHE_VERSION = "(\d+(?:\.\d+)?)"/m);
    expect(m, 'CACHE_VERSION literal missing').not.toBeNull();
    expect(parseFloat(m![1])).toBeGreaterThanOrEqual(4.0);
  });
});

// ── the scan ─────────────────────────────────────────────────────────
//
// A file is an offender when it carries the default weight of at least
// THRESHOLD distinct stats, each written as `<stat> <sep> <value>` — the
// shape of an object literal, a Python dict, a `.get("stat", 6)` fallback,
// or prose like "Goals 6" — and at least one of them is a DISTINCTIVE weight
// (non-integer or negative: SOG 0.9, SV 0.6, GA −3 today). Single hits are
// ignored on purpose: a test fixture with a 6-goal line is not a restated
// default set; and a custom-scoring fixture that happens to share a few
// small integers with the defaults (PPP 2, BLK 1, W 5) is not one either —
// every real copy of the skater or goalie set carries a distinctive weight.
// Zero-weighted stats are ignored too (`hits: 0` is everywhere and means
// nothing). Should every default ever be a non-negative integer, the
// distinctive rule switches itself off and the threshold alone decides.
//
// The signature is built from the source, so the scan follows the defaults
// when they move: after a change there are no copies to go stale, and any
// new copy of the *current* set is caught.

const THRESHOLD = 3;
const isDistinctive = (points: number) => !Number.isInteger(points) || points < 0;

const SCAN_ROOTS = [
  'apps/web/src',
  'server/src',
  'packages/shared/src',
  'data-pipeline',
  'scripts',
  'supabase/functions',
  'docs',
  'CLAUDE.md',
  'ENGINEERING.md',
];
const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.py', '.md']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '__pycache__']);

/** Files whose literals are intentional. Every entry needs a reason. */
const ALLOWLIST: Record<string, string> = {
  'packages/shared/src/constants/scoringDefaults.json': 'THE source',
  'data-pipeline/scoring/scoring_defaults.py': 'generated from the source (freshness checked in (c))',
  'docs/generated/SCORING_DEFAULTS.md': 'generated from the source (freshness checked in (c))',
  'apps/web/src/__tests__/industryStandardScoringGuard.test.ts': 'the EXPECTED pin in (a)',
  'apps/web/src/utils/__tests__/scoringDefaults.equivalence.test.ts':
    'pins the leagues.scoring_settings column default verbatim from the migration — a DB-parity oracle, deliberately independent of the constant',
  'data-pipeline/tests/test_projection_logic.py':
    'unit-tests calculate_fantasy_points arithmetic against hand-computed totals — an independent oracle, deliberately literal',
  'supabase/functions/_shared/_vendored/scoring.ts':
    'vendored Deno copy still imported by supabase/functions/draft-autopick; deleted with the Edge Function in chunk 11g.9 (KI-009)',
  'apps/web/src/utils/winProbability.ts':
    'DEFAULT_GAME_SD is a hand-derived calibration constant; its comment records the weights the derivation used so it can be re-checked when the defaults move',
};

interface Hit { stat: string; line: number; text: string }
interface Offender { path: string; hits: Hit[] }

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function valuePattern(points: number): string {
  const abs = Math.abs(points);
  const core = Number.isInteger(abs) ? `${abs}(?:\\.0+)?` : `${escapeRegex(String(abs))}0*`;
  return points < 0 ? `[-−]\\s*${core}` : core;
}

/** One regex per non-zero default stat: any alias, a separator, the default value. */
function buildSignature(): Array<{ stat: string; distinctive: boolean; re: RegExp }> {
  return SCORING_DEFAULTS.stats
    .filter((s) => s.points !== 0)
    .map((s) => {
      const aliases = [...new Set([s.key, s.id, s.abbr, s.name, s.pipelineKey, s.legacyBatchKey].filter(Boolean) as string[])]
        .sort((a, b) => b.length - a.length)
        .map(escapeRegex)
        .join('|');
      const re = new RegExp(
        `(?<![A-Za-z0-9_])(?:${aliases})(?![A-Za-z0-9_])["']?\\s*[:=,]?\\s*["']?\\s*${valuePattern(s.points)}(?![0-9.])`,
      );
      return { stat: s.key, distinctive: isDistinctive(s.points), re };
    });
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (st.isFile()) yield full;
  }
}

function scanForRestatedDefaults(): Offender[] {
  const signature = buildSignature();
  const anyDistinctive = signature.some((s) => s.distinctive);
  const offenders: Offender[] = [];
  for (const root of SCAN_ROOTS) {
    const full = resolve(REPO_ROOT, root);
    const files = statSync(full).isDirectory() ? [...walk(full)] : [full];
    for (const file of files) {
      const rel = relative(REPO_ROOT, file).split(sep).join('/');
      const ext = rel.slice(rel.lastIndexOf('.'));
      if (!SCAN_EXTENSIONS.has(ext) || rel in ALLOWLIST) continue;
      const lines = readFileSync(file, 'utf-8').split('\n');
      const hits: Hit[] = [];
      let distinctiveHit = false;
      for (const { stat, distinctive, re } of signature) {
        const idx = lines.findIndex((l) => re.test(l));
        if (idx === -1) continue;
        hits.push({ stat, line: idx + 1, text: lines[idx].trim().slice(0, 100) });
        if (distinctive) distinctiveHit = true;
      }
      if (hits.length >= THRESHOLD && (distinctiveHit || !anyDistinctive)) offenders.push({ path: rel, hits });
    }
  }
  return offenders;
}
