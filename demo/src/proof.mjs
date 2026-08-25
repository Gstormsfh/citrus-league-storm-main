/* Full visual pass: every panel, desktop and phone, played not empty. */
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
await new Promise(r=>srv.listen(4600,'127.0.0.1',r));
const b = await chromium.launch();
const PANELS=['home','ult','stormy','hl','guess','luck','rank','fx','bz','grid','call','dash','lb'];
const errs=[];
for (const [name, opts] of [['D',{viewport:{width:1440,height:1000}}],
                            ['M',{...devices['iPhone 13'], hasTouch:true}]]){
  const ctx = await b.newContext(opts); const p = await ctx.newPage();
  p.on('pageerror',e=>errs.push(name+' '+e.message));
  p.on('console',m=>{ if(m.type()==='error') errs.push(name+' '+m.text()); });
  await p.goto('http://127.0.0.1:4600/'); await p.waitForTimeout(900);
  await p.evaluate(()=>{ PARTS.forEach((P,i)=>pick[P.id]=PERFECT.build[i]); drawParts(); tally(); });
  await p.waitForTimeout(300);
  const rows=[];
  for (const t of PANELS){
    await p.evaluate(x=>go(x), t); await p.waitForTimeout(320);
    await p.screenshot({path:join(ROOT, `proof2/${name}_${t}.png`), fullPage:true});
    const m = await p.evaluate(()=>{
      const doc=document.documentElement;
      const clipped=[...document.querySelectorAll('.panel.on *')].filter(e=>{
        const cs=getComputedStyle(e);
        return cs.textOverflow==='ellipsis' && e.scrollWidth>e.clientWidth+1 && e.textContent.trim().length>2;
      }).map(e=>e.textContent.trim().slice(0,26));
      /* a strip that scrolls is fine. A strip that scrolls with the
         scrollbar hidden and nothing in its place is the bug. */
      const hidden=[...document.querySelectorAll('.panel.on *, nav')].filter(e=>{
        const cs=getComputedStyle(e);
        if (!(cs.overflowX==='auto'||cs.overflowX==='scroll')) return false;
        if (e.scrollWidth<=e.clientWidth+2) return false;
        const w=e.parentElement;
        return !(w && w.classList.contains('hscroll') &&
                 (w.classList.contains('canl')||w.classList.contains('canr')));
      }).map(e=>(e.id||e.className||e.tagName).toString().slice(0,22)+' +'+(e.scrollWidth-e.clientWidth));
      return {ovf:doc.scrollWidth-doc.clientWidth, clipped:[...new Set(clipped)], hscroll:[...new Set(hidden)]};
    });
    rows.push([t, m]);
  }
  console.log('\n== '+(name==='D'?'desktop 1440':'iPhone 13')+' ==');
  for (const [t,m] of rows){
    const flags=[];
    if (m.ovf>0) flags.push('OVERFLOW '+m.ovf);
    if (m.clipped.length) flags.push('clipped: '+m.clipped.join(' | '));
    if (m.hscroll.length) flags.push('h-scroll: '+m.hscroll.join(' | '));
    console.log('  '+t.padEnd(8)+(flags.length?flags.join('  ·  '):'clean'));
  }
  await ctx.close();
}
console.log('\nJS errors:', errs.length?errs:'none');
await b.close(); srv.close();
