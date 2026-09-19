// Read-only successor-policy planning. Never renew dates or authorize a source.
import assert from 'node:assert/strict';
export function reviewCoverage(source,policy,through){
 // Date-only callers retain inclusive UTC-day semantics. Commerce callers
 // must pass the actual timezone-aware access boundary, not a display date.
 assert.equal(typeof through,'string');
 const dayOnly=/^\d{4}-\d{2}-\d{2}$/.test(through);
 assert.ok(dayOnly||/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(through),'Explicit timezone required');
 const day=through.slice(0,10);
 assert.equal(new Date(day+'T00:00:00Z').toISOString().slice(0,10),day,'Invalid calendar date');
 const requested=Date.parse(dayOnly?through+'T23:59:59.999Z':through);
 assert.ok(Number.isFinite(requested),'Invalid update boundary');
 assert.equal(policy.source_revision,source.revision);
 const items=[];
 function add(path,value,identity={}){
  assert.ok(value&&/^\d{4}-\d{2}-\d{2}$/.test(value.review_after),'Missing explicit review boundary: '+path);
  assert.equal(new Date(value.review_after+'T00:00:00Z').toISOString().slice(0,10),value.review_after,'Invalid review boundary: '+path);
  items.push({path,...identity,reviewedAt:value.reviewed_at,expiresExclusive:value.review_after,
   coversRequestedDay:Date.parse(value.review_after+'T00:00:00Z')>requested});
 }
 add('operational_policy',policy);add('source_release_review',source.source_release_review);
 add('finishing_refresh_policy',source.finishing_refresh_policy);
 for(const p of source.players)if(p.availability_scenario)add('players.'+p.player_id+'.availability_scenario',p.availability_scenario,{playerId:p.player_id,name:p.name});
 const blockers=items.filter(p=>!p.coversRequestedDay);
 return {schema:'citrus.review-coverage.v1',status:blockers.length?'SUCCESSOR_REVIEW_REQUIRED':'DATES_COVER_WINDOW_NOT_RELEASE_APPROVAL',
  customerReady:false,sourceRevision:source.revision,requestedInclusiveDay:day,
  requestedThroughInclusive:new Date(requested).toISOString(),
  earliestExpiryExclusive:items.map(p=>p.expiresExclusive).sort()[0],items,blockers,
  instruction:'Preserve source authorization boundaries. A new operational date does not renew finishing, source or player-availability approval.'};
}
