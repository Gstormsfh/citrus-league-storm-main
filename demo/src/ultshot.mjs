/* The whole Ultimate Leaf panel, desktop and phone, filled and final. */
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
await new Promise(r=>srv.listen(4661,'127.0.0.1',r));
const b = await chromium.launch();
for (const [name, opts, out] of [
    ['desktop', {viewport:{width:1440,height:1200}, deviceScaleFactor:2}, 'us_desktop.png'],
    ['phone',   {...devices['iPhone 13'], hasTouch:true},                 'us_phone.png']]){
  const ctx = await b.newContext(opts); const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://127.0.0.1:4661/'); await p.waitForTimeout(900);
  await p.evaluate(()=>go('ult')); await p.waitForTimeout(500);
  await p.evaluate(()=>{ ['g','a','hit'].forEach(id=>{
      const P=PARTS.find(x=>x.id===id), used=PARTS.map(q=>pick[q.id]&&pick[q.id].name);
      pick[id]=KIT_POOL.filter(x=>!used.includes(x.name)).sort((x,y)=>y[P.k]-x[P.k])[0];
    }); drawParts(); tally(); });
  await p.waitForTimeout(500);
  await p.locator('#p-ult').screenshot({path:out});
  console.log(name, 'errors:', errs.length?errs:'none');
  await ctx.close();
}
await b.close(); srv.close();
