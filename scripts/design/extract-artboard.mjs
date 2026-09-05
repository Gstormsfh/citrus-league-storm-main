#!/usr/bin/env node
/**
 * LIFT A DESIGN ARTBOARD'S REAL MARKUP.
 *
 * `design_handoff_pressbox_mobile/*.dc.html` are not pictures of a design.
 * They are rendered DOM with INLINE CSS on every node, so the spec is literal
 * and quotable:
 *
 *     display:grid;grid-template-columns:30px 30px 1fr 52px 44px;gap:8px;
 *     align-items:center;min-height:56px;
 *     border-top:1px solid rgba(255,255,255,.06)
 *
 * PR4 was first built from the handoff README's prose table instead — a
 * paraphrase of a picture — and it missed by enough to be rejected on sight.
 * Two of the misses were invisible without this: the chip's radius (the repo
 * remaps Tailwind's radius scale, so `rounded-md` is 14px here, not 6) and a
 * ring the artboard never draws. Paraphrase compounds; every screen after it
 * would have missed the same way.
 *
 *   node scripts/design/extract-artboard.mjs 1a --find Starters --to /tmp/roster.html
 *
 * `--find` climbs from the first text node matching that string to the nearest
 * ancestor that also contains `--anchor` (default: the same string), which is
 * how you get a whole screen rather than one label. Without `--find` the whole
 * artboard comes out.
 *
 * Two things that will waste an hour if you do not know them:
 *
 *   * The artboards live inside an `<x-dc>` custom element that stays
 *     `display:none` until `support.js` upgrades it, and that script pulls
 *     from a CDN this environment blocks. One injected stylesheet makes the
 *     content render anyway.
 *   * `#1a` is an INVALID CSS selector (an identifier cannot start with a
 *     digit). Use `[id="1a"]`.
 *
 * Needs playwright + a chromium. Not part of any build; a design tool.
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const board = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1]?.startsWith('--') !== true) ?? '1a';
const file = flag('file', 'design_handoff_pressbox_mobile/Citrus Redesign - Directions.dc.html');
const find = flag('find');
const anchor = flag('anchor', find);
const out = flag('to');
const shot = flag('shot');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1800, height: 1200 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(resolve(process.cwd(), file)).href, { waitUntil: 'domcontentloaded' });
// The custom element never upgrades offline; force its subtree visible.
await page.addStyleTag({ content: 'x-dc{display:block !important} x-dc *{visibility:visible !important}' });
await page.waitForTimeout(500);

const result = await page.evaluate(
  ({ board, find, anchor }) => {
    const root = document.querySelector(`[id="${board}"]`);
    if (!root) return { error: `no artboard [id="${board}"]` };
    let el = root;
    if (find) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = null;
      let n;
      while ((n = walker.nextNode())) {
        if ((n.nodeValue || '').includes(find)) { node = n; break; }
      }
      if (!node) return { error: `no text node containing "${find}" in ${board}` };
      el = node.parentElement;
      while (el && el !== root && !(el.textContent || '').includes(anchor)) el = el.parentElement;
      // one more step up: the match itself is usually the label, not the screen
      while (el && el.parentElement && el.parentElement !== root
             && el.parentElement.getBoundingClientRect().width <= 420) el = el.parentElement;
    }
    const b = el.getBoundingClientRect();
    return { w: Math.round(b.width), h: Math.round(b.height), html: el.outerHTML };
  },
  { board, find, anchor },
);

if (result.error) { console.error(result.error); await browser.close(); process.exit(1); }

// One tag per line: these files ship as a single line and are unreadable raw.
const pretty = result.html.replace(/></g, '>\n<');
if (out) { writeFileSync(out, pretty); console.error(`wrote ${out}`); } else { console.log(pretty); }
if (shot) {
  const el = await page.$(`[id="${board}"]`);
  await el.screenshot({ path: shot });
  console.error(`wrote ${shot}`);
}
console.error(`${board} ${find ? `(${find}) ` : ''}${result.w}x${result.h}, ${pretty.length} bytes`);
await browser.close();
