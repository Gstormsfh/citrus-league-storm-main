/* Catch the flash mid-beat, so there is a picture of it. */
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

/* outputs land beside the harness that made them, in shots/, rather than
   in whatever directory you happened to be standing in */
import { mkdirSync } from 'fs';
const SHOTS = join(HERE, 'shots');
mkdirSync(SHOTS, { recursive: true });
const shot = n => join(SHOTS, n);

import http from 'http'; import { readFileSync } from 'fs';
import { chromium } from 'playwright';
const srv=http.createServer((q,s)=>{s.writeHead(200,{'Content-Type':'text/html'});
  s.end(readFileSync(BUILD));});
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
await fig.screenshot({path:shot('nudge_rest.png')});
// click the shin pads row and catch the peak of the glow
await p.locator('#parts .eq[data-id="blk"]').click();
await p.waitForTimeout(400);                 // ~45% into beat one
await fig.screenshot({path:shot('nudge_blk.png')});
// and a filled one
await p.waitForTimeout(2000);
await p.locator('#parts .eq[data-id="g"]').click();
await p.waitForTimeout(400);
await fig.screenshot({path:shot('nudge_g.png')});
console.log('shots written');
await b.close(); srv.close();
