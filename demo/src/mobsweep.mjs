import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({viewport:{width:390,height:844}})).newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto('file:///home/claude/leafs/Toronto_GameDay_Citrus.html',{waitUntil:'load'});
await p.waitForTimeout(800);
const over = async tag => {
  const r = await p.evaluate(()=>({b:document.body.scrollWidth, w:innerWidth}));
  return (r.b>r.w+1) ? `OVERFLOW ${tag} body=${r.b} win=${r.w}` : null;
};
const bad = [];
for (const t of ['home','ult','stormy','hl','guess','luck','rank','fx','bz','grid','dash','lb']){
  await p.evaluate(x=>go(x),t); await p.waitForTimeout(400);
  await p.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=600){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,50));}window.scrollTo(0,0);});
  const o = await over(t); if (o) bad.push(o);
}
console.log(bad.length ? bad.join('\n') : 'no horizontal overflow on any panel at 390px');
// capture a few
for (const t of ['home','ult','dash','lb']){
  await p.evaluate(x=>go(x),t); await p.waitForTimeout(450);
  await p.screenshot({path:'vis/M_'+t+'.png'});
}
console.log('errors:', errs.length?errs:'none');
await b.close();
