/* The paper doll in its three states, off the built file, so a screenshot
   is the last check rather than a bounding box. */
import http from 'http'; import { readFileSync } from 'fs';
import { chromium } from 'playwright';
const srv = http.createServer((q,s)=>{ s.writeHead(200,{'Content-Type':'text/html'});
  s.end(readFileSync('/home/claude/leafs/Toronto_GameDay_Citrus.html')); });
await new Promise(r=>srv.listen(4655,'127.0.0.1',r));
const b = await chromium.launch();
const p = await b.newPage({viewport:{width:1440,height:1200}, deviceScaleFactor:2});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://127.0.0.1:4655/'); await p.waitForTimeout(900);
await p.evaluate(()=>go('ult')); await p.waitForTimeout(500);
console.log('render active:', await p.evaluate(()=>!!document.querySelector('.carlrender')));
console.log('kit layers:', await p.evaluate(()=>document.querySelectorAll('.carlrender image.kitl').length),
            '| doors:', await p.evaluate(()=>document.querySelectorAll('.carl .kitdoor').length));

const fig = p.locator('.carl').first();
await fig.scrollIntoViewIfNeeded();
await fig.screenshot({path:'cs_empty.png'});

// fill three slots
await p.evaluate(()=>{ ['g','a','hit'].forEach(id=>{
    const P=PARTS.find(x=>x.id===id), used=PARTS.map(q=>pick[q.id]&&pick[q.id].name);
    pick[id]=KIT_POOL.filter(x=>!used.includes(x.name)).sort((x,y)=>y[P.k]-x[P.k])[0];
  }); drawParts(); tally(); });
await p.waitForTimeout(400); await fig.screenshot({path:'cs_half.png'});

// fill all six and run the clock out
await p.evaluate(()=>{ PARTS.forEach(P=>{ if(pick[P.id]) return;
    const used=PARTS.map(q=>pick[q.id]&&pick[q.id].name);
    pick[P.id]=KIT_POOL.filter(x=>!used.includes(x.name)).sort((x,y)=>y[P.k]-x[P.k])[0];
  }); drawParts(); tally(); while(!CLOCK.over) CLOCK.skip(); });
await p.waitForTimeout(700); await fig.screenshot({path:'cs_final.png'});
console.log('js errors:', errs.length?errs:'none');
await b.close(); srv.close();
