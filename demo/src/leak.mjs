/* Does any live game show a fan something the buzzer has not decided yet?
   Lock each slate a third of the way through the game and compare what is
   on screen against the final box score. Anything that matches the final
   answer before CLOCK.over is a spoiler, not a feature. */
import http from 'http'; import { readFileSync } from 'fs';
import { chromium } from 'playwright';
const srv = http.createServer((q,s)=>{ s.writeHead(200,{'Content-Type':'text/html'});
  s.end(readFileSync('/home/claude/leafs/Toronto_GameDay_Citrus.html')); });
await new Promise(r=>srv.listen(4622,'127.0.0.1',r));
const b = await chromium.launch();
const p = await b.newPage({viewport:{width:1440,height:1200}});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://127.0.0.1:4622/'); await p.waitForTimeout(900);

const partWay = () => p.evaluate(()=>{ CLOCK.i = Math.floor(EV.length*0.35); CLOCK.t = 1400;
  CLOCK.over = false; CLOCK.emit('tick'); });

let bad = 0;
const fail = m => { bad++; console.log('   SPOILER  ' + m); };
const ok   = m => console.log('   ok       ' + m);

// ── Rank 'Em ─────────────────────────────────────────────────────
await p.evaluate(()=>go('rank')); await p.waitForTimeout(300);
await partWay();
for (let i=0;i<4;i++){ await p.click('#rkOpts .prow:not(.on)'); await p.waitForTimeout(90); }
await p.waitForTimeout(300);
{
  const r = await p.evaluate(()=>({
    shown:[...document.querySelectorAll('#rkOpts .prow')].map(x=>x.querySelector('b').textContent.trim()),
    truth:[...rkSet].sort((a,b)=>b[rkCat.k]-a[rkCat.k]).map(x=>x.name),
    over: CLOCK.over }));
  console.log("\n— Rank 'Em, locked at 35% —");
  if (!r.over && r.shown.join('>') === r.truth.join('>'))
    fail('rows are in the final finishing order: ' + r.shown.join(' > '));
  else ok('rows do not give away the finish');
}

// ── Who Goes Off ─────────────────────────────────────────────────
await p.evaluate(()=>go('hl')); await p.waitForTimeout(300);
await partWay();
{
  const before = await p.evaluate(()=>document.querySelector('#p-hl').innerText);
  await p.evaluate(()=>{ document.querySelectorAll('#h2hList .vsrow .side').forEach((s,i)=>{ if(i%2===0) s.click(); }); });
  await p.waitForTimeout(250);
  const go1 = await p.$('#h2hGo'); if (go1) { await go1.click({force:true}).catch(()=>{}); }
  await p.waitForTimeout(350);
  const r = await p.evaluate(()=>{
    const t = document.querySelector('#p-hl').innerText;
    // every winner the final box score would name
    const finals = (typeof H2H!=='undefined'? H2H:[]).map(h=>h);
    return { over: CLOCK.over, txt: t };
  });
  const leaks = /won|wins|takes it|final/i.test(r.txt) && !r.over;
  console.log('\n— Who Goes Off, locked at 35% —');
  leaks ? fail('panel text calls a result before the buzzer')
        : ok('no result language before the buzzer');
}

// ── Heat Check ───────────────────────────────────────────────────
await p.evaluate(()=>go('luck')); await p.waitForTimeout(300);
await partWay();
{
  await p.evaluate(()=>{ document.querySelectorAll('#heatList .heatb').forEach((s,i)=>{ if(i%2===0) s.click(); }); });
  await p.waitForTimeout(250);
  const g = await p.$('#heatGo'); if (g) await g.click({force:true}).catch(()=>{});
  await p.waitForTimeout(350);
  const r = await p.evaluate(()=>({ over: CLOCK.over, txt: document.querySelector('#p-luck').innerText }));
  console.log('\n— Heat Check, locked at 35% —');
  (/\bhit\b.*\bmiss\b|lines hit|Full time/i.test(r.txt) && !r.over)
    ? fail('panel settles lines before the buzzer')
    : ok('lines stay open until the buzzer');
}

// ── which stats move live at all ─────────────────────────────────
console.log('\n— what liveVal proves mid-game —');
const lv = await p.evaluate(()=>{
  const n = 'Auston Matthews'; const out = {};
  ['g','a','p','sog','hit','blk','tk'].forEach(k=>{ out[k] = liveVal(n,k); });
  return { out, feed: CLOCK.live(n) };
});
console.log('   liveVal :', JSON.stringify(lv.out));
console.log('   feed has:', JSON.stringify(lv.feed));
if (lv.out.p === null && lv.feed.p !== undefined)
  fail('points are null in liveVal but the feed computes them (g + a)');

console.log('\n' + (bad ? bad + ' SPOILER(S)' : 'no spoilers'), '| js errors:', errs.length?errs:'none');
await b.close(); srv.close();
