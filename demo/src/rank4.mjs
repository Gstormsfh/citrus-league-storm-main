/* Every Rank 'Em category, at every stage, checked for a bar and an honest
   label. Two of the four exist only in the box score. */
import http from 'http'; import { readFileSync } from 'fs';
import { chromium } from 'playwright';
const srv = http.createServer((q,s)=>{ s.writeHead(200,{'Content-Type':'text/html'});
  s.end(readFileSync('/home/claude/leafs/Toronto_GameDay_Citrus.html')); });
await new Promise(r=>srv.listen(4640,'127.0.0.1',r));
const b = await chromium.launch();
const p = await b.newPage({viewport:{width:1440,height:1100}, deviceScaleFactor:2});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://127.0.0.1:4640/'); await p.waitForTimeout(900);
await p.evaluate(()=>go('rank')); await p.waitForTimeout(300);

const snap = () => p.evaluate(()=>({
  cat: rkCat.l, live: !!KIT_LIVE[rkCat.k], chip: document.querySelector('#rkSettle').textContent,
  rows: [...document.querySelectorAll('#rkOpts .prow')].map(r=>({
    who: r.querySelector('b').textContent.trim().split(' ').pop(),
    val: (r.querySelector('.rt b')||{}).textContent,
    unit: (r.querySelector('.rt .sh')||{}).textContent,
    bar: r.querySelector('.rt .bar i') ? r.querySelector('.rt .bar i').style.width : 'NO BAR',
    rate: r.className.includes('rkrate')
  }))}));

for (const want of ['shots on goal','points','hits','blocks']){
  await p.evaluate(w=>{ let n=0; while(rkCat.l!==w && n<400){ rkNew(); n++; } }, want);
  await p.waitForTimeout(150);
  const pre = await snap();
  if (pre.cat !== want){ console.log('could not reach', want); continue; }
  console.log('\n── ' + want + '  (live in feed: ' + pre.live + ', chip says "' + pre.chip + '") ──');
  console.log('  before puck drop:');
  console.table(pre.rows);
  const noBar = pre.rows.filter(r=>r.bar==='NO BAR').length;
  if (noBar) console.log('  !! ' + noBar + ' rows with no bar');
  // lock and run to the buzzer
  await p.evaluate(()=>{ rkOrder=[...rkSet]; rkDraw(); rkLockIn(); while(!CLOCK.over) CLOCK.skip(); });
  await p.waitForTimeout(700);
  const post = await snap();
  console.log('  at the buzzer:');
  console.table(post.rows);
  if (post.rows.some(r=>r.bar==='NO BAR')) console.log('  !! missing bar at final');
  if (post.rows.some(r=>r.rate)) console.log('  !! still showing a season rate after the buzzer');
  await p.evaluate(()=>{ CLOCK.reset(); const f=$('#rkFinal'); if(f) f.remove(); rkNew(); });
  await p.waitForTimeout(250);
}
console.log('\njs errors:', errs.length?errs:'none');
await b.close(); srv.close();
