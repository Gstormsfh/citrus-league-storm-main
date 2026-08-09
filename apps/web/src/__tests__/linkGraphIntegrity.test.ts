// T11 architect Entry 11 (2026-08-09 02:20Z) — Link Graph Integrity.
//
// PURPOSE
//   Programmatic invariant: every internal navigation target in
//   apps/web/src resolves to a defined React Router route in App.tsx.
//   Any dead-link ships as a red test, not as a broken user click.
//
// SCOPE
//   Detects and validates the following navigation forms:
//     - <Link to="/static">              (react-router)
//     - <Link to={`/tmpl/${x}`}>         (react-router template literal)
//     - <Navigate to="/static">          (react-router redirect)
//     - navigate('/static')              (useNavigate)
//     - navigate(`/tmpl/${x}`)           (useNavigate template literal)
//     - window.location.href = '/x'      (imperative full-page nav)
//     - href="/static"                   (raw anchor to internal path)
//
// NORMALIZATION
//   Template literals ${...} → :param before matching. Query strings
//   (?foo=bar) and fragments (#anchor) are stripped from the target
//   before comparison. Route patterns (/x/:id) are compiled to regex
//   with `:name` and `:name?` accepted.
//
// EXCEPTIONS
//   Static HTML files served from public/ (e.g., /terms-of-service.html)
//   are NOT React Router routes but ARE valid internal URLs — allow-
//   listed. Similarly, external absolute URLs are ignored.
//
// FAILURE MESSAGE
//   Prints file:line + the offending target so `Ctrl+click` opens the
//   defect directly in the editor.
//
// ORPHAN ROUTES (informational — not a failure)
//   Routes defined in App.tsx that no internal navigation reaches.
//   These are legitimately reached via direct URL, external link, or
//   auth-provider callback. NOT a defect; classified per architect
//   Entry 11 as "orphan with intent." Reported as a warning + docketed
//   for the Sunday UX walk.
//
// DELIBERATE NON-GOALS (why this test doesn't cover them)
//   - Query-param + fragment CORRECTNESS: only structure/route
//     match is checked; ?tab=xyz semantics are not.
//   - Dynamic Link/navigate where the target is a variable (not a
//     literal string or template): e.g., `<Link to={pathVar}>` or
//     `navigate(computeUrl())`. These are TypeScript-typed as string;
//     no way to statically extract the path at this layer without
//     a full AST + data-flow analysis.
//   - Nav via imperative Router APIs from useNavigate options
//     (state, replace, etc.) — options are opaque here.
//
// KNOWN BLIND SPOT — MULTILINE <Link>…to={`…`}> FORMS  (Entry 21 S-5 →
// Entry 23 ratification, 2026-08-09; architect: "a guard that silently
// misses is INS-16's whole lesson"). The NAV_PATTERNS below use
// single-line regex without the `s` flag. A JSX element such as
//     <Link
//       to={`/league/${id}/playoffs`}
//     >
// is NOT matched by the `Link to={`…`}` pattern, and its target
// escapes the integrity check. Two live user-facing 404s (GMOffice.tsx
// :201 + :219 → nonexistent /playoffs/:id) shipped and stayed shipped
// through the entire T11b cycle because of this exact gap. The dead
// LINKS were fixed in S-5 (commit 3b82cdcd); the guard's SILENT MISS
// on that form is docketed for repair — either enable multiline
// matching on the two Link/Navigate template-literal patterns, or
// migrate the extractor to an AST walk. Until that fix lands, this
// comment IS the guard: any new <Link>\n  to={`…`}> form is
// invisible to CI and must be caught by review.
//
// See docs/REGISTRY.md KI-048 (channel protocol) for why this test
// exists as a CI invariant instead of a manual-audit habit.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const SRC_DIR = resolve(HERE, '..');
const APP_TSX = resolve(SRC_DIR, 'App.tsx');
const REPO_WEB = resolve(SRC_DIR, '..');

