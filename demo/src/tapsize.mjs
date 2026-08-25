/* How big is each piece of kit, as a real tap target, at each width? */
import http from 'http'; import { readFileSync } from 'fs';
import { chromium, devices } from 'playwright';
const srv = http.createServer((q,s)=>{ s.writeHead(200,{'Content-Type':'text/html'});
  s.end(readFileSync('/home/claude/leafs/Toronto_GameDay_Citrus.html')); });
await new Promise(r=>srv.listen(4671,'127.0.0.1',r));
const b = await chromium.launch();
for (const [name,opts] of [['desktop 1440',{viewport:{width:1440,height:1100}}],
                           ['tablet 900',{viewport:{width:900,height:1100}}],
                           ['iPhone 13',{...devices['iPhone 13'],hasTouch:true}],
                           ['iPhone SE',{viewport:{width:375,height:667},hasTouch:true,isMobile:true}],
                           ['360 android',{viewport:{width:360,height:740},hasTouch:true,isMobile:true}]]){
  const ctx=await b.newContext(opts); const p=await ctx.newPage();
  await p.goto('http://127.0.0.1:4671/'); await p.waitForTimeout(700);
  await p.evaluate(()=>go('ult')); await p.waitForTimeout(350);
  const d = await p.evaluate(()=>{
    const host=document.querySelector('.carl'); const r=host.getBoundingClientRect();
    const out={fig:[Math.round(r.width),Math.round(r.height)],pieces:{},rows:[]};
    document.querySelectorAll('.carlrender rect.kithz').forEach(n=>{
      const id=n.dataset.id, w=+n.getAttribute('width'), h=+n.getAttribute('height');
      const px=[Math.round(w/380*r.width), Math.round(h/470*r.height)];
      if(!out.pieces[id] || px[0]*px[1] < out.pieces[id][0]*out.pieces[id][1]) out.pieces[id]=px;
    });
    document.querySelectorAll('#parts .eq').forEach(n=>{const q=n.getBoundingClientRect();
      out.rows.push(Math.round(q.height));});
    return out;
  });
  const min = Object.entries(d.pieces).map(([k,v])=>k+' '+v[0]+'x'+v[1]).join('  ');
  console.log('\n'+name+'  figure '+d.fig[0]+'x'+d.fig[1]+'  rows '+d.rows[0]+'px');
  console.log('   smallest target per piece: '+min);
  const bad=Object.entries(d.pieces).filter(([k,v])=>Math.min(v[0],v[1])<30).map(([k,v])=>k);
  console.log('   under 30px: '+(bad.length?bad.join(', '):'none'));
  await ctx.close();
}
await b.close(); srv.close();
