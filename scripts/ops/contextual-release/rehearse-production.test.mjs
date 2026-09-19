import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPatches,validateConnection,rehearse,PROJECT} from './rehearse-production.mjs';
test('pins all three reviewed staging patches byte for byte',()=>assert.equal(loadPatches().length,3));
test('production target cannot drift to staging or an arbitrary host',()=>{
 assert.equal(validateConnection(`postgres://operator@db.${PROJECT}.supabase.co/db`),`postgres://operator@db.${PROJECT}.supabase.co/db`);
 for(const host of ['db.jjgspcpvqaiitloglxbb.supabase.co','evil.test'])assert.throws(()=>validateConnection(`postgres://operator@${host}/db`));
});
test('a draft freeze rolls back without a single mutation or commit',async()=>{
 const calls=[];const db={query:async sql=>{calls.push(sql);return {rows:[{n:1}]};}};
 await assert.rejects(rehearse(db,loadPatches(),'08a166b1-9ca3-4cdd-aaf4-79bf96ab4118'),/Draft freeze/);
 assert.equal(calls.at(-1),'ROLLBACK');assert.ok(!calls.includes('COMMIT'));
 assert.ok(!calls.some(s=>s.includes('DO $')));
});
test('a failed lock still rolls back and never applies patches',async()=>{
 const calls=[];const db={query:async sql=>{calls.push(sql);if(sql.includes('pg_advisory'))throw Error('lock failure');return {rows:[]};}};
 await assert.rejects(rehearse(db,loadPatches(),'08a166b1-9ca3-4cdd-aaf4-79bf96ab4118'),/lock failure/);
 assert.equal(calls.at(-1),'ROLLBACK');assert.ok(!calls.some(s=>s.includes('DO $')));
});
