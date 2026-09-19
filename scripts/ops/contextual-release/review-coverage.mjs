// Read-only successor-policy planning. Never renew dates or authorize a source.
import assert from 'node:assert/strict';
export function reviewCoverage(source,policy,through){
 assert.match(through,/^\d{4}-\d{2}-\d{2}$/);assert.equal(new Date(through+'T00:00:00Z').toISOString().slice(0,10),through);
 assert.equal(policy.source_revision,source.revision);
 const items=[];
 function add(path,value,identity={}){
  assert.ok(value&&/^\d{4}-\d{2}-\d{2}$/.test(value.review_after),'Missing explicit review boundary: '+path);
  items.push({path,...identity,reviewedAt:value.reviewed_at,expiresExclusive:value.review_after,
   coversRequestedDay:value.review_after>through});
 }
 add('operational_policy',policy);add('source_release_review',source.source_release_review);
 add('finishing_refresh_policy',source.finishing_refresh_policy);
 for(const p of source.players)if(p.availability_scenario)add('players.'+p.player_id+'.availability_scenario',p.availability_scenario,{playerId:p.player_id,name:p.name});
 const blockers=items.filter(p=>!p.coversRequestedDay);
 return {schema:'citrus.review-coverage.v1',status:blockers.length?'SUCCESSOR_REVIEW_REQUIRED':'DATES_COVER_WINDOW_NOT_RELEASE_APPROVAL',
  customerReady:false,sourceRevision:source.revision,requestedInclusiveDay:through,
  earliestExpiryExclusive:items.map(p=>p.expiresExclusive).sort()[0],items,blockers,
  instruction:'Preserve source authorization boundaries. A new operational date does not renew finishing, source or player-availability approval.'};
}
