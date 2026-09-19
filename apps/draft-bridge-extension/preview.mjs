// Build a separate unpacked LOCAL preview. Never widens production permissions.
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {buildCompanion} from './build.mjs';
import {preparePreviewBundles} from './prepare-preview.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const port=8776,origin=`http://127.0.0.1:${port}`;
const out=await mkdtemp(join(tmpdir(),'citrus-draft-bridge-preview-'));
await buildCompanion(out);
const manifest=JSON.parse(await readFile(join(here,'manifest.json'),'utf8'));
manifest.name='Citrus Draft Connection LOCAL Preview';
manifest.externally_connectable.matches=[`${origin}/draft-kit*`,`${origin}/create-league*`];
await writeFile(join(out,'manifest.json'),JSON.stringify(manifest,null,2));
await writeFile(join(out,'config.mjs'),`export const RECEIVER_ORIGIN=${JSON.stringify(origin)};\nexport const RECEIVER_PATH='/draft-kit';\n`);
const args=process.argv.slice(2);if(args.length&&![4,5].includes(args.length))throw Error('Pass kit HTML, editorial directory, observed identities JSON, canonical directory JSON and optional reviewed exceptions JSON.');
const coverage=args.length?await preparePreviewBundles(out,...args):null;
const assets={'/draft-kit':['qa-handoff.html','text/html'],'/create-league':['qa-handoff.html','text/html'],'/qa-handoff.mjs':['qa-handoff.mjs','text/javascript'],'/receiver.css':['receiver.css','text/css'],...(coverage?{'/qa-espn.json':['qa-espn.json','application/json',out],'/qa-yahoo.json':['qa-yahoo.json','application/json',out]}:{})};
const server=createServer(async(req,res)=>{
 const asset=assets[new URL(req.url,origin).pathname];
 if(req.method!=='GET'||!asset){res.writeHead(404);res.end('Not found');return;}
 try{const body=await readFile(join(asset[2]??here,asset[0]));res.writeHead(200,{'Content-Type':`${asset[1]}; charset=utf-8`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});res.end(body);}catch{res.writeHead(500);res.end('Preview unavailable');}
});
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({unpackedExtension:out,reviewUrl:`${origin}/draft-kit`,coverage},null,2)));
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
