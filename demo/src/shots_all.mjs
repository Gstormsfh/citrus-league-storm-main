import http from 'http'; import { readFileSync } from 'fs';
import { chromium } from 'playwright';
const srv = http.createServer((q,s)=>{ s.writeHead(200,{'Content-Type':'text/html'});
  s.end(readFileSync('/home/claude/leafs/Toronto_GameDay_Citrus.html')); });
await new Promise(r=>srv.listen(4420,'127.0.0.1',r));
const b = await chromium.launch();
const p = await b.newPage({viewport:{width:1400,height:1000}});
await p.goto('http://127.0.0.1:4420/'); await p.waitForTimeout(900);
const P=['home','ult','stormy','hl','guess','luck','rank','fx','bz','grid','call','dash','lb'];
const rep=[];
for (const t of P){
  await p.evaluate(x=>go(x), t); await p.waitForTimeout(320);
  const m = await p.evaluate(t => {
    const el = document.querySelector('#p-'+t);
    const r = el.getBoundingClientRect();
    // measure emptiness: how much of the panel's vertical run has no text in it
    const kids = [...el.querySelectorAll('*')].filter(n=>{
      const b=n.getBoundingClientRect(); return b.height>0 && b.width>0 && (n.innerText||'').trim();
    });
    let ink = 0; const rows=[];
    kids.forEach(n=>{ const b=n.getBoundingClientRect(); rows.push([b.top,b.bottom]); });
    rows.sort((a,b)=>a[0]-b[0]);
    let cur=null; const merged=[];
    for (const [a,bb] of rows){ if(!cur||a>cur[1]+8){cur=[a,bb];merged.push(cur);} else cur[1]=Math.max(cur[1],bb); }
    merged.forEach(([a,bb])=>ink+=bb-a);
    const gaps = [];
    for (let i=1;i<merged.length;i++){ const g=merged[i][0]-merged[i-1][1]; if(g>90) gaps.push(Math.round(g)); }
    return { h: Math.round(r.height), ink: Math.round(ink), gaps: gaps.slice(0,4),
             density: +(ink/r.height).toFixed(2) };
  }, t);
  rep.push([t, m]);
  await p.screenshot({path:`live/panel_${t}.png`, fullPage:true});
}
console.log('panel      height  density  big gaps (px)');
for (const [t,m] of rep)
  console.log('  %s %s %s   %s', t.padEnd(8), String(m.h).padStart(6), String(m.density).padStart(6),
              m.gaps.length ? m.gaps.join(', ') : '');
await b.close(); srv.close();
