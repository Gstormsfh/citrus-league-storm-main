/**
 * DUPLICATE JOB KEY GUARD (2026-09-03).
 *
 * On 2026-09-02, `.github/workflows/ci.yml` defined `test-scripts` and
 * `test-shared` TWICE. GitHub refused the file outright:
 *
 *     Invalid workflow file: .github/workflows/ci.yml#L1
 *     (Line: 679, Col: 3): 'test-scripts' is already defined,
 *     (Line: 698, Col: 3): 'test-shared' is already defined
 *
 * WHAT THAT ACTUALLY COST
 *
 * An invalid workflow does not fail a job. It fails to LOAD, so ZERO jobs run.
 * The run appears in the Actions list with a red X, a blank duration and no
 * job graph. Lint, both typechecks, both builds, all five test suites, the
 * migration validator and the security audit did not execute.
 *
 * It went in with #395 and stayed broken for EIGHT consecutive commits on
 * master. Everything from `ff177c6` to `04782c5` merged with no CI whatsoever
 * while the Actions tab showed a wall of red that read as "flaky CI" rather
 * than "CI is switched off". The production deploy workflow is a separate file
 * and kept passing, which made it look like only some checks were unhappy.
 *
 * WHY NOTHING CAUGHT IT
 *
 * A duplicate mapping key is not a parse error to most YAML readers. The spec
 * says keys must be unique, but `yaml.safe_load` and js-yaml's default both
 * silently keep the LAST occurrence. So the file "parses fine" everywhere
 * except the one parser that matters. Only GitHub's own loader rejects it, and
 * only after a push, which on this repo means after a merge to master.
 *
 * The sibling guard `actionManifests.test.ts` scans composite action manifests
 * for unresolvable contexts and would not look at this: the file was valid in
 * every way it checks.
 *
 * WHY A LINE SCAN AND NOT A YAML PARSE
 *
 * Two reasons, and the first is decisive. A YAML parser is the wrong tool here
 * because the default behaviour of every available parser is to SWALLOW the
 * exact defect this test exists to find. Catching it needs a custom
 * duplicate-rejecting constructor, at which point the parser is doing less work
 * than the scan below.
 *
 * Second, `deployConfig.test.ts` already set the house rule for this repo:
 * "Parsing the YAML would need a dependency CLAUDE.md forbids adding for one
 * test." `yaml` and `js-yaml` are present transitively today and could vanish
 * on any `npm ci`. A guard that can disappear with a dependency bump is not a
 * guard.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const REPO = resolve(HERE, '../../..');
const WORKFLOWS = resolve(REPO, '.github/workflows');

interface Duplicate {
  key: string;
  lines: number[];
}

/**
 * Job keys declared under the top-level `jobs:` mapping, with the lines they
 * appear on.
 *
 * Scoped to the `jobs:` block on purpose. `on:` also carries two-space keys
 * (`push`, `pull_request`), and a workflow may legitimately repeat a name like
 * `test` as a STEP name deeper in the file. Only the job mapping has the
 * uniqueness requirement GitHub enforces.
 */
function duplicateJobKeys(src: string): Duplicate[] {
  const lines = src.split('\n');
  const seen = new Map<string, number[]>();

  let inJobs = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue;

    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    // Any other column-0 key ends the jobs block.
    if (inJobs && /^[A-Za-z_]/.test(line)) break;
    if (!inJobs) continue;

    const m = line.match(/^ {2}([A-Za-z_][A-Za-z0-9_-]*):\s*$/);
    if (!m) continue;
    const key = m[1];
    seen.set(key, [...(seen.get(key) ?? []), i + 1]);
  }

  return [...seen.entries()]
    .filter(([, at]) => at.length > 1)
    .map(([key, at]) => ({ key, lines: at }));
}

function workflowFiles(): string[] {
  if (!existsSync(WORKFLOWS)) return [];
  return readdirSync(WORKFLOWS)
    .filter((n) => n.endsWith('.yml') || n.endsWith('.yaml'))
    .map((n) => join(WORKFLOWS, n));
}

const FILES = workflowFiles();

describe('every workflow declares each job exactly once', () => {
  it('there are workflows to check', () => {
    // A path typo would make every assertion below vacuously pass.
    expect(FILES.length).toBeGreaterThan(0);
  });

  for (const path of FILES) {
    const rel = path.replace(`${REPO}/`, '');

    it(`${rel} has no duplicate job key`, () => {
      const dupes = duplicateJobKeys(readFileSync(path, 'utf8'));

      expect(
        dupes,
        `${rel} defines the same job more than once. GitHub rejects the whole ` +
          `file with "is already defined", so NO job runs at all — the run shows ` +
          `a red X with a blank duration and no job graph, and every check in ` +
          `this file is silently skipped. ci.yml sat like that for eight commits ` +
          `on master. Found: ` +
          dupes.map((d) => `'${d.key}' on lines ${d.lines.join(' and ')}`).join('; '),
      ).toEqual([]);
    });
  }
});

describe('the guard bites', () => {
  // Pinning the detector, not the repo's current state. A scan only ever
  // exercised by files that already pass it proves nothing.
  const wf = (...body: string[]) => ['name: X', 'on:', '  push:', 'jobs:', ...body].join('\n');

  it('catches the exact pair that broke ci.yml', () => {
    const dupes = duplicateJobKeys(
      wf(
        '  test-scripts:',
        '    runs-on: ubuntu-latest',
        '  test-shared:',
        '    runs-on: ubuntu-latest',
        '  scoring-defaults:',
        '    runs-on: ubuntu-latest',
        '  test-scripts:',
        '    runs-on: ubuntu-latest',
        '  test-shared:',
        '    runs-on: ubuntu-latest',
      ),
    );
    expect(dupes.map((d) => d.key).sort()).toEqual(['test-scripts', 'test-shared'].sort());
  });

  it('accepts a file where every job is distinct', () => {
    expect(
      duplicateJobKeys(
        wf('  lint:', '    runs-on: ubuntu-latest', '  test:', '    runs-on: ubuntu-latest'),
      ),
    ).toEqual([]);
  });

  it('does not confuse `on:` keys with job keys', () => {
    // `push` appears under `on:` at the same indentation a job would use.
    // Scanning the whole file instead of the jobs block would flag it the
    // moment any workflow also had a job called `push`.
    const src = [
      'name: X',
      'on:',
      '  push:',
      '    branches: [master]',
      '  pull_request:',
      "    branches: ['**']",
      'jobs:',
      '  push:',
      '    runs-on: ubuntu-latest',
    ].join('\n');
    expect(duplicateJobKeys(src)).toEqual([]);
  });

  it('stops at the next top-level key', () => {
    // Anything after the jobs mapping is not a job, whatever its indentation.
    const src = [
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      'permissions:',
      '  build:',
      '    read',
    ].join('\n');
    expect(duplicateJobKeys(src)).toEqual([]);
  });

  it('ignores a repeated STEP name, which is legal', () => {
    // Two jobs may both have a step called "Report run". Only the job mapping
    // has to be unique.
    const src = wf(
      '  a:',
      '    steps:',
      '      - name: Report run',
      '  b:',
      '    steps:',
      '      - name: Report run',
    );
    expect(duplicateJobKeys(src)).toEqual([]);
  });

  it('ignores a duplicate that only appears in a comment', () => {
    const src = wf('  lint:', '    runs-on: ubuntu-latest', '  # lint:', '  test:');
    expect(duplicateJobKeys(src)).toEqual([]);
  });
});