// ── Route extraction ─────────────────────────────────────────────────

/** Extract `<Route path="...">` patterns from App.tsx. */
function extractRoutes(): string[] {
  const source = readFileSync(APP_TSX, 'utf8');
  const routes: string[] = [];
  const re = /<Route\s+path="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    routes.push(m[1]);
  }
  return routes;
}

/**
 * Compile a route pattern to a regex.
 *   /matchup/:leagueId/:weekId?  → ^/matchup/[^/]+(?:/[^/]+)?$
 *   /league/:leagueId/playoffs   → ^/league/[^/]+/playoffs$
 *   /                            → ^/$
 *   *                            → matches anything (catch-all)
 */
function compileRoutePattern(pattern: string): RegExp {
  if (pattern === '*') return /^.*$/;
  const escaped = pattern.replace(/[.+^$()|[\]\\]/g, '\\$&');
  const compiled = escaped
    // /:name? optional segment: capture the whole /:xxx? group so
    // the trailing slash + segment is optional
    .replace(/\/:([a-zA-Z_][a-zA-Z0-9_]*)\?/g, '(?:/[^/]+)?')
    // /:name required segment
    .replace(/\/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '/[^/]+');
  return new RegExp(`^${compiled}$`);
}

// ── Nav extraction ───────────────────────────────────────────────────

interface NavRef {
  file: string;
  line: number;
  target: string;
}

const NAV_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'Link to="…"',        re: /<Link\s+[^>]*?\bto="(\/[^"]*)"/g },
  { label: 'Link to={`…`}',      re: /<Link\s+[^>]*?\bto=\{\s*`(\/[^`]*)`\s*\}/g },
  { label: 'Navigate to="…"',    re: /<Navigate\s+[^>]*?\bto="(\/[^"]*)"/g },
  { label: 'Navigate to={`…`}',  re: /<Navigate\s+[^>]*?\bto=\{\s*`(\/[^`]*)`\s*\}/g },
  { label: "navigate('…')",       re: /\bnavigate\(\s*['"](\/[^'"]*)/g },
  { label: 'navigate(`…`)',      re: /\bnavigate\(\s*`(\/[^`]*)`/g },
  { label: 'window.location.href = "…"', re: /\bwindow\.location\.href\s*=\s*['"`](\/[^'"`]*)/g },
  { label: 'href="/…"',           re: /\bhref="(\/[^"]*)"/g },
];

/**
 * Walk apps/web/src recursively and yield every .ts / .tsx file, minus
 * tests + __mocks__ + node_modules. Also skips App.tsx itself (it's
 * the route table, not a nav consumer).
 */
function walkSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__mocks__' || name === '__tests__') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      walkSourceFiles(p, acc);
    } else if (
      (name.endsWith('.ts') || name.endsWith('.tsx')) &&
      !name.endsWith('.test.ts') &&
      !name.endsWith('.test.tsx') &&
      !name.endsWith('.d.ts') &&
      p !== APP_TSX
    ) {
      acc.push(p);
    }
  }
  return acc;
}

function extractNavRefs(): NavRef[] {
  const files = walkSourceFiles(SRC_DIR);
  const refs: NavRef[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    // Precompute line-offsets to convert match index → line number.
    const lineStarts: number[] = [0];
    for (let i = 0; i < source.length; i++) {
      if (source[i] === '\n') lineStarts.push(i + 1);
    }
    const indexToLine = (idx: number): number => {
      let lo = 0, hi = lineStarts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lineStarts[mid] <= idx) lo = mid;
        else hi = mid - 1;
      }
      return lo + 1;
    };
    for (const { re } of NAV_PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(source)) !== null) {
        refs.push({
          file: relative(REPO_WEB, file).replace(/\\/g, '/'),
          line: indexToLine(m.index),
          target: m[1],
        });
      }
    }
  }
  return refs;
}

