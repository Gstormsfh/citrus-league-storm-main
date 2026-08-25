/* This used to expect `node serve.mjs` running in another window on 4321.
   Forget to start it and every check failed with ERR_CONNECTION_REFUSED,
   which says nothing about the page. It serves itself now, like the rest. */
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import http from 'http';
import { chromium } from 'playwright';
const HERE  = dirname(fileURLToPath(import.meta.url));
const ROOT  = existsSync(join(HERE, 'Toronto_GameDay_Citrus.html')) ? HERE : join(HERE, '..');
const BUILD = join(ROOT, 'Toronto_GameDay_Citrus.html');
const SHOTS = join(HERE, 'shots');
mkdirSync(SHOTS, { recursive: true });
const srv = http.createServer((q,s)=>{ s.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
  s.end(readFileSync(BUILD)); });
/* port 0 = whatever is free. It used to sit on 4321, which is also where
   serve.mjs listens, so having the page open in a browser to look at it
   made the checks refuse to start. */
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const ORIGIN = 'http://127.0.0.1:' + srv.address().port + '/';
const B = await chromium.launch({ args:['--no-sandbox'] });
const C = await B.newContext({ viewport:{width:1400,height:1050}, deviceScaleFactor:1.5 });
const p = await C.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
const L=[]; const say=(...a)=>{const s=a.join(' ');L.push(s);console.log(s);};
const txt=async s=>{const e=await p.$(s);return e?(await e.innerText()).trim().replace(/\s+/g,' '):'(none)';};
const cp=()=>p.$eval('#cpTotal',e=>e.textContent);
let n=0; const shot=async(t,sel)=>{n++;const f=join(SHOTS, `V${String(n).padStart(2,'0')}_${t}.png`);
  const el=sel?await p.$(sel):null; if(el) await el.screenshot({path:f}); else await p.screenshot({path:f}); };

await p.goto(ORIGIN,{waitUntil:'load'});
await p.waitForTimeout(1600);
say('LOCKER ROOM — tiles', await p.$$eval('.lkrow',t=>t.length));
await shot('home');

// ── ULTIMATE LEAF: click each equipment slot, pick from the sheet ──
say('\n=== 01 ULTIMATE LEAF — clicking each piece of kit ===');
await p.click('nav .navitem[data-t=ult]'); await p.waitForTimeout(700);
await shot('ult_kit');
const slots = await p.$$eval('#parts .eq',e=>e.length);
say('kit pieces on screen:', slots);
/* The rows are a read-out now, not buttons. The only way into a slot is
   the piece of kit on Carlton, so that is what this clicks: the first
   hit rect inside that piece's door. A <g> would centre the click
   between the two skates, which is air. */
for (let i=1;i<=slots;i++){
  const part = await p.$eval(`#parts .eq:nth-child(${i}) .pt`, e=>e.textContent);
  const cat  = await p.$eval(`#parts .eq:nth-child(${i}) .pcat`, e=>e.textContent);
  const id   = await p.$eval(`#parts .eq:nth-child(${i})`, e=>e.dataset.id);
  await p.click(`.carl .kitdoor[data-id="${id}"] rect.hitz`); await p.waitForTimeout(500);
  const open = await p.$eval('#pickSheet', e=>e.classList.contains('on'));
  const rows = await p.$$eval('#shList .prow', r=>r.length);
  const avail= await p.$$eval('#shList .prow:not([disabled])', r=>r.length);
  if(i===1) await shot('ult_picker');
  const row = await p.$('#shList .prow:not([disabled])');
  const who = await row.$eval('b',e=>e.textContent);
  await row.click(); await p.waitForTimeout(420);
  const filled = await p.$eval(`#parts .eq:nth-child(${i})`, e=>e.classList.contains('filled'));
  say(`  ${part} (${cat}): sheet ${open?'opened':'FAILED'} · ${rows} skaters, ${avail} available · picked ${who} · slot ${filled?'filled':'EMPTY'} · total ${await txt('#ultTotal')}`);
}
await shot('ult_built');
say('build:', await txt('#ultTotal'), '| vs best real Leaf', await txt('#ultDelta'));
await p.click('#ultSubmit'); await p.waitForTimeout(900);
say('submitted -> CP', await cp());

