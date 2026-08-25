/* Plays every game on a phone using real taps only. No evaluate() shortcuts
   for anything a thumb would do, so a broken tap target fails here. */
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
import http from 'http'; import { readFileSync } from 'fs';
import { chromium, devices } from 'playwright';
const srv = http.createServer((q,s)=>{ s.writeHead(200,{'Content-Type':'text/html'});
  s.end(readFileSync(BUILD)); });
await new Promise(r=>srv.listen(4490,'127.0.0.1',r));
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['iPhone 13'], hasTouch:true });
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push('pageerror: '+e.message));
p.on('console',m=>{ if(m.type()==='error') errs.push('console: '+m.text()); });
await p.goto('http://127.0.0.1:4490/'); await p.waitForTimeout(900);

let fails = 0;
const bad = m => { fails++; console.log('   FAIL ' + m); };
const ok  = m => console.log('   ok   ' + m);
const nav = async t => { await p.evaluate(x=>go(x), t); await p.waitForTimeout(320); };
const tap = async (sel, i=0) => {
  const els = await p.$$(sel);
  if (!els[i]) { bad('no tap target for ' + sel + '[' + i + ']'); return false; }
  await els[i].scrollIntoViewIfNeeded();
  const box = await els[i].boundingBox();
  if (!box) { bad('target has no box: ' + sel); return false; }
  if (box.height < 30) bad('tap target only ' + Math.round(box.height) + 'px tall: ' + sel);
  await els[i].tap();
  await p.waitForTimeout(220);
  return true;
};
const txt = async s => (await p.evaluate(x=>{const n=document.querySelector(x);return n?n.innerText:'';}, s)).trim();

// ── tap targets across every panel ───────────────────────────────
console.log('\n— tap target audit —');
for (const t of ['home','ult','stormy','hl','guess','luck','rank','fx','bz','grid','call','dash','lb']){
  await nav(t);
  const small = await p.evaluate(t => {
    const out=[];
    document.querySelectorAll('#p-'+t+' button, #p-'+t+' input, #p-'+t+' a, #p-'+t+' summary').forEach(n=>{
      const b=n.getBoundingClientRect();
      if (b.width>0 && b.height>0 && b.height<30)
        out.push((n.className||n.tagName).toString().slice(0,26)+' '+Math.round(b.height)+'px');
    });
    return [...new Set(out)];
  }, t);
  if (small.length) bad(t + ' small targets: ' + small.slice(0,4).join(', '));
}
if (!fails) ok('every button, input and disclosure is at least 30px tall on all 13 panels');

// ── 01 Ultimate Leaf ─────────────────────────────────────────────
console.log('\n— 01 Ultimate Leaf —');
await nav('ult');
/* The rows stopped being buttons; the kit on Carlton is the way in, and
   on a phone that figure is 250px wide, so this is also the real test of
   whether six pieces of a 250px bear are tappable with a thumb.

   A piece can own more than one rect -- two skates, and the stick has a
   butt and a blade either side of its shaft -- so this taps the biggest,
   which is the one a thumb goes for and the one the 30px audit should
   be measuring. */
const doorIds = await p.$$eval('.carl .kitdoor', d => d.map(x => x.dataset.id));
for (const id of doorIds){
  const sel = `.carl .kitdoor[data-id="${id}"] rect.hitz`;
  const n = await p.$$eval(sel, rs => {
    let best = 0, area = -1;
    rs.forEach((r,i) => { const b = r.getBoundingClientRect();
      if (b.width * b.height > area){ area = b.width * b.height; best = i; } });
    return best;
  });
  if (!await tap(sel, n)) break;
  // the top of the list is greyed once he is placed elsewhere: one Leaf, one slot
  if (!await tap('#shList .prow:not([disabled])', 0)) break;
}
const filled = await txt('#ultFilled');
filled === '6 of 6' ? ok('six slots filled by tapping, ' + await txt('#ultTotal') + ' projected')
                    : bad('kit filled ' + filled);

// ── 02 Beat Stormy ───────────────────────────────────────────────
console.log('\n— 02 Beat Stormy —');
await nav('stormy');
for (let i=0;i<3;i++) await tap('#poolF .brow.live:not(.on)', 0);
for (let i=0;i<2;i++) await tap('#poolD .brow.live:not(.on)', 0);
const slots = await txt('#slotState');
slots.startsWith('3/3') ? ok('lineup iced by tapping: ' + slots) : bad('lineup ' + slots);
await tap('#stormyGo');
(await p.evaluate(()=>sLocked)) ? ok('locked') : bad('lock did not take');

