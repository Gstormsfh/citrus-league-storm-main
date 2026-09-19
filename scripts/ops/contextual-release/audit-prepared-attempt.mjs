// Read-only cloud evidence retrieval. No SQL, approvals, retries or publication.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const bucket='citrus-fantasy-prod-research-evidence';
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const artifactNames=new Set(['attempt-manifest.json','candidate.exact.json','schedule.json','context.review.json','completion-request.exact.json']);

export function validateInventory(execution,items){
 assert.match(execution,/^citrus-contextual-production-[a-z0-9-]+$/);
 const prefix=`contextual-worker/production-attempts/${execution}/`,seen=new Set();
 let size=0;
 assert.ok(Array.isArray(items)&&items.length>0&&items.length<2000);
 for(const item of items){
  assert.ok(item.name.startsWith(prefix));
  const name=item.name.slice(prefix.length);
  assert.ok(artifactNames.has(name)||/^event-\d{6}\.json$/.test(name));
  assert.ok(!seen.has(name));seen.add(name);
  assert.match(item.generation,/^\d+$/);
  assert.equal(item.metadata?.scope,'production-operations');
  assert.match(item.metadata?.sha256??'',/^[a-f0-9]{64}$/);
  const bytes=Number(item.size);assert.ok(Number.isSafeInteger(bytes)&&bytes>0&&bytes<256*1024*1024);
  size+=bytes;
 }
 assert.ok(size<512*1024*1024);
 return {prefix,bytes:size};
}

export function verifyJournal(execution,items,contents,mode='prepared'){
 assert.ok(['prepared','published'].includes(mode));
 const {prefix,bytes}=validateInventory(execution,items);
 const objects=new Map();
 for(const item of items){
  const name=item.name.slice(prefix.length),raw=contents.get(name);
  assert.ok(Buffer.isBuffer(raw));assert.equal(raw.length,Number(item.size));
  assert.equal(hash(raw),item.metadata.sha256,'Remote metadata must match downloaded bytes');
  objects.set(name,item);
 }
 const events=[...objects.keys()].filter(n=>n.startsWith('event-')).sort().map((name,index)=>{
  const e=JSON.parse(contents.get(name));assert.equal(name,`event-${String(index+1).padStart(6,'0')}.json`);
  assert.equal(e.sequence,index+1);assert.ok(Number.isFinite(Date.parse(e.at)));return e;
 });
 assert.ok(events.length);
 for(let i=1;i<events.length;i++)assert.ok(Date.parse(events[i].at)>=Date.parse(events[i-1].at));
 const last=events.at(-1);
 assert.ok((mode==='prepared'?['prepared']:['success','already_active']).includes(last.status),'Expected terminal attempt state required');
 const completion=events.find(e=>e.stage==='completion'&&e.status===(mode==='prepared'?'prepared':'started'));
 if(completion){
  const request=objects.get('completion-request.exact.json');assert.ok(request);
  assert.equal(request.metadata.sha256,completion.request_sha256);
  assert.ok(Date.parse(request.timeCreated)<=Date.parse(completion.at),'Remote request must exist before completion begins');
 }
 assert.ok(completion);for(const name of artifactNames)assert.ok(objects.has(name));
 assert.equal(last.stage,'completion');
 const manifest=JSON.parse(contents.get('attempt-manifest.json'));
 assert.equal(manifest.execution,execution);assert.equal(manifest.status,mode==='prepared'?'awaiting_publication':last.status);
 assert.equal(manifest.policy_sha256,'26893b8573829ac1b52f4b9be8284eae416f7d1a0d648b9f2a8fceaa06226bbd');
 assert.equal(Object.keys(manifest.files_sha256).length,objects.size-1);
 for(const [name,sha] of Object.entries(manifest.files_sha256))assert.equal(objects.get(name)?.metadata.sha256,sha);
 assert.ok(!events.some(e=>['failed','uncertain','conflict'].includes(e.status)));
 if(mode==='published'){
  assert.match(last.result?.revision??'',/^[a-f0-9]{64}$/);
  assert.equal(last.request_sha256,completion.request_sha256);
 }
 const start=events.find(e=>e.stage==='prepare'&&e.status==='started');
 const prepared=events.find(e=>e.stage==='prepare'&&e.status==='complete');
 return {status:'PASS',execution,readOnly:true,publicationReady:false,objects:items.length,bytes,
  finalStatus:last.status,finalStage:last.stage,firstEventAt:events[0].at,lastEventAt:last.at,
  preparationMilliseconds:start&&prepared?Date.parse(prepared.at)-Date.parse(start.at):null,
  exactRequestPersistedBeforeCompletion:Boolean(completion),
  ...(mode==='published'?{revision:last.result.revision,completionMilliseconds:Date.parse(last.at)-Date.parse(completion.at)}:{}),
  files:items.map(i=>({name:i.name.slice(prefix.length),generation:i.generation,sha256:i.metadata.sha256,size:Number(i.size),createdAt:i.timeCreated}))};
}

async function main(){
 const [execution,out,mode='prepared']=process.argv.slice(2);assert.match(execution??'',/^citrus-contextual-production-[a-z0-9-]+$/);
 assert.ok(out&&!existsSync(out),'New private output directory required');
 const token=execFileSync('gcloud',['auth','print-access-token'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const headers={Authorization:`Bearer ${token}`};
 const request=async url=>{const r=await fetch(url,{headers,signal:AbortSignal.timeout(120000),redirect:'error'});assert.ok(r.ok,`Cloud read failed: ${r.status}`);return r;};
 const list=new URL(`https://storage.googleapis.com/storage/v1/b/${bucket}/o`);
 list.searchParams.set('prefix',`contextual-worker/production-attempts/${execution}/`);
 list.searchParams.set('maxResults','1000');
 const items=[];
 do{const r=await(await request(list)).json();items.push(...(r.items??[]));if(!r.nextPageToken)break;assert.ok(items.length<2000);list.searchParams.set('pageToken',r.nextPageToken);}while(true);
 const {prefix}=validateInventory(execution,items);const contents=new Map();let next=0;
 await Promise.all(Array.from({length:4},async()=>{
  while(next<items.length){const item=items[next++],url=new URL(`https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(item.name)}`);
   url.searchParams.set('alt','media');url.searchParams.set('generation',item.generation);
   contents.set(item.name.slice(prefix.length),Buffer.from(await(await request(url)).arrayBuffer()));}
 }));
 const receipt=verifyJournal(execution,items,contents,mode);
 mkdirSync(out,{recursive:true,mode:0o700});
 for(const [name,raw] of contents)writeFileSync(`${out}/${name}`,raw,{flag:'wx',mode:0o600});
 writeFileSync(`${out}/cloud-receipt.json`,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
 const {files,...summary}=receipt;console.log(JSON.stringify(summary));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{
 console.error(JSON.stringify({status:'FAILED',errorType:error.name}));process.exitCode=1;
});
