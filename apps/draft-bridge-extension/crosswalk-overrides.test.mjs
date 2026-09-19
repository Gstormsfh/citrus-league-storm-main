import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {reviewedIdentityExceptions} from './crosswalk-overrides.mjs';
const json=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
const observations=await json('../../docs/evidence/browser-provider-identities-20260919.json');
const directory=await json('../../docs/evidence/browser-canonical-directory-20260919.json');
const review=await json('../../docs/evidence/browser-reviewed-id-exceptions-20260919.json');
const players=review.entries.map(r=>({key:r.key}));
test('six explicit exceptions agree with both saved identity snapshots',()=>{
 for(const platform of ['espn','yahoo']){const rows=reviewedIdentityExceptions(review,platform,observations[platform],directory,players);assert.equal(rows.length,3);assert.ok(rows.every(r=>r.matchMethod==='manual'));assert.equal(new Set(rows.map(r=>r.nhlPlayerId)).size,3);}
});
test('absence of reviewed exceptions never invents an alias',()=>assert.deepEqual(reviewedIdentityExceptions(null,'espn',observations.espn,directory,players),[]));
test('changed provider name, position or canonical team invalidates the exception',()=>{
 for(const change of [r=>r.entries[0].observed.name='Someone else',r=>r.entries[0].observed.position='D',r=>r.entries[0].canonical.team='BOS']){const r=structuredClone(review);change(r);assert.throws(()=>reviewedIdentityExceptions(r,'espn',observations.espn,directory,players));}
});
test('duplicate identities, missing evidence and off-board players fail review',()=>{
 let r=structuredClone(review);r.entries.push(r.entries[0]);assert.throws(()=>reviewedIdentityExceptions(r,'espn',observations.espn,directory,players));
 r=structuredClone(review);r.entries[0].evidence=[];assert.throws(()=>reviewedIdentityExceptions(r,'espn',observations.espn,directory,players));
 assert.throws(()=>reviewedIdentityExceptions(review,'espn',observations.espn,directory,[]));
});
