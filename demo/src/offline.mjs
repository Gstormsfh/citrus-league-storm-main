/* This file used to point at an absolute path on the machine it was
   written on, which meant not one of these ran anywhere else. ROOT is
   worked out from the file's own location instead: the build sits beside
   these sources in the working copy and one level up in the repo, so both
   are tried. BUILD_URL is a proper file:// URL, because "file://" plus a
   Windows path is not one. */
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
const HERE  = dirname(fileURLToPath(import.meta.url));
const ROOT  = existsSync(join(HERE, 'Toronto_GameDay_Citrus.html')) ? HERE : join(HERE, '..');
const BUILD = join(ROOT, 'Toronto_GameDay_Citrus.html');
const BUILD_URL = pathToFileURL(BUILD).href;
import { chromium } from 'playwright';
const b = await chromium.launch({ args:['--no-sandbox'] });
const ctx = await b.newContext();
const reqs = [];
await ctx.route('**', route => {
  const u = route.request().url();
  if (!u.startsWith('file://')) { reqs.push(u); return route.abort(); }
  return route.continue();
});
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto(BUILD_URL, { waitUntil:'load' });
await p.waitForTimeout(1200);
await p.click('.lkrow:nth-child(1)'); await p.waitForTimeout(300);
await p.evaluate(() => go('grid')); await p.waitForTimeout(400);
await p.evaluate(() => go('stormy')); await p.waitForTimeout(400);
const fonts = await p.evaluate(() => [...document.fonts].map(f => f.family + ' ' + f.status));
console.log('external requests:', reqs.length ? reqs : 'NONE');
console.log('fonts:', fonts.join(' | ') || 'none registered');
console.log('page errors:', errs.length ? errs : 'none');
await b.close();
