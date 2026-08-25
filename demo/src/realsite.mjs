/* Serves the build over real HTTP and drives it like a live site:
   desktop and phone, every panel, every game, watching the network. */
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
import http from 'http';
import { readFileSync, statSync } from 'fs';
import { chromium, devices } from 'playwright';


const PORT = 4399;
const hits = [];
const srv = http.createServer((q, s) => {
  const p = q.url === '/' ? '/Toronto_GameDay_Citrus.html' : q.url.split('?')[0];
  hits.push(p);
  try {
    const b = readFileSync(ROOT + p);
    s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript'
      : p.endsWith('.json') ? 'application/json' : 'text/html; charset=utf-8',
      'Cache-Control': 'no-store' });
    s.end(b);
  } catch { s.writeHead(404); s.end('not found'); }
});
await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${PORT}/Toronto_GameDay_Citrus.html`;
const size = statSync(ROOT + '/Toronto_GameDay_Citrus.html').size;
console.log(`serving ${(size/1048576).toFixed(2)} MB at ${URL_}\n`);

const PANELS = ['home','ult','stormy','hl','guess','luck','rank','fx','bz','grid','call','dash','lb'];
let fails = 0;
const bad = m => { fails++; console.log('   FAIL ' + m); };

async function run(label, ctxOpts){
  const browser = await chromium.launch();
  const ctx = await browser.newContext(ctxOpts);
  const p = await ctx.newPage();
  const errs = [], reqs = [], failedReq = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  p.on('request', r => reqs.push(r.url()));
  p.on('requestfailed', r => failedReq.push(r.url() + ' :: ' + (r.failure()||{}).errorText));
  p.on('response', r => { if (r.status() >= 400) failedReq.push(r.status() + ' ' + r.url()); });

  const t0 = Date.now();
  const resp = await p.goto(URL_, { waitUntil: 'load' });
  const loadMs = Date.now() - t0;
  console.log(`── ${label} ──  HTTP ${resp.status()}  loaded in ${loadMs} ms`);
  await p.waitForTimeout(900);

  if (resp.status() !== 200) bad('status ' + resp.status());
  const offsite = reqs.filter(u => !u.startsWith(`http://127.0.0.1:${PORT}`) && !u.startsWith('data:') && !u.startsWith('blob:'));
  if (offsite.length) bad('offsite requests: ' + offsite.slice(0,3).join(', '));
  else console.log('   network: ' + reqs.length + ' request(s), all same-origin, 0 offsite');
  if (failedReq.length) bad('failed requests: ' + failedReq.slice(0,3).join(' | '));

  // every panel reachable, painted, and no horizontal overflow
  for (const t of PANELS){
    await p.evaluate(x => go(x), t);
    await p.waitForTimeout(230);
    const r = await p.evaluate(t => {
      const el = document.querySelector('#p-' + t);
      if (!el) return { missing: true };
      const vis = el.classList.contains('on') && el.getBoundingClientRect().height > 120;
      const txt = (el.innerText || '').trim().length;
      return { vis, txt, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
    }, t);
    if (r.missing) { bad(t + ': panel missing'); continue; }
    if (!r.vis)    bad(t + ': did not render');
    if (r.txt < 60) bad(t + ': almost no content (' + r.txt + ' chars)');
    if (r.sw > r.cw + 1) bad(t + ': horizontal overflow ' + r.sw + ' > ' + r.cw);
  }
  console.log('   panels: ' + PANELS.length + ' checked');

  // the clock, which everything live hangs off
  await p.evaluate(() => { CLOCK.reset(); CLOCK.set(60); CLOCK.start(); });
  await p.waitForTimeout(1400);
  const ticking = await p.evaluate(() => CLOCK.t > 0);
  if (!ticking) bad('clock did not advance');
  await p.evaluate(() => CLOCK.seek(3600));
  await p.waitForTimeout(400);
  const fin = await p.evaluate(() => ({ s: CLOCK.score(), over: CLOCK.over,
    bug: document.querySelector('#bugClock').textContent }));
  if (fin.s[0] !== 6 || fin.s[1] !== 4) bad('final score wrong: ' + JSON.stringify(fin.s));
  if (!fin.over || fin.bug !== 'Final') bad('clock did not finish: ' + JSON.stringify(fin));
  console.log('   clock: ran to Final, Toronto ' + fin.s[0] + ' Anaheim ' + fin.s[1]);

  // the live games settle
  await p.evaluate(() => { CLOCK.reset(); go('hl');
    H2H.forEach((m,i)=>h2hPick[i]='a'); drawH2H(); h2hLock(); CLOCK.seek(3600); });
  await p.waitForTimeout(400);
  if (!(await p.$('#hlFinal'))) bad('Who Goes Off did not settle');
  await p.evaluate(() => { CLOCK.reset(); go('luck');
    HEAT.forEach((h,i)=>heatPick[i]='over'); drawHeat(); heatLock(); CLOCK.seek(3600); });
  await p.waitForTimeout(400);
  if (!(await p.$('#lkFinal'))) bad('Heat Check did not settle');
  await p.evaluate(() => { CLOCK.reset(); go('rank'); rkNew();
    rkOrder = [...rkSet]; rkLockIn(); CLOCK.seek(3600); });
  await p.waitForTimeout(400);
  if (!(await p.$('#rkFinal'))) bad('Rank Em did not settle');
  console.log('   live slates: all three settled at the buzzer');

  // Call It, driven by real taps: pick three, drop three pins, settle
  await p.evaluate(() => { CLOCK.reset(); go('call'); geoDraw(); });
  await p.waitForTimeout(250);
  for (const nm of ['Auston Matthews','William Nylander','Matthew Knies'])
    await p.evaluate(n => { const r = [...document.querySelectorAll('#clPool .prow')]
      .find(x => x.innerText.includes(n)); if (r) r.click(); }, nm);
  await p.waitForTimeout(200);
  const aim = {'Auston Matthews':[71,-19],'William Nylander':[75,10],'Matthew Knies':[60,0]};
  for (const [nm, xy] of Object.entries(aim)){
    await p.evaluate(n => { geoActive = n; geoDraw(); }, nm);
    const box = await p.$('#clRink');
    await box.scrollIntoViewIfNeeded();
    const r = await box.boundingBox();
    const pct = await p.evaluate(v => [pctX(v[0]), pctY(v[1])], xy);
    await p.mouse.click(r.x + r.width * pct[0] / 100, r.y + r.height * pct[1] / 100);
    await p.waitForTimeout(140);
  }
  const pins = await p.evaluate(() => Object.keys(geoPins).length);
  if (pins !== 3) bad('Call It took only ' + pins + ' of 3 pins');
  await p.click('#clGo'); await p.waitForTimeout(250);
  await p.evaluate(() => CLOCK.seek(3600)); await p.waitForTimeout(600);
  const geo = await p.evaluate(() => Object.values(geoDone).filter(r => r.goal).length);
  if (geo !== 3) bad('Call It settled ' + geo + ' of 3 pins');
  const near = await p.evaluate(() => Math.min(...Object.values(geoDone).filter(r=>r.goal).map(r=>r.dist)));
  if (!(near < 1)) bad('Call It distance maths is off: closest pin read ' + near + ' ft');
  console.log('   Call It: three pins dropped by mouse, all three settled, closest ' + near.toFixed(1) + ' ft');

  // the grid, played by real taps
  await p.evaluate(() => { go('grid'); igNew(0); });
  await p.waitForTimeout(400);
  const axes = await p.evaluate(() => { const g = IG_DATA.grids[IGs.gi];
    return g.r.concat(g.c).map(a => igLabel(a).b); });
  const teamish = await p.evaluate(() => { const g = IG_DATA.grids[IGs.gi];
    return g.r.concat(g.c).filter(a => a.slice(0,2) === 'T_').length; });
  if (teamish > 3) bad('opening grid is ' + teamish + '/6 clubs');
  console.log('   grid: ' + teamish + ' of 6 axes are clubs [' + axes.join(', ') + ']');

  // tab through the whole thing to prove keyboard reach
  await p.evaluate(() => go('home'));
  await p.waitForTimeout(200);
  let reached = 0;
  for (let i = 0; i < 25; i++){
    await p.keyboard.press('Tab');
    const t = await p.evaluate(() => document.activeElement && document.activeElement.tagName);
    if (t === 'BUTTON' || t === 'A' || t === 'INPUT') reached++;
  }
  if (reached < 12) bad('only ' + reached + ' focusable stops in 25 tabs');
  console.log('   keyboard: ' + reached + ' focusable stops in 25 tabs');

  if (errs.length){ bad(errs.length + ' JS error(s): ' + errs.slice(0,3).join(' | ')); }
  else console.log('   console: clean');
  await p.screenshot({ path: `live/real_${label.replace(/\W+/g,'_')}.png` });
  await browser.close();
  console.log('');
}

await run('desktop 1440', { viewport: { width: 1440, height: 950 } });
await run('laptop 1280',  { viewport: { width: 1280, height: 800 } });
await run('iPhone 13',    devices['iPhone 13']);
await run('Pixel 5',      devices['Pixel 5']);
await run('iPad',         devices['iPad (gen 7)']);

srv.close();
console.log(fails === 0 ? '\nALL REAL-SITE CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
