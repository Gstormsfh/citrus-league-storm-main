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
test('Edmonton opening-night access extends beyond September 30 UTC midnight',()=>{
 const [s,p]=fixture();
 for(const value of [p,s.source_release_review,s.finishing_refresh_policy,s.players[0].availability_scenario])value.review_after='2026-09-30';
 assert.equal(reviewCoverage(s,p,'2026-09-29').blockers.length,0);
 const r=reviewCoverage(s,p,'2026-09-29T23:59:59-06:00');
 assert.equal(r.requestedThroughInclusive,'2026-09-30T05:59:59.000Z');
 assert.equal(r.blockers.length,4);
 assert.deepEqual(r.blockers,reviewCoverage(s,p,'2026-09-30T05:59:59Z').blockers);
});
test('timezone-free timestamps and invalid review dates cannot imply coverage',()=>{
 const [s,p]=fixture();
 for(const when of ['2026-09-29T23:59:59','2026-02-30','2026-02-30T12:00:00Z'])assert.throws(()=>reviewCoverage(s,p,when));
 p.review_after='2026-02-30';assert.throws(()=>reviewCoverage(s,p,'2026-09-29'));
});
