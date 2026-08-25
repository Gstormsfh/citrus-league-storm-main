/* The figure is the control. Not one of the six pieces was reachable
   without a mouse until the rows beside it stopped being buttons, and a
   <g> with a tabindex gets no behaviour for free, so this file walks the
   whole thing: which piece owns which pixel, and whether a keyboard can
   get to it, name it, open it and come back.

   The paper doll's six pieces are nested <svg> viewports over one render.
   Chrome reports the UNCLIPPED box for those, so getBoundingClientRect is
   useless here and any test that clicks "the middle of the group" lands on
   empty air and silently hits nothing. Real hit-testing is correct; this
   file proves it, at a named point on each piece, so a change to the mask
   regions or the render cannot quietly break the page. */
import http from 'http'; import { readFileSync } from 'fs';
import { chromium, devices } from 'playwright';
const srv = http.createServer((q,s)=>{ s.writeHead(200,{'Content-Type':'text/html'});
  s.end(readFileSync('/home/claude/leafs/Toronto_GameDay_Citrus.html')); });
await new Promise(r=>srv.listen(4690,'127.0.0.1',r));
const b = await chromium.launch();
/* viewBox point -> the piece that must own it. Half of these are on the
   edges of a piece rather than its middle, because the way this breaks is
   a region that is a little short or a little narrow, and a probe in the
   middle of a shin pad cannot see that. */
const POINTS = [
  ['the stick shaft',      279, 350, 'g'],
  ['the shaft, leaned',    290, 375, 'g'],   // it drifts right as it falls
  ['the stick butt',       262, 246, 'g'],   // above the right glove
  ['the stick blade',      305, 404, 'g'],
  ['the blade toe',        330, 408, 'g'],
  ['the left glove',        92, 286, 'a'],
  ['the left cuff',         95, 312, 'a'],   // the bottom v1 cut off
  ['the right glove',      262, 278, 'a'],
  ['the right cuff',       285, 302, 'a'],
  ['a shoulder cap',       237, 186, 'hit'],
  ['the far shoulder',      95, 195, 'hit'],
  ['a shin pad',           139, 372, 'blk'],
  ['the pad, low',         120, 402, 'blk'],
  ['a skate',              217, 430, 'tk'],
  ['a blade',              140, 448, 'tk'],
  ['the puck',             344, 362, 'sog'],
];
/* and points that must own NOTHING, or the bear becomes one big button.
   The last two matter because the cut layers are rectangular crops that
   overlap each other: if an <image> ever starts hit-testing as its box,
   the stick's crop swallows the right glove and this is where it shows. */
const CLEAR = [['his belly',176,250],['his head',176,100],['open air',20,20],
               ['his pants',140,325],['air beside the stick',310,270]];
/* NOT the gap between his legs: the shin pad's target is the whole leg at
   pad height, which is deliberate -- a tap two units inside the knee means
   the pads and there is nothing else it could mean. Targets are wider than
   the art on purpose and this file should not litigate that. */
