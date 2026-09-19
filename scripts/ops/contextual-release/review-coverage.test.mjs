import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewCoverage} from './review-coverage.mjs';
function fixture(){const review={reviewed_at:'2026-09-18',review_after:'2026-09-21'};return [{revision:'a',source_release_review:{...review},finishing_refresh_policy:{...review},players:[{player_id:'1',name:'Player',availability_scenario:{...review,review_after:'2026-09-29'}}]},{...review,source_revision:'a'}];}
test('changing only the operational expiry does not cover the source or availability',()=>{
 const [s,p]=fixture();p.review_after='2026-09-30';const r=reviewCoverage(s,p,'2026-09-29');
 assert.equal(r.blockers.length,3);assert.equal(r.earliestExpiryExclusive,'2026-09-21');assert.equal(r.customerReady,false);
});
test('expiry is exclusive, including the paid final day',()=>{
 const [s,p]=fixture();assert.equal(reviewCoverage(s,p,'2026-09-20').blockers.length,0);
 assert.equal(reviewCoverage(s,p,'2026-09-21').blockers.length,3);
 assert.equal(reviewCoverage(s,p,'2026-09-29').blockers.length,4);
});
test('missing source review or wrong source fails closed without inventing dates',()=>{
 const [s,p]=fixture();delete s.finishing_refresh_policy;assert.throws(()=>reviewCoverage(s,p,'2026-09-29'));
 assert.throws(()=>reviewCoverage({...s,revision:'b'},p,'2026-09-29'));
});
