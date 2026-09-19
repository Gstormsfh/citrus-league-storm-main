// Development-only fixtures for installed-extension acceptance. Uses observed
// public provider IDs, never synthetic IDs or a production purchase bypass.
import {readFile,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {build} from 'esbuild';
const here=dirname(fileURLToPath(import.meta.url));
export async function preparePreviewBundles(out,kitPath,editorial,identities,directory,exceptions){
 const {stdout}=await promisify(execFile)(process.execPath,[join(here,'crosswalk-review.mjs'),identities,kitPath,directory,...(exceptions?[exceptions]:[])],{maxBuffer:8_000_000});
 const review=JSON.parse(stdout),html=await readFile(kitPath,'utf8');
 const kit=JSON.parse(/<script id="kit-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)?.[1]??'null');
 if(!kit?.players?.length)throw Error('Reviewed kit missing.');
 await build({entryPoints:[join(here,'../../server/src/services/BrowserDraftResearchService.ts')],bundle:true,outfile:join(out,'qa-research.mjs'),format:'esm',platform:'node'});
 const {attachBrowserResearch}=await import(pathToFileURL(join(out,'qa-research.mjs')));
 const [library,context,deployment]=await Promise.all(['player-story-library.json','player-season-context.json','deployment-research.json'].map(n=>readFile(join(editorial,n),'utf8')));
 const authored=attachBrowserResearch(kit,JSON.parse(library),JSON.parse(context),createHash('sha256').update(deployment).digest('hex'));
 const coverage={};
 for(const platform of ['espn','yahoo']){
  const mapping=review.platforms[platform].mappings.map(({key,externalPlayerId})=>({key,externalPlayerId}));
  const players=authored.players.filter(p=>mapping.some(m=>m.key===p.key));
  if(!players.length||new Set(mapping.map(m=>m.key)).size!==mapping.length)throw Error('QA mapping is empty or ambiguous.');
  const board={...authored,league:`LOCAL QA: ${players.length} of ${kit.players.length} players`,players};
  board.fingerprint=createHash('sha256').update(JSON.stringify({...board,fingerprint:undefined})).digest('hex');
  const bundle={version:1,platform,scoringVerified:false,file:{kind:'citrus-connected-desk',version:1,kit:board,progress:{version:1,fingerprint:board.fingerprint,rows:[]}},mappings:mapping};
  await writeFile(join(out,`qa-${platform}.json`),JSON.stringify({developmentOnly:true,coverage:{included:players.length,total:kit.players.length,omitted:review.platforms[platform].missing.map(p=>p.name)},bundle}));
  coverage[platform]={included:players.length,total:kit.players.length};
 }
 return coverage;
}