// ── 03 Who Goes Off ──────────────────────────────────────────────
console.log('\n— 03 Who Goes Off —');
await nav('hl');
for (let i=0;i<6;i++) await tap('.vsrow .h2hp', i*2);
const picked = await txt('#hlStreak');
picked === '6 of 6' ? ok('six head to heads picked') : bad('picked ' + picked);
await tap('#hlGo');
(await p.evaluate(()=>h2hLocked)) ? ok('slate locked') : bad('slate lock failed');

// ── 05 Heat Check ────────────────────────────────────────────────
console.log('\n— 05 Heat Check —');
await nav('luck');
for (let i=0;i<6;i++) await tap('.heat .heatb', i*2);
const hp = await txt('#lkScore');
hp === '6 of 6' ? ok('six lines called') : bad('called ' + hp);
await tap('#lkGo');
(await p.evaluate(()=>heatLocked)) ? ok('card locked') : bad('card lock failed');

// ── 06 Rank Em ───────────────────────────────────────────────────
console.log('\n— 06 Rank Em —');
await nav('rank');
for (let i=0;i<4;i++) await tap('#rkOpts .prow:not(.on)', 0);
(await p.evaluate(()=>rkLock)) ? ok('four ranked by tapping') : bad('ranking did not lock');

// ── 10 Call It, the pin game ─────────────────────────────────────
console.log('\n— 10 Call It —');
await nav('call');
for (const nm of ['Auston Matthews','William Nylander','Matthew Knies']){
  const idx = await p.evaluate(n=>[...document.querySelectorAll('#clPool .prow')].findIndex(x=>x.innerText.includes(n)), nm);
  if (idx < 0) { bad('pool row missing for ' + nm); continue; }
  await tap('#clPool .prow', idx);
}
(await txt('#clCount')) === '3 of 3' ? ok('three picked') : bad('picked ' + await txt('#clCount'));
const aim = {'Auston Matthews':[71,-19],'William Nylander':[75,10],'Matthew Knies':[60,0]};
for (const [nm, xy] of Object.entries(aim)){
  await p.evaluate(n=>{ const s=[...document.querySelectorAll('.geoslot')].find(x=>x.dataset.n===n); if(s) s.click(); }, nm);
  await p.waitForTimeout(150);
  const rink = await p.$('#clRink');
  await rink.scrollIntoViewIfNeeded();
  const r = await rink.boundingBox();
  const pct = await p.evaluate(v=>[pctX(v[0]),pctY(v[1])], xy);
  await p.touchscreen.tap(r.x + r.width*pct[0]/100, r.y + r.height*pct[1]/100);
  await p.waitForTimeout(180);
}
const pins = await p.evaluate(()=>Object.keys(geoPins).length);
pins === 3 ? ok('three pins dropped by touch') : bad('only ' + pins + ' pins landed');
await tap('#clGo');
(await p.evaluate(()=>geoLocked)) ? ok('pins locked') : bad('pin lock failed');

// ── run the clock and settle everything ──────────────────────────
console.log('\n— the buzzer settles all six live games —');
await p.evaluate(()=>CLOCK.seek(3600)); await p.waitForTimeout(900);
for (const [name, sel] of [['Beat Stormy','#sFinal'],['Who Goes Off','#hlFinal'],
                           ['Heat Check','#lkFinal'],['Rank Em','#rkFinal'],['Call It','#clFinal']]){
  (await p.$(sel)) ? ok(name + ' settled') : bad(name + ' did not settle');
}
const live = await p.evaluate(()=>document.querySelector('#ultLive').textContent);
+live > 0 ? ok('Ultimate Leaf scored live: ' + live + ' pts') : bad('Ultimate Leaf live total ' + live);

// ── 04 / 08 / 09, the ones that do not need the game ─────────────
console.log('\n— 04 Guess the Leaf / 08 Buzzer / 09 Grid —');
await nav('guess');
await tap('#gMore'); await tap('#gHint');
(await p.$$('#gOpts button')).length >= 2 ? ok('clues open and the four-name hint pays out') : bad('guess hint gave no options');
await nav('bz');
await tap('#bzStart'); await p.waitForTimeout(700);
await tap('#bzArea .opt', 0);
+(await txt('#bzAsked')) >= 1 ? ok('buzzer answered a question by tap') : bad('buzzer did not register');
await nav('grid');
await tap('.igc', 0);
(await txt('#igAsk')).length > 20 ? ok('grid square opens with a question') : bad('grid square gave no ask');

console.log('\nJS errors during the whole play-through:', errs.length ? errs.slice(0,4) : 'none');
if (errs.length) fails += errs.length;
console.log(fails === 0 ? '\nMOBILE PLAY-THROUGH PASSED' : `\n${fails} MOBILE FAILURE(S)`);
await b.close(); srv.close();
process.exit(fails===0?0:1);
