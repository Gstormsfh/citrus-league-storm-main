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
import { chromium } from 'playwright';
const SCORE = `(() => {
  const px=s=>{const m=s.match(/[\\d.]+/g);if(!m)return null;return [+m[0],+m[1],+m[2],m[3]===undefined?1:+m[3]];};
  const over=(f,b)=>{const a=f[3];return [0,1,2].map(i=>f[i]*a+b[i]*(1-a)).concat([1]);};
  const lum=c=>{const s=c.slice(0,3).map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});return .2126*s[0]+.7152*s[1]+.0722*s[2];};
  const ratio=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((m,n)=>n-m);return (x+.05)/(y+.05);};
  const gradAvg=bi=>{ if(!bi||bi==='none'||!/gradient/.test(bi))return null;
    const st=bi.match(/rgba?\\([^)]+\\)/g); if(!st)return null;
    const cs=st.map(px).filter(Boolean); if(!cs.length)return null;
    const a=cs.reduce((s,c)=>s+c[3],0)/cs.length; if(a<=0)return null;
    const w=cs.reduce((s,c)=>s+c[3],0)||1;
    return [0,1,2].map(i=>cs.reduce((s,c)=>s+c[i]*c[3],0)/w).concat([a]); };
  const effBg=el=>{const st=[];let n=el;
    while(n){const cs=getComputedStyle(n);
      const g=gradAvg(cs.backgroundImage); if(g)st.push(g);
      const c=px(cs.backgroundColor); if(c&&c[3]>0)st.push(c); n=n.parentElement;}
    st.push([0,0,0,1]); let acc=st[st.length-1];
    for(let i=st.length-2;i>=0;i--)acc=over(st[i],acc); return acc;};
  let measured=0, svgSeen=0; const fails=[];
  for (const el of document.querySelectorAll('*')){
    if (el.children.length) continue;
    // SVG <text> has NO innerText -- it is undefined, so the old loop skipped
    // every chart label silently and reported a clean sweep over nothing. And
    // its paint comes from fill, not color: reading color returns the
    // inherited ink and flatters the ratio. Handle both.
    const isSvg = el.ownerSVGElement != null || el.namespaceURI === 'http://www.w3.org/2000/svg';
    const t=((el.innerText != null ? el.innerText : el.textContent)||'').trim();
    if(!t||t.length>60) continue;
    const r=el.getBoundingClientRect(); if(r.width<4||r.height<4) continue;
    const cs=getComputedStyle(el);
    if(cs.visibility==='hidden'||cs.display==='none'||+cs.opacity===0) continue;
    const paint = isSvg ? (cs.fill && cs.fill !== 'none' ? cs.fill : cs.color) : cs.color;
    const fg=px(paint); if(!fg) continue;
    if (isSvg) svgSeen++;
    measured++;
    const bg=effBg(el), cr=ratio(over(fg,bg),bg);
    const size=parseFloat(cs.fontSize), bold=+cs.fontWeight>=700;
    const need=(size>=24||(size>=18.66&&bold))?3:4.5;
    const overArt = !!el.closest('.art, .tile');
    if (cr<need) fails.push({text:t.slice(0,26),cr:+cr.toFixed(2),need,size:Math.round(size),
      color:cs.color,bg:'rgb('+bg.slice(0,3).map(Math.round).join(',')+')',
      cls:String(el.className.baseVal != null ? el.className.baseVal : el.className).slice(0,40), overArt});
  }
  return {measured, fails, svgSeen};
})()`;
const b = await chromium.launch({args:['--no-sandbox']});
for (const [w,label] of [[1400,'desktop'],[400,'mobile']]){
  const p = await (await b.newContext({viewport:{width:w,height:1100}})).newPage();
  await p.goto(BUILD_URL,{waitUntil:'load'});
  const SKIN = process.env.SKIN || 'mascot';
  await p.evaluate(s => document.documentElement.setAttribute('data-skin', s), SKIN);
  await p.waitForTimeout(800);
  for (const tab of ['home','ult','stormy','hl','guess','luck','rank','fx','bz','grid','gridDONE','dash','lb']){
        const real = tab === 'gridDONE' ? 'grid' : tab;
    await p.evaluate(t=>go(t), real); await p.waitForTimeout(400);
    if (tab === 'gridDONE') {
      // drive the grid into its finished state so the filled, missed and
      // share-card colours get measured too -- an empty board proves nothing
      await p.evaluate(() => {
        igNew(0);
        for (let k=0;k<8;k++){ IGs.sel = k; igGuess([...IGs.sets[k].keys()][0]); }
        IGs.left = 0; igOver();   // last square reveals its most-picked answer
      });
      await p.waitForTimeout(400);
    }
    if (process.env.FAULT) { await p.addStyleTag({content: process.env.FAULT}); await p.waitForTimeout(250); }
    await p.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=700){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,60));}window.scrollTo(0,0);});
    const {measured,fails,svgSeen} = await p.evaluate(SCORE);
    const seen=new Set(); const u=fails.filter(f=>{const k=f.cls+f.cr;if(seen.has(k))return false;seen.add(k);return true;});
    u.sort((a,b)=>a.cr-b.cr);
    const thin = measured<40 ? '  <-- THIN, result not meaningful' : '';
    console.log(`${label} /${tab}  measured=${String(measured).padStart(4)} (svg ${String(svgSeen).padStart(2)}) fail=${String(fails.length).padStart(3)} distinct=${u.length}${thin}`);
    for (const f of u.slice(0,6))
      console.log(`    ${String(f.cr).padStart(5)} (${f.need}) ${String(f.size+'px').padStart(5)} ${JSON.stringify(f.text).padEnd(28)} ${f.color} on ${f.bg} | ${f.cls}${f.overArt?'  [OVER ART - measured bg is wrong, eyeball it]':''}`);
  }
  await p.close();
}
await b.close();