let bad = 0;
for (const [name, opts] of [['desktop',{viewport:{width:1440,height:1200}}],
                            ['phone',{...devices['iPhone 13'],hasTouch:true}]]){
  const ctx = await b.newContext(opts); const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://127.0.0.1:4690/'); await p.waitForTimeout(800);
  await p.evaluate(()=>go('ult')); await p.waitForTimeout(350);
  /* elementFromPoint works in viewport coordinates, so the figure has to be
     ON the viewport. On a phone it starts below the fold and every point
     below the crease returns null -- which looks exactly like six dead
     pieces until you scroll. */
  await p.evaluate(()=>document.querySelector('.carl').scrollIntoView({block:'center'}));
  await p.waitForTimeout(400);
  const onScreen = await p.evaluate(()=>{const r=document.querySelector('.carl').getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight;});
  if (!onScreen) console.log('   note     figure taller than the viewport; points are clamped');
  const mode = await p.evaluate(()=>document.querySelector('.carlrender') ? 'render' : 'vector');
  if (mode === 'render'){
    const n = await p.evaluate(()=>document.querySelectorAll('.carlrender image').length);
    if (n !== 7){ bad++; console.log('   FAIL     ' + n + ' images on the figure, expected 7 (a base and six pieces)'); }
  }
  /* the figure is the only way in now, so it has to be reachable without a
     mouse: exactly one focusable door per piece, each with a name */
  const doors = await p.evaluate(()=>[...document.querySelectorAll('.carl .kitdoor')]
    .map(d=>({id:d.dataset.id, tab:d.getAttribute('tabindex'), role:d.getAttribute('role'),
              label:(d.getAttribute('aria-label')||'').slice(0,40)})));
  const ids = doors.map(d=>d.id).sort().join(',');
  if (ids !== 'a,blk,g,hit,sog,tk'){ bad++; console.log('   FAIL     doors are [' + ids + '], expected one per piece'); }
  const mute = doors.filter(d=>d.tab!=='0'||d.role!=='button'||!d.label);
  if (mute.length){ bad++; console.log('   FAIL     ' + mute.length + ' door(s) with no tabindex, role or name'); }
  else console.log('   ok       six doors, each focusable and named');

  /* A tabindex is not a tab stop and a role is not a behaviour. The six
     rows beside him used to be real buttons and they got all of this for
     free; a <g> gets none of it, so it is walked here for real. */
  if (name === 'desktop'){
    await p.evaluate(()=>{const h=document.querySelector('#p-ult');
      h.setAttribute('tabindex','-1'); h.focus();});
    const walk = [];
    for (let i=0;i<60 && walk.length<6;i++){
      await p.keyboard.press('Tab');
      const a = await p.evaluate(()=>{const e=document.activeElement;
        return {cls:(e.getAttribute&&e.getAttribute('class'))||'', id:e.dataset?e.dataset.id:''};});
      if (a.cls.includes('kitdoor')) walk.push(a.id);
    }
    const order = walk.join(',');
    /* PARTS order, which is the order of the list beside him */
    if (order !== 'g,a,sog,hit,blk,tk'){ bad++;
      console.log('   FAIL     Tab reaches [' + (order||'nothing') + '], expected g,a,sog,hit,blk,tk'); }
    else console.log('   ok       Tab walks all six, in the order the list reads');

    const ring = await p.evaluate(()=>{const d=document.activeElement;
      const r=d.querySelector && d.querySelector('rect.hitz');
      return r ? getComputedStyle(r).stroke : 'none';});
    if (ring === 'none' || ring === 'rgba(0, 0, 0, 0)'){ bad++;
      console.log('   FAIL     a focused piece shows no ring'); }
    else console.log('   ok       the focused piece is ringed and lit');

    for (const [key,nm] of [['Enter','Enter'],[' ','Space']]){
      await p.keyboard.press(key); await p.waitForTimeout(320);
      const open = await p.evaluate(()=>document.querySelector('#pickSheet').classList.contains('on'));
      if (!open){ bad++; console.log('   FAIL     ' + nm + ' did not open the picker'); }
      else console.log('   ok       ' + nm + ' opens that piece\'s picker');
      const y = await p.evaluate(()=>window.scrollY);
      await p.keyboard.press('Escape'); await p.waitForTimeout(300);
      const back = await p.evaluate(()=>{const e=document.activeElement;
        return !!(e && e.classList && e.classList.contains('kitdoor'));});
      if (!back){ bad++; console.log('   FAIL     Escape did not put focus back on the piece'); }
      if (nm === 'Space' && y !== await p.evaluate(()=>window.scrollY)){ bad++;
        console.log('   FAIL     Space scrolled the page as well as opening the picker'); }
    }
    console.log('   ok       Escape lands back on the piece it opened');
  }
  const hits = await p.evaluate(([pts,clr])=>{
    const box=document.querySelector('.carl').getBoundingClientRect();
    const at=(vx,vy)=>{ const e=document.elementFromPoint(
      box.left+vx/380*box.width, box.top+vy/470*box.height);
      if(!e) return null; const k=e.closest('[data-id]'); return k?k.dataset.id:null; };
    return {on:pts.map(q=>at(q[1],q[2])), off:clr.map(q=>at(q[1],q[2]))};
  }, [POINTS, CLEAR]);
  console.log('\n— ' + name + ' (' + mode + ') —');
  POINTS.forEach((q,i)=>{
    const got = hits.on[i];
    if (got === q[3]) console.log('   ok       ' + q[0] + ' -> ' + got);
    else { bad++; console.log('   FAIL     ' + q[0] + ' -> ' + (got||'nothing') + ', expected ' + q[3]); }
  });
  CLEAR.forEach((q,i)=>{
    if (!hits.off[i]) console.log('   ok       ' + q[0] + ' owns nothing');
    else { bad++; console.log('   FAIL     ' + q[0] + ' -> ' + hits.off[i] + ', should own nothing'); }
  });
  if (errs.length){ bad++; console.log('   FAIL     js errors: ' + errs.join(' | ')); }
  await ctx.close();
}
console.log('\n' + (bad ? bad + ' FAILURES' : 'every piece owns its own region, and nothing else does'));
await b.close(); srv.close();
process.exit(bad ? 1 : 0);
