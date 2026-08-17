#!/usr/bin/env node
/**
 * Fails the build if a Tailwind utility with an opacity modifier is referenced
 * in src/ but produces no rule in the compiled CSS.
 *
 * WHY THIS EXISTS
 * ---------------
 * Tailwind drops an unresolvable class silently — no warning, no error, no
 * CSS. The element just renders without the style. On 2026-08-14 a sweep found
 * 29 of these shipping to production:
 *
 *   bg-pastel-surface/98   the mobile bottom nav and the full-screen mobile
 *                          menu had NO background; page content scrolled
 *                          visibly through both. 98 is not on Tailwind's
 *                          opacity scale, so the class never existed.
 *   bg-white/5/20          a malformed double-slash class (15 of these) —
 *                          an opacity edit that appended instead of replacing.
 *   bg-primary/90          a CSS-variable colour declared without the
 *                          <alpha-value> placeholder, so no alpha channel
 *                          could be built.
 *   bg-current/5           `currentColor` cannot take an opacity modifier.
 *
 * None of it was visible in review or at runtime. This check makes it visible.
 *
 * USAGE:  node scripts/check-dead-classes.mjs        (run AFTER `vite build`)
 */
import fs from 'node:fs';
import path from 'node:path';

const WEB = path.resolve(import.meta.dirname, '..');
const DIST = path.join(WEB, 'dist', 'assets');
const SRC = path.join(WEB, 'src');

if (!fs.existsSync(DIST)) {
  console.error('check-dead-classes: dist/assets not found — run `vite build` first.');
  process.exit(2);
}
const cssFiles = fs.readdirSync(DIST).filter((f) => f.endsWith('.css'));
if (cssFiles.length === 0) {
  // An empty input would make every class look present. Refuse rather than pass.
  console.error('check-dead-classes: no CSS in dist/assets — refusing to report on an empty set.');
  process.exit(2);
}
const css = cssFiles.map((f) => fs.readFileSync(path.join(DIST, f), 'utf8')).join('');

const SPECIAL = '/.[]()%,#!:=';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const present = (tok) => {
  const body = [...tok].map((c) => (SPECIAL.includes(c) ? '\\\\' + esc(c) : esc(c))).join('');
  return new RegExp('\\.' + body + '(?=[\\s{,:>~+\\[\\)]|\\\\:)').test(css);
};

const PREFIXES = ['bg-', 'text-', 'border-', 'ring-', 'from-', 'to-', 'via-', 'shadow-', 'fill-',
  'stroke-', 'divide-', 'outline-', 'placeholder-', 'decoration-', 'accent-', 'caret-'];

const walk = (dir, acc = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(tsx?|jsx?)$/.test(e.name)) acc.push(p);
  }
  return acc;
};

const found = new Map();
for (const file of walk(SRC)) {
  const s = fs.readFileSync(file, 'utf8');
  for (const m of s.matchAll(/["'`]([^"'`\n]{2,600})["'`]/g)) {
    if (!m[1].includes('/')) continue;
    for (let t of m[1].split(/\s+/)) {
      t = t.trim().replace(/[,;]+$/, '');
      const core = t.split(':').pop().replace(/^!/, '');
      if (!core.includes('/') || core.endsWith('/')) continue;
      if (!PREFIXES.some((p) => core.startsWith(p))) continue;
      if (!found.has(t)) found.set(t, new Set());
      found.get(t).add(path.relative(WEB, file));
    }
  }
}

const dead = [...found.keys()].filter((t) => !present(t)).sort();
console.log(`check-dead-classes: ${found.size} opacity-modifier classes referenced, ${dead.length} dead.`);
if (dead.length) {
  console.error('\nThese classes are referenced in src/ but produce NO CSS:\n');
  for (const t of dead) console.error(`  ${t.padEnd(44)} ${[...found.get(t)].slice(0, 3).join(', ')}`);
  console.error(`
Common causes:
  - opacity value not on Tailwind's scale for a named colour  -> use /[0.08] bracket syntax
  - a double-slash typo such as bg-white/5/20                 -> keep one value
  - a CSS-variable colour missing the <alpha-value> placeholder in tailwind.config.ts
  - an opacity modifier on \`current\` (currentColor)            -> use color-mix() in a style prop
`);
  process.exit(1);
}
