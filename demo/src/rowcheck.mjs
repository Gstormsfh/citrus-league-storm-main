/* The rows are a read-out, not a door. That is the design, but a
   card-shaped object that eats a click and does nothing reads as broken,
   so a row points at the piece it names instead. This file holds both
   halves of that: the row must NOT open a picker, and it must NOT be
   silent either. */
import http from 'http'; import { readFileSync } from 'fs';
import { chromium, devices } from 'playwright';
const srv = http.createServer((q,s)=>{ s.writeHead(200,{'Content-Type':'text/html'});
  s.end(readFileSync('/home/claude/leafs/Toronto_GameDay_Citrus.html')); });
await new Promise(r=>srv.listen(4691,'127.0.0.1',r));
const b = await chromium.launch();
let bad = 0;
const ok = m => console.log('   ok       ' + m);
const no = m => { bad++; console.log('   FAIL     ' + m); };

for (const [name, opts] of [['desktop',{viewport:{width:1440,height:1100}}],
                            ['phone',{...devices['iPhone 13'],hasTouch:true}]]){
  const ctx = await b.newContext(opts); const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://127.0.0.1:4691/'); await p.waitForTimeout(800);
  await p.evaluate(()=>go('ult')); await p.waitForTimeout(400);
  console.log('\n— ' + name + ' —');

  /* nothing about the row should say "press me" */
  const look = await p.evaluate(()=>{const e=document.querySelector('#parts .eq');
    const c=getComputedStyle(e);
    return {tag:e.tagName, cursor:c.cursor, role:e.getAttribute('role'), tab:e.getAttribute('tabindex')};});
  (look.tag==='DIV' && look.cursor==='auto' && !look.role && look.tab===null)
    ? ok('a row is a div with an arrow cursor, no role, no tab stop')
    : no('a row still advertises itself: ' + JSON.stringify(look));

  /* and it must not open anything */
  await p.locator('#parts .eq').first().click(); await p.waitForTimeout(350);
  await p.evaluate(()=>document.querySelector('#pickSheet').classList.contains('on'))
    ? no('clicking a row opened the picker; the figure is meant to be the only door')
    : ok('clicking a row opens nothing');

  /* but it must point. Empty slot: the piece and its ring both flash. */
  const ids = await p.$$eval('#parts .eq', r=>r.map(x=>x.dataset.id));
  for (const id of [ids[0], ids[ids.length-1]]){
    await p.locator(`#parts .eq[data-id="${id}"]`).click(); await p.waitForTimeout(120);
    const lit = await p.evaluate(i=>({
      piece: !!document.querySelector('.carl .kitp.nudge[data-id="'+i+'"]'),
      ring:  !!document.querySelector('.carl .kitpin.nudge[data-id="'+i+'"]'),
      others: document.querySelectorAll('.carl .nudge:not([data-id="'+i+'"])').length
    }), id);
    lit.piece ? ok('"' + id + '" row lights its own piece') : no('"' + id + '" row lit no piece');
    lit.ring  ? ok('  and its ring, because the slot is empty') : no('  the empty ring did not pulse');
    lit.others ? no('  it lit ' + lit.others + ' element(s) belonging to another piece') : null;
    /* On a phone the figure is above the list, so the bottom row scrolls
       it back into view -- smoothly, which takes a beat. The question is
       not whether it is visible the instant you click, it is whether it
       is still flashing once it gets there. */
    await p.waitForTimeout(750);
    const seen = await p.evaluate(i=>{const r=document.querySelector('.carl').getBoundingClientRect();
      return {vis: r.bottom > 40 && r.top < innerHeight - 40,
              still: !!document.querySelector('.carl .kitp.nudge[data-id="'+i+'"]')};}, id);
    (seen.vis && seen.still) ? ok('  and it is on screen, still flashing, once the scroll lands')
      : no('  ' + (seen.vis ? 'the flash was over' : 'the figure never came into view')
                + ' by the time you could look at it');
  }

  /* it clears itself, or the figure is left glowing */
  await p.waitForTimeout(1500);
  await p.evaluate(()=>document.querySelectorAll('.carl .nudge').length)
    ? no('the flash never cleared') : ok('the flash clears itself');

  /* filled slot: the piece flashes, the pip is left alone -- a citrus pip
     ring already means "this number moved tonight" */
  await p.evaluate(()=>{ const P=PARTS[0];
    pick[P.id]=[...KIT_POOL].sort((a,b)=>b[P.k]-a[P.k])[0]; drawParts(); tally(); });
  await p.waitForTimeout(300);
  await p.locator(`#parts .eq[data-id="${ids[0]}"]`).click(); await p.waitForTimeout(120);
  const f = await p.evaluate(i=>({
    piece: !!document.querySelector('.carl .kitp.nudge[data-id="'+i+'"]'),
    pin: (document.querySelector('.carl .kitpin[data-id="'+i+'"]')||{}).className||''}), ids[0]);
  f.piece ? ok('a filled row still lights its piece') : no('a filled row lit nothing');
  f.pin.includes('ask') ? no('a filled slot is still showing the empty ring')
                        : ok('and leaves the pip alone');
  if (errs.length){ bad++; console.log('   FAIL     js errors: ' + errs.join(' | ')); }
  await ctx.close();
}
console.log('\n' + (bad ? bad + ' FAILURES' : 'the rows point, and only the figure opens'));
await b.close(); srv.close();
process.exit(bad ? 1 : 0);
