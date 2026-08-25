/* Guess the Leaf and Pick'em, measured before touching either. */
import http from 'http'; import { readFileSync } from 'fs';
import { chromium, devices } from 'playwright';
const srv = http.createServer((q,s)=>{ s.writeHead(200,{'Content-Type':'text/html'});
  s.end(readFileSync('/home/claude/leafs/Toronto_GameDay_Citrus.html')); });
await new Promise(r=>srv.listen(4630,'127.0.0.1',r));
const b = await chromium.launch();
for (const [name, opts] of [['desktop',{viewport:{width:1440,height:1200},deviceScaleFactor:2}],
                            ['tablet',{viewport:{width:900,height:1200}}],
                            ['phone',{...devices['iPhone 13'],hasTouch:true}]]){
  const ctx = await b.newContext(opts); const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://127.0.0.1:4630/'); await p.waitForTimeout(800);

  await p.evaluate(()=>go('guess')); await p.waitForTimeout(350);
  const g = await p.evaluate(()=>{
    const cl=[...document.querySelectorAll('#gClues .clue')];
    const rows={}; cl.forEach(c=>{const t=Math.round(c.getBoundingClientRect().top); rows[t]=(rows[t]||0)+1;});
    return { tiles: cl.length, perRow: Object.values(rows),
      boardW: Math.round((document.querySelector('.guessleft')||{getBoundingClientRect:()=>({width:0})}).getBoundingClientRect().width),
      tileW: cl[0]?Math.round(cl[0].getBoundingClientRect().width):0,
      panelH: Math.round(document.querySelector('#p-guess').getBoundingClientRect().height) };
  });
  await p.evaluate(()=>go('fx')); await p.waitForTimeout(350);
  const f = await p.evaluate(()=>{
    const rows=[...document.querySelectorAll('#fxList .fxrow')];
    return { rows: rows.length,
      dates: rows.map(r=>(r.innerText.split('\n')[0]||'').trim()).slice(0,12),
      rowH: rows[0]?Math.round(rows[0].getBoundingClientRect().height):0,
      panelH: Math.round(document.querySelector('#p-fx').getBoundingClientRect().height) };
  });
  console.log('\n== ' + name + ' ==');
  console.log('  guess : ' + g.tiles + ' tiles, per row ' + JSON.stringify(g.perRow) +
              ', board ' + g.boardW + 'px, tile ' + g.tileW + 'px, panel ' + g.panelH);
  console.log("  pick'em: " + f.rows + ' rows, ' + f.rowH + 'px each, panel ' + f.panelH);
  if (name==='desktop') console.log('  dates  : ' + JSON.stringify(f.dates));
  if (errs.length) console.log('  ERRORS', errs);
  if (name==='desktop'){
    await p.evaluate(()=>go('guess')); await p.waitForTimeout(250);
    await p.locator('#p-guess').screenshot({path:'nit_guess.png'});
    await p.evaluate(()=>go('fx')); await p.waitForTimeout(250);
    await p.locator('#p-fx').screenshot({path:'nit_fx.png'});
  }
  await ctx.close();
}
await b.close(); srv.close();
