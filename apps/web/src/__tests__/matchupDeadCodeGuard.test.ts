/**
 * MATCHUP DEAD-CODE GUARD (2026-09-01, Sleeper parity audit M11 + M12).
 *
 * Two components sat in `components/matchup/` that no page rendered:
 * `TeamCard` (a 640-line table view of one side of a matchup, replaced by
 * the comparison rows long ago, still imported by Matchup.tsx and never
 * used) and `DailyRosters` (a 7×2 serial fetch loop that the parallelism
 * test already had to fence off). Both are deleted, along with the 130
 * lines of `.matchup-team-card` table CSS that only TeamCard wore.
 *
 * The generic rule this pins so the directory cannot silt up again: every
 * component module in `components/matchup/` is imported by at least one
 * non-test module. The two specific names stay listed so a revert that
 * brings a file back without an importer fails with a message that says
 * which audit item it undoes.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const SRC = resolve(HERE, '..');
const WEB = resolve(SRC, '..');
const MATCHUP = resolve(SRC, 'components', 'matchup');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Every non-test module that can import a component: src/ and the render harness. */
const MODULES = [...walk(SRC), ...(existsSync(resolve(WEB, 'harness')) ? walk(resolve(WEB, 'harness')) : [])]
  .map((f) => f.replace(/\\/g, '/'))
  .filter((f) => !f.includes('__tests__') && !/\.test\.tsx?$/.test(f));

const importsOf = (name: string) =>
  MODULES.filter((f) => {
    if (basename(f) === `${name}.tsx`) return false;
    const src = readFileSync(f, 'utf8');
    return new RegExp(`from\\s+['"](?:@/components/matchup/${name}|\\./${name}|\\.\\./${name})['"]`).test(src);
  });

describe('components/matchup carries no unreferenced component', () => {
  it.each(['TeamCard', 'DailyRosters'])('%s stays deleted (audit M12)', (name) => {
    expect(existsSync(resolve(MATCHUP, `${name}.tsx`)), `${name}.tsx is back`).toBe(false);
    expect(importsOf(name), `${name} is imported again`).toEqual([]);
  });

  it('every remaining component module is imported by a non-test module', () => {
    const components = readdirSync(MATCHUP).filter((f) => f.endsWith('.tsx'));
    expect(components.length).toBeGreaterThan(10);
    const orphans = components.map((f) => basename(f, '.tsx')).filter((name) => importsOf(name).length === 0);
    expect(orphans, `unreferenced matchup components:\n${orphans.join('\n')}`).toEqual([]);
  });

  it('Matchup.tsx no longer imports TeamCard', () => {
    const page = readFileSync(resolve(SRC, 'pages', 'Matchup.tsx'), 'utf8');
    expect(page).not.toMatch(/components\/matchup\/TeamCard/);
  });
});

describe('index.css carries no stylesheet for the deleted table view', () => {
  const css = readFileSync(resolve(SRC, 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('the .matchup-team-card rules are gone with the component that wore them', () => {
    expect(css).not.toMatch(/\.matchup-team-card\b/);
    expect(css).not.toMatch(/\.player-name-cell\b/);
    expect(css).not.toMatch(/\.(user-team|opponent-team|team)-container\b/);
  });

  it('the wrapper rules the live page still uses are untouched', () => {
    expect(css).toMatch(/\.matchup-wrapper\s*\{/);
    expect(css).toMatch(/\.matchup-grid\s*\{/);
  });
});
