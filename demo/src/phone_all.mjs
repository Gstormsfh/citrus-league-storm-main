import http from 'http'; import { readFileSync } from 'fs';
import { chromium, devices } from 'playwright';
const srv = http.createServer((q,s)=>{ s.writeHead(200,{'Content-Type':'text/html'});
  s.end(readFileSync('/home/claude/leafs/Toronto_GameDay_Citrus.html')); });
await new Promise(r=>srv.listen(4470,'127.0.0.1',r));
const b = await chromium.launch();
const ctx = await b.newContext(devices['iPhone 13']);
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://127.0.0.1:4470/'); await p.waitForTimeout(900);
const P=['home','ult','stormy','hl','guess','luck','rank','fx','bz','grid','call','dash','lb'];
console.log('panel     h     overflow   widest offender');
for (const t of P){
  await p.evaluate(x=>go(x), t); await p.waitForTimeout(320);
  const r = await p.evaluate(t => {
    const doc = document.documentElement;
    const over = doc.scrollWidth - doc.clientWidth;
    let worst = null;
    if (over > 1){
      document.querySelectorAll('#p-'+t+' *').forEach(n=>{
        const b = n.getBoundingClientRect();
        if (b.right > doc.clientWidth + 1){
          const w = b.right - doc.clientWidth;
          if (!worst || w > worst.by) worst = {by:Math.round(w), tag:n.tagName,
            cls:(typeof n.className==='string'?n.className:'').slice(0,40), txt:(n.innerText||'').slice(0,28)};
        }
      });
    }
    // anything crushed below a usable size
    const tiny = [...document.querySelectorAll('#p-'+t+' button, #p-'+t+' input')]
      .filter(n=>{const b=n.getBoundingClientRect(); return b.height>0 && b.height<26;}).length;
    return { h: Math.round(document.querySelector('#p-'+t).getBoundingClientRect().height),
             over, worst, tiny };
  }, t);
  console.log('  %s %s  %s  %s', t.padEnd(7), String(r.h).padStart(5),
    (r.over>1?('YES +'+r.over):'no').padEnd(9),
    r.worst ? (r.worst.tag+'.'+r.worst.cls+' "'+r.worst.txt+'" +'+r.worst.by) : (r.tiny?('tiny targets: '+r.tiny):''));
  await p.screenshot({path:`live/ph_${t}.png`, fullPage:true});
}
console.log('errors:', errs.length?errs.slice(0,3):'none');
await b.close(); srv.close();
