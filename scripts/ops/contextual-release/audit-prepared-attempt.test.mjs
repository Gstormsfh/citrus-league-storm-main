import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from './rehearse-production.mjs';
import {verifyJournal} from './audit-prepared-attempt.mjs';
function fixture(){
 const execution='citrus-contextual-production-fixture',prefix='contextual-worker/production-attempts/'+execution+'/';
 const contents=new Map(['candidate.exact.json','schedule.json','context.review.json','completion-request.exact.json'].map(n=>[n,Buffer.from('{"exact":0.12345678901234567890}') ]));
 const event={sequence:1,stage:'completion',status:'prepared',at:'2026-09-19T05:00:00Z',request_sha256:hash(contents.get('completion-request.exact.json'))};
 contents.set('event-000001.json',Buffer.from(JSON.stringify(event)));
 contents.set('attempt-manifest.json',Buffer.from(JSON.stringify({execution,status:'awaiting_publication',
  policy_sha256:'26893b8573829ac1b52f4b9be8284eae416f7d1a0d648b9f2a8fceaa06226bbd',
  files_sha256:Object.fromEntries([...contents].map(([n,b])=>[n,hash(b)]))})));
 const items=[...contents].map(([name,raw])=>({name:prefix+name,size:String(raw.length),generation:'1',
  timeCreated:'2026-09-19T04:59:00Z',metadata:{scope:'production-operations',sha256:hash(raw)}}));
 return {execution,contents,items};
}
test('prepared journal proves durable bytes but never claims publication',()=>{
 const f=fixture(),r=verifyJournal(f.execution,f.items,f.contents);assert.equal(r.status,'PASS');
 assert.equal(r.finalStatus,'prepared');assert.equal(r.publicationReady,false);
});
for(const fault of ['tamper','missing-manifest','wrong-scope','wrong-prefix','late-request'])test('prepared journal rejects '+fault,()=>{
 const f=fixture();
 if(fault==='tamper')f.contents.set('candidate.exact.json',Buffer.from('{}'));
 if(fault==='missing-manifest')f.contents.delete('attempt-manifest.json');
 if(fault==='wrong-scope')f.items[0].metadata.scope='staging-only';
 if(fault==='wrong-prefix')f.items[0].name='other/private';
 if(fault==='late-request')f.items.find(i=>i.name.endsWith('completion-request.exact.json')).timeCreated='2026-09-19T05:01:00Z';
 assert.throws(()=>verifyJournal(f.execution,f.items,f.contents));
});
function publishedFixture(){
 const f=fixture();
 const event=JSON.parse(f.contents.get('event-000001.json'));event.status='started';
 f.contents.set('event-000001.json',Buffer.from(JSON.stringify(event)));
 f.contents.set('event-000002.json',Buffer.from(JSON.stringify({...event,sequence:2,status:'success',at:'2026-09-19T05:00:35Z',result:{revision:'a'.repeat(64)}})));
 const manifest=JSON.parse(f.contents.get('attempt-manifest.json'));manifest.status='success';
 manifest.files_sha256=Object.fromEntries([...f.contents].filter(([n])=>n!=='attempt-manifest.json').map(([n,b])=>[n,hash(b)]));
 f.contents.set('attempt-manifest.json',Buffer.from(JSON.stringify(manifest)));
 const prefix='contextual-worker/production-attempts/'+f.execution+'/';
 f.items=[...f.contents].map(([n,b])=>({name:prefix+n,generation:'1',size:String(b.length),timeCreated:'2026-09-19T04:59:00Z',metadata:{scope:'production-operations',sha256:hash(b)}}));
 return f;
}
test('published worker audit binds exact request to successful completion and duration',()=>{
 const f=publishedFixture(),r=verifyJournal(f.execution,f.items,f.contents,'published');
 assert.equal(r.revision,'a'.repeat(64));assert.equal(r.completionMilliseconds,35000);assert.equal(r.publicationReady,false);
});
test('preparation and publication audit modes cannot substitute for each other',()=>{
 const p=publishedFixture(),f=fixture();
 assert.throws(()=>verifyJournal(p.execution,p.items,p.contents));
 assert.throws(()=>verifyJournal(f.execution,f.items,f.contents,'published'));
});
