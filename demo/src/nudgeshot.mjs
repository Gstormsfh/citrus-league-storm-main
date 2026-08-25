/* Catch the flash mid-beat, so there is a picture of it. */
import http from 'http'; import { readFileSync } from 'fs';
import { chromium } from 'playwright';
const srv=http.createServer((q,s)=>{s.writeHead(200,{'Content-Type':'text/html'});
  s.end(readFileSync('/home/claude/leafs/Toronto_GameDay_Citrus.html'));});
await new Promise(r=>srv.listen(4695,'127.0.0.1',r));
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1440,height:1100},deviceScaleFactor:2});
await p.goto('http://127.0.0.1:4695/'); await p.waitForTimeout(800);
await p.evaluate(()=>go('ult')); await p.waitForTimeout(400);
// fill two so both cases are on screen at once
await p.evaluate(()=>{ ['g','a'].forEach(id=>{const P=PARTS.find(x=>x.id===id);
  const used=PARTS.map(q=>pick[q.id]&&pick[q.id].name);
  pick[id]=KIT_POOL.filter(x=>!used.includes(x.name)).sort((x,y)=>y[P.k]-x[P.k])[0];});
  drawParts(); tally(); });
await p.waitForTimeout(400);
const fig = p.locator('.carl').first();
await fig.screenshot({path:'nudge_rest.png'});
// click the shin pads row and catch the peak of the glow
await p.locator('#parts .eq[data-id="blk"]').click();
await p.waitForTimeout(400);                 // ~45% into beat one
await fig.screenshot({path:'nudge_blk.png'});
// and a filled one
await p.waitForTimeout(2000);
await p.locator('#parts .eq[data-id="g"]').click();
await p.waitForTimeout(400);
await fig.screenshot({path:'nudge_g.png'});
console.log('shots written');
await b.close(); srv.close();
