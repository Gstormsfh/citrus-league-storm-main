// Build a separate unpacked LOCAL preview. Never widens production permissions.
import {mkdtemp,readFile,writeFile,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
const here=dirname(fileURLToPath(import.meta.url));
const port=8776,origin=`http://127.0.0.1:${port}`;
const out=await mkdtemp(join(tmpdir(),'citrus-draft-bridge-preview-'));
for(const name of ['capture.mjs','worker.mjs','popup.mjs','popup.html','popup.css'])await copyFile(join(here,name),join(out,name));
const manifest=JSON.parse(await readFile(join(here,'manifest.json'),'utf8'));
manifest.name='Citrus Draft Connection LOCAL Preview';
manifest.externally_connectable.matches=[`${origin}/draft-kit*`];
await writeFile(join(out,'manifest.json'),JSON.stringify(manifest,null,2));
await writeFile(join(out,'config.mjs'),`export const RECEIVER_ORIGIN=${JSON.stringify(origin)};\nexport const RECEIVER_PATH='/draft-kit';\n`);
const assets={'/draft-kit':['receiver.html','text/html'],'/receiver.mjs':['receiver.mjs','text/javascript'],'/receiver.css':['receiver.css','text/css']};
const server=createServer(async(req,res)=>{
 const asset=assets[new URL(req.url,origin).pathname];
 if(req.method!=='GET'||!asset){res.writeHead(404);res.end('Not found');return;}
 try{const body=await readFile(join(here,asset[0]));res.writeHead(200,{'Content-Type':`${asset[1]}; charset=utf-8`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});res.end(body);}catch{res.writeHead(500);res.end('Preview unavailable');}
});
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({unpackedExtension:out,reviewUrl:`${origin}/draft-kit`},null,2)));
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
