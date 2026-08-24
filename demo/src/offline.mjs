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
await p.goto('file:///home/claude/leafs/Toronto_GameDay_Citrus.html', { waitUntil:'load' });
await p.waitForTimeout(1200);
await p.click('.lkrow:nth-child(1)'); await p.waitForTimeout(300);
await p.evaluate(() => go('grid')); await p.waitForTimeout(400);
await p.evaluate(() => go('stormy')); await p.waitForTimeout(400);
const fonts = await p.evaluate(() => [...document.fonts].map(f => f.family + ' ' + f.status));
console.log('external requests:', reqs.length ? reqs : 'NONE');
console.log('fonts:', fonts.join(' | ') || 'none registered');
console.log('page errors:', errs.length ? errs : 'none');
await b.close();