// ── the other seven ──────────────────────────────────────────────
const play = {
  stormy: async () => {
    for(let i=0;i<3;i++){const r=await p.$('#poolF .brow.live:not(.on)'); if(r){await r.click(); await p.waitForTimeout(140);}}
    for(let i=0;i<2;i++){const r=await p.$('#poolD .brow.live:not(.on)'); if(r){await r.click(); await p.waitForTimeout(140);}}
    say('  lineup:', await txt('#slotState'));
    say('  Stormy iced:', await p.evaluate(()=>STORMY_FIVE.map(x=>x.name.split(' ').pop()).join(', ')));
    await p.click('#stormyGo'); await p.waitForTimeout(400);
    await p.evaluate(()=>CLOCK.seek(3600)); await p.waitForTimeout(600);
    say('  settled:', (await txt('#sFinal')).split('\n').slice(0,3).join(' '), '| cats', await txt('#catScore'));
  },
  guess: async () => {
    say('  clue slots:', await p.$$eval('#gClues .clue',e=>e.length),
        '| open:', await p.$$eval('#gClues .clue:not(.lk)',e=>e.length));
    await p.click('#gMore'); await p.waitForTimeout(400);
    const t=await p.evaluate(()=>gT.name);
    await p.click('#gIn'); await p.type('#gIn', t.split(' ').pop(), {delay:45});
    await p.waitForTimeout(400); await p.click('#gList button'); await p.waitForTimeout(700);
    say('  result:', await txt('#gMsg'));
  },
  luck: async () => {
    const truth=await p.evaluate(()=>lkT.xg60>=.85?'skill':'luck');
    await p.click(`.lkbtn[data-v="${truth}"]`); await p.waitForTimeout(800);
    say('  answered', truth, '->', await txt('#lkMsg'));
  },
  rank: async () => {
    const order=await p.evaluate(()=>[...rkSet].sort((a,b)=>b[rkCat.k]-a[rkCat.k]).map(x=>x.name));
    for(const nm of order){const rows=await p.$$('#rkOpts .prow');
      for(const r of rows){const t=(await r.$eval('b',e=>e.textContent)).trim();
        if(t===nm){await r.click(); await p.waitForTimeout(200); break;}}}
    await p.waitForTimeout(1200);
    say('  result:', (await txt('#rkMsg')).slice(0,60));
  },
  fx: async () => {
    const rows=await p.$$eval('.fxrow',r=>r.length);
    for(let i=0;i<rows;i++){const b=await p.$(`.fxrow:nth-child(${i+1}) .fxb`); if(b){await b.click(); await p.waitForTimeout(70);}}
    say('  picked:', await txt('#fxCount'));
    await p.click('#fxGo'); await p.waitForTimeout(1100);
    say('  locked:', (await txt('#fxState')).slice(0,52));
  },
  bz: async () => {
    await p.click('#bzStart'); await p.waitForTimeout(700);
    for(let i=0;i<7;i++){const b=await p.$('#bzArea .opt:not([disabled])'); if(b){await b.click(); await p.waitForTimeout(700);}}
    say('  score after 7:', await txt('#bzScore'), '| clock', await txt('#bzClock'));
    await p.evaluate(()=>{bzLeft=0;bzTick();}); await p.waitForTimeout(700);
    say('  final:', await txt('#bzScore'));
  },
};
const NAMES={stormy:'02 BEAT STORMY',hl:'03 WHO GOES OFF',guess:'04 GUESS THE LEAF',
  luck:'05 HEAT CHECK',rank:"06 RANK 'EM",fx:"07 PICK'EM",bz:'08 BEAT THE BUZZER'};
for (const k of ['stormy','guess','fx','bz']){
  say('\n=== '+NAMES[k]+' ===');
  await p.click(`nav .navitem[data-t=${k}]`); await p.waitForTimeout(650);
  await shot(k);
  try { await play[k](); say('  -> CP', await cp()); }
  catch(e){ say('  !! FAILED:', e.message.split('\n')[0]); }
  await shot(k+'_done');
}

// ── the live slate games, all settled by the real box score ──────
say('\n=== 03 WHO GOES OFF (live slate) ===');
await p.click('nav .navitem[data-t=hl]'); await p.waitForTimeout(650);
await shot('hl');
say('  head to heads:', await p.evaluate(()=>H2H.length));
say('  first:', await p.evaluate(()=>H2H[0].a.name+' vs '+H2H[0].b.name+' on '+H2H[0].c.l));
for (let i=0;i<6;i++){ const btn=(await p.$$('.vsrow'))[i] && (await (await p.$$('.vsrow'))[i].$$('.h2hp'))[0]; if(btn) await btn.click(); }
await p.waitForTimeout(250);
say('  picked:', await txt('#hlStreak'));
await p.click('#hlGo'); await p.waitForTimeout(300);
await p.evaluate(()=>CLOCK.seek(3600)); await p.waitForTimeout(500);
say('  settled:', (await txt('#hlFinal')).split('\n').slice(0,3).join(' '));
say('  -> CP', await cp());
await shot('hl_done');

say('\n=== 05 HEAT CHECK (live slate) ===');
await p.evaluate(()=>CLOCK.reset());
await p.click('nav .navitem[data-t=luck]'); await p.waitForTimeout(650);
await shot('luck');
say('  lines:', await p.evaluate(()=>HEAT.map(h=>h.r.name+' '+h.c.l+' '+h.ln).join(' | ')));
await p.evaluate(()=>{ HEAT.forEach((h,i)=>heatPick[i]='over'); drawHeat(); });
await p.click('#lkGo'); await p.waitForTimeout(250);
await p.evaluate(()=>CLOCK.seek(3600)); await p.waitForTimeout(500);
say('  settled:', (await txt('#lkFinal')).split('\n').slice(0,3).join(' '));
say('  -> CP', await cp());
await shot('luck_done');