/** Strip query + fragment; normalize ${...} → :param. */
function normalizeNavTarget(t: string): string {
  return t
    .replace(/\$\{[^}]+\}/g, ':param')
    .replace(/\?.*$/, '')
    .replace(/#.*$/, '');
}

// ── Exceptions (non-router internal paths) ──────────────────────────

const STATIC_HTML_EXCEPTIONS = new Set([
  '/terms-of-service.html',
  '/privacy-policy.html',
]);

// ── Tests ────────────────────────────────────────────────────────────

describe('linkGraphIntegrity — App.tsx route table extraction', () => {
  it('extracts at least 40 routes (defense against regex breakage)', () => {
    const routes = extractRoutes();
    expect(routes.length).toBeGreaterThanOrEqual(40);
    expect(routes).toContain('/');
    expect(routes).toContain('/auth');
    expect(routes).toContain('/draft-v2/:leagueId/:draftId?');
    expect(routes).toContain('/league/:leagueId/playoffs');
  });
});

describe('linkGraphIntegrity — every internal nav resolves to a route', () => {
  const routes = extractRoutes();
  const compiledRoutes = routes.map((r) => ({ pattern: r, re: compileRoutePattern(r) }));
  const refs = extractNavRefs();

  it(`walked apps/web/src and found ≥60 navigation targets`, () => {
    // Defensive: if extraction breaks (e.g., a regex change misses
    // all matches), catch it explicitly rather than silently pass.
    expect(refs.length).toBeGreaterThanOrEqual(60);
  });

  it('EVERY internal nav target resolves to a defined route (or allow-listed static HTML)', () => {
    const failures: string[] = [];
    for (const ref of refs) {
      const normalized = normalizeNavTarget(ref.target);
      if (STATIC_HTML_EXCEPTIONS.has(normalized)) continue;
      const hit = compiledRoutes.some(({ re }) => re.test(normalized));
      if (!hit) {
        failures.push(`${ref.file}:${ref.line}  →  ${ref.target}  (normalized: ${normalized})`);
      }
    }
    if (failures.length > 0) {
      throw new Error(
        `Found ${failures.length} internal nav target(s) with no matching route in App.tsx:\n` +
          failures.map((f) => `  • ${f}`).join('\n') +
          `\n\nFix either the nav target OR add the missing route. See T11a in ` +
          `docs/TERMINAL_OUTBOX.md R23 for the audit that first ran this.`,
      );
    }
    expect(failures).toEqual([]);
  });
});

describe('linkGraphIntegrity — orphan routes (informational)', () => {
  const routes = extractRoutes();
  const compiledRoutes = routes.map((r) => ({ pattern: r, re: compileRoutePattern(r) }));
  const refs = extractNavRefs();
  const reachedTargets = new Set(refs.map((r) => normalizeNavTarget(r.target)));

  it('reports orphan routes (defined but not linked from internal nav) — informational only', () => {
    const orphans: string[] = [];
    for (const { pattern } of compiledRoutes) {
      if (pattern === '*') continue; // catch-all, always reachable
      // For parameterized routes, check if ANY reached target matches
      // the pattern. For static routes, just check equality.
      const re = compileRoutePattern(pattern);
      const reached = [...reachedTargets].some((t) => re.test(t));
      if (!reached) orphans.push(pattern);
    }
    // Log for auditor visibility. This test does not FAIL on orphans —
    // architect Entry 11 explicitly said "classify, don't delete." An
    // orphan is legit for /admin (direct URL), /waitlist (campaign
    // landing), /reset-password + /auth/callback (auth provider
    // returns to these), etc. Any orphan flagged here should be
    // reviewed on the Sunday UX walk.
    if (orphans.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `\n[linkGraphIntegrity] Orphan routes (${orphans.length}) — reachable only via direct URL or external callback:\n` +
          orphans.map((o) => `  • ${o}`).join('\n') +
          '\n(Not a test failure; classify each on the Sunday UX walk.)\n',
      );
    }
    // No expect — informational only.
  });
});
