/* The vector Carlton is the fallback if a layer ever goes missing, and it
   has to be the same control: six doors, six tab stops, Enter opens.
   Nothing exercises it in normal play, so it is forced here. */
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
import { chromium } from 'playwright';
const srv=http.createServer((q,s)=>{s.writeHead(200,{'Content-Type':'text/html'});
  s.end(readFileSync(BUILD));});
await new Promise(r=>srv.listen(4685,'127.0.0.1',r));
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:1100}});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
let bad=0; const ok=m=>console.log('   ok       '+m);
const no=m=>{bad++;console.log('   FAIL     '+m);};
// drop one layer before the figure is ever drawn: all seven or none
await p.addInitScript(()=>{ addEventListener('DOMContentLoaded',()=>{},{once:true}); });
await p.goto('http://127.0.0.1:4685/'); await p.waitForTimeout(700);
await p.evaluate(()=>{ delete ART.carl_blk; carlBuilt=false; const h=document.querySelector('#carl'); if(h) h.innerHTML=''; });
await p.evaluate(()=>go('ult')); await p.evaluate(()=>drawParts()); await p.waitForTimeout(500);

const mode = await p.evaluate(()=>document.querySelector('.carlrender')?'render':'vector');
mode==='vector' ? ok('one missing layer drops the whole figure to the vector')
                : no('still on the render with a layer missing');
const doors = await p.evaluate(()=>[...document.querySelectorAll('.carl .kitdoor')]
  .map(d=>({id:d.dataset.id,tab:d.getAttribute('tabindex'),role:d.getAttribute('role'),
            named:!!d.getAttribute('aria-label')})));
const ids=doors.map(d=>d.id).sort().join(',');
ids==='a,blk,g,hit,sog,tk' ? ok('six doors on the vector too, one per piece')
                           : no('vector doors are ['+ids+']');
doors.every(d=>d.tab==='0'&&d.role==='button'&&d.named)
  ? ok('each focusable, named and roled') : no('a vector door is mute');
// a piece with two halves: only one is a stop, but both still click
const halves = await p.evaluate(()=>document.querySelectorAll('.carl g.kitp[data-id="tk"]').length);
console.log('   note     the skates are ' + halves + ' groups, ' +
  (await p.evaluate(()=>document.querySelectorAll('.carl .kitdoor[data-id="tk"]').length)) + ' tab stop');
await p.evaluate(()=>document.querySelector('.carl').scrollIntoView({block:'center'}));
await p.click('.carl g.kitp[data-id="blk"] rect.hitz'); await p.waitForTimeout(400);
await p.evaluate(()=>$('#pickSheet').classList.contains('on'))
  ? ok('clicking a half opens that piece') : no('clicking a vector piece opened nothing');
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
await p.evaluate(()=>{const d=document.querySelector('.carl .kitdoor[data-id="g"]'); d.focus();});
await p.keyboard.press('Enter'); await p.waitForTimeout(400);
await p.evaluate(()=>$('#pickSheet').classList.contains('on'))
  ? ok('Enter on a focused vector piece opens it') : no('Enter did nothing on the vector');
await p.keyboard.press('Escape'); await p.waitForTimeout(250);
const rings = await p.evaluate(()=>document.querySelectorAll('.carl .kitpin.ask').length);
rings===6 ? ok('six rings on the empty vector as well') : no(rings+' rings, expected 6');
if (errs.length){ bad++; console.log('   FAIL     js errors: '+errs.join(' | ')); }
console.log('\n'+(bad?bad+' FAILURES':'the fallback is the same control as the render'));
await b.close(); srv.close(); process.exit(bad?1:0);