say("\n=== 06 RANK 'EM (live) ===");
await p.evaluate(()=>{ CLOCK.reset(); });
await p.click('nav .navitem[data-t=rank]'); await p.waitForTimeout(650);
await p.evaluate(()=>rkNew()); await p.waitForTimeout(200);
await shot('rank');
say('  ask:', await txt('#rkPrompt'));
for (let i=0;i<4;i++){ const r=(await p.$$('#rkOpts .prow:not(.on)'))[0]; if(!r) break; await r.click(); await p.waitForTimeout(140); }
await p.evaluate(()=>CLOCK.seek(3600)); await p.waitForTimeout(500);
say('  settled:', (await txt('#rkFinal')).split('\n').slice(0,3).join(' '));
say('  -> CP', await cp());
await shot('rank_done');

// ── CALL IT: pick three, drop three pins ─────────────────────────
say('\n=== 10 CALL IT (pin drop) ===');
await p.evaluate(()=>{ CLOCK.reset(); });
await p.click('nav .navitem[data-t=call]'); await p.waitForTimeout(650);
await shot('call');
say('  Toronto goals to aim at:', await p.evaluate(()=>GEO_GOALS.length));
for (const nm of ['Auston Matthews','William Nylander','Matthew Knies']){
  await p.evaluate(n=>{const r=[...document.querySelectorAll('#clPool .prow')].find(x=>x.innerText.includes(n)); if(r) r.click();}, nm);
  await p.waitForTimeout(160);
}
say('  picked:', await txt('#clCount'));
const aim = {'Auston Matthews':[71,-19],'William Nylander':[75,10],'Matthew Knies':[60,0]};
for (const [nm,[fx,fy]] of Object.entries(aim)){
  await p.evaluate(n=>{geoActive=n;geoDraw();}, nm);
  const box = await p.$('#clRink'); const r = await box.boundingBox();
  const pct = await p.evaluate(([x,y])=>[pctX(x),pctY(y)], [fx,fy]);
  await p.mouse.click(r.x + r.width*pct[0]/100, r.y + r.height*pct[1]/100);
  await p.waitForTimeout(160);
}
say('  pins dropped:', await p.evaluate(()=>Object.keys(geoPins).length));
await shot('call_pins');
await p.click('#clGo'); await p.waitForTimeout(300);
await p.evaluate(()=>CLOCK.seek(3600)); await p.waitForTimeout(700);
say('  settled:', (await p.evaluate(()=>Object.entries(geoDone).map(([n,x])=>n.split(' ').pop()+' '+(x.goal?x.dist.toFixed(0)+'ft':'none')).join(', '))));
say('  full time:', (await txt('#clFinal')).split('\n').slice(0,3).join(' '), '-> CP', await cp());
await shot('call_done');

// ── IMMACULATE GRID, all nine squares ────────────────────────────
say('\n=== 09 IMMACULATE GRID ===');
await p.click('nav .navitem[data-t=grid]'); await p.waitForTimeout(800);
say('board:', await txt('#igMeta'));
say('guesses:', await txt('#igLeft'));
await shot('grid_start','#p-grid');
for (let k=0;k<9;k++){
  const cell=await p.$('.igc:not(.hit):not(.done)'); if(!cell) break;
  await cell.click(); await p.waitForTimeout(400);
  if(k===0) say('  the ask:', await txt('#igAsk'));
  const nm=await p.evaluate(()=>{ if(IGs.sel===null) return null;
    const ks=[...IGs.sets[IGs.sel].keys()].filter(i=>!IGs.used.has(i));
    if(!ks.length) return null; ks.sort((a,b)=>IG_P[b].fame-IG_P[a].fame); return IG_P[ks[0]].n;});
  if(!nm){ say('  square',k+1,'no answer left'); break; }
  await p.click('#igIn'); await p.type('#igIn', nm.slice(0,Math.max(4,nm.indexOf(' ')+5)), {delay:35});
  await p.waitForTimeout(400);
  const opt=await p.$('#igList button'); if(!opt){ say('  no suggestion for',nm); break; }
  await opt.click(); await p.waitForTimeout(650);
  say(`  square ${k+1}: ${nm} -> hits ${await txt('#igHits')} · guesses left ${await txt('#igLeft')}`);
}
await p.waitForTimeout(1400);
say('FINAL GRID:', await txt('#igHits'), 'of 9 · rarity', await txt('#igScore'));
await shot('grid_done','#p-grid');

await p.click('nav .navitem[data-t=lb]'); await p.waitForTimeout(800);
say('\nLEADERBOARD rows:', await p.$$eval('#lbBody tr',r=>r.length), '| FINAL CP', await cp());
await shot('leaderboard');
say('\nCONSOLE ERRORS:', errs.length?errs:'none');
await B.close();
writeFileSync(join(SHOTS, 'VERIFY.txt'), L.join('\n'));
srv.close();
