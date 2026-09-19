/** Local real export-service/worker acceptance, not a purchase or publication. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {DraftKitExportService,DOWNLOADS} from '../../server/src/services/DraftKitExportService.ts';
const [python,dataArg,sourceArg,editorialArg,outArg]=process.argv.slice(2);
if(!outArg)throw Error('Usage: PYTHON DATA SOURCE_ROOT EDITORIAL_ROOT NEW_OUTPUT');
const out=resolve(outArg),dataPath=resolve(dataArg),data=JSON.parse(await readFile(dataPath,'utf8'));
// Process-local fixture setting only. Never changes deployed readiness.
process.env.DRAFT_KIT_PDF_READY='true';
const service=new DraftKitExportService(python,dataPath,resolve(sourceArg),resolve(editorialArg));
await mkdir(out); // Refuse to overwrite an earlier acceptance run.
const config=await service.configuration();
if(config.revision!==data.canonicalRevision)throw Error('Configuration revision differs');
const artifacts=[];
for(const format of ['csv','desk','tracker','cheatsheet','pdf'] as const){
 const started=Date.now(),bytes=await service.download(format,'Citrus acceptance league',data.weights);
 const path=resolve(out,DOWNLOADS[format][0]);await writeFile(path,bytes,{flag:'wx'});
 artifacts.push({format,path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),milliseconds:Date.now()-started});
 console.log(JSON.stringify(artifacts.at(-1)));
}
const connected=await service.connected('Citrus acceptance league',data.weights);
if(connected.revision!==config.revision||connected.players.length!==300)throw Error('Offline handoff revision/coverage differs');
await writeFile(resolve(out,'connected.json'),JSON.stringify(connected,null,2),{flag:'wx'});
await writeFile(resolve(out,'receipt.json'),JSON.stringify({status:'PASS',scope:'Actual local export service and Python workers; no HTTP purchase, live publication or deployed readiness change',revision:config.revision,artifacts,players:connected.players.length},null,2),{flag:'wx'});
