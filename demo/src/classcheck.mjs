/* Six class-name collisions have shipped in this build (.tag, .mark, .foot,
   .h2h, .sk, .grow). This finds the seventh before it does. It renders every
   panel, reads the class of every element actually on screen, and reports any
   class that lands on two structurally different components. */
import http from 'http'; import { readFileSync } from 'fs';
import { chromium } from 'playwright';
const srv = http.createServer((q,s)=>{ try{ s.writeHead(200,{'Content-Type':'text/html'});
  s.end(readFileSync('/home/claude/leafs/Toronto_GameDay_Citrus.html')); }catch{ s.writeHead(404); s.end(); } });
await new Promise(r=>srv.listen(4403,'127.0.0.1',r));
const b = await chromium.launch(); const p = await b.newPage({viewport:{width:1440,height:1000}});
await p.goto('http://127.0.0.1:4403/'); await p.waitForTimeout(800);
const PANELS=['home','ult','stormy','hl','guess','luck','rank','fx','bz','grid','call','dash','lb'];
const seen = {};
for (const t of PANELS){
  await p.evaluate(x=>go(x), t); await p.waitForTimeout(200);
  const rows = await p.evaluate(t => {
    const out=[];
    document.querySelectorAll('#p-'+t+' *').forEach(n=>{
      const pe = n.parentElement;
      const pc = pe ? (typeof pe.className === 'string' ? pe.className : (pe.getAttribute('class')||'')) : '';
      const par = pe ? (pe.id || pc.split(' ')[0] || pe.tagName) : '';
      n.classList.forEach(c => out.push([c, n.tagName+'<'+par]));
    });
    return out;
  }, t);
  for (const [c, ctx] of rows){ (seen[c] = seen[c] || new Set()).add(ctx); }
}
const CSSHAPES = Object.entries(seen).filter(([c,s]) => s.size > 1)
  .map(([c,s]) => [c, [...s]]).sort((a,b)=>b[1].length-a[1].length);
console.log('classes appearing under structurally different parents:');
let flagged = 0;
for (const [c, ctxs] of CSSHAPES){
  const tags = new Set(ctxs.map(x=>x.split('<')[0]));
  const pars = new Set(ctxs.map(x=>x.split('<')[1]));
  // a real collision: the same class on different element types in unrelated parents
  if (tags.size > 1 && pars.size >= 2){
    flagged++;
    console.log('  !! .%s  -> %s', c, ctxs.slice(0,5).join('  '));
  }
}
console.log(flagged ? `\n${flagged} suspicious` : '\nnone suspicious');
await b.close(); srv.close();
