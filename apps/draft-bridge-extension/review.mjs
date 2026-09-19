// Local component acceptance only, with visibly simulated picks. This is not
// an entitlement bypass and cannot hand a bundle to an installed extension.
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {buildCompanion} from './build.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=join(here,'../..');
const source=process.argv[2],editorial=process.argv[3];
if(!source||!editorial)throw Error('Pass a reviewed draft-desk HTML and its editorial directory.');
const out=await mkdtemp(join(tmpdir(),'citrus-sidebar-ui-review-'));
await buildCompanion(out);
await build({entryPoints:[join(root,'server/src/services/BrowserDraftResearchService.ts')],bundle:true,outfile:join(out,'research.mjs'),platform:'node',format:'esm'});
const {attachBrowserResearch}=await import(pathToFileURL(join(out,'research.mjs')));
const html=await readFile(source,'utf8'),match=/<script id="kit-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
if(!match)throw Error('Reviewed kit data missing.');
const original=JSON.parse(match[1]);
const [library,context,deployment]=await Promise.all(['player-story-library.json','player-season-context.json','deployment-research.json'].map(n=>readFile(join(editorial,n),'utf8')));
const kit=attachBrowserResearch(original,JSON.parse(library),JSON.parse(context),createHash('sha256').update(deployment).digest('hex'));
const bundle={version:1,platform:'espn',scoringVerified:false,file:{kind:'citrus-connected-desk',version:1,kit,progress:{version:1,fingerprint:kit.fingerprint,rows:[]}},mappings:kit.players.map((p,i)=>({key:p.key,externalPlayerId:String(900000+i)}))};
await writeFile(join(out,'review-bundle.json'),JSON.stringify(bundle));
await build({entryPoints:[join(here,'review-entry.tsx')],bundle:true,outfile:join(out,'review.js'),platform:'browser',format:'esm',target:'chrome120',jsx:'automatic',alias:{'@':join(root,'apps/web/src')},tsconfig:join(root,'apps/web/tsconfig.app.json'),define:{'process.env.NODE_ENV':'"production"','import.meta.env.VITE_NATIVE':'"0"'}});
const head='<meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>Citrus companion interaction review</title>';
const panel=head+'<link rel="stylesheet" href="/sidepanel.css"><div style="padding:8px;background:#fff1d8;font:12px Arial"><strong>LOCAL TEST · SIMULATED PICKS</strong><div><button id="pick">Simulate next pick</button> <button id="undo">Undo test pick</button> <button id="connection">Toggle connection</button></div></div><div id="root"></div><script type="module" src="/review.js"></script>';
const index=head+'<style>body{margin:0;background:#e6ebdf;color:#10291f;font:18px Arial;padding:36px}main{display:flex;gap:48px;align-items:start}aside{max-width:430px}iframe{width:420px;height:880px;border:1px solid #334a3b;border-radius:16px;background:#f8f5ec}h1{font-size:40px}li{margin:18px 0}a{color:inherit}</style><main><aside><p>CITRUS / DOCKED COMPANION REVIEW</p><h1>Your next pick, in focus.</h1><p>This runs the actual packaged sidebar component at sidebar width using the reviewed kit edition. The draft events are simulated, not ESPN or Yahoo live verification.</p><ul><li>Search players and build a shortlist</li><li>Open a player for projections and authored Citrus research</li><li>Compare 2–10 players, with charts and fantasy scoring impact</li><li>Test confirmed-pick removal, undo and interrupted connections</li></ul><p>No customer league or purchase is involved.</p><a href="/panel">Open full-width component review</a></aside><iframe title="Actual Citrus sidebar component" src="/panel"></iframe></main>';
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;const assets={'/review.js':['review.js','text/javascript'],'/sidepanel.css':['sidepanel.css','text/css'],'/review-bundle.json':['review-bundle.json','application/json']};
 if(req.method!=='GET'||(!['/','/panel'].includes(path)&&!assets[path])){res.writeHead(404);res.end();return;}
 const asset=assets[path];res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',asset?asset[1]+'; charset=utf-8':'text/html; charset=utf-8');res.end(asset?await readFile(join(out,asset[0])):path==='/panel'?panel:index);
});
server.listen(8786,'127.0.0.1',()=>console.log(JSON.stringify({url:'http://127.0.0.1:8786/',out,players:kit.players.length,withResearch:kit.players.filter(p=>p.research?.length).length})));
