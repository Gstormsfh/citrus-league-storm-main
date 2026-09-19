/** Explicit operator-reviewed identity exceptions, never a fuzzy matching rule.
 * Read-only: validates both snapshots and returns proposed manual mappings. */
export function reviewedIdentityExceptions(review,platform,observations,directory,players){
 if(!review)return [];
 if(review.version!==1||review.status!=='reviewed-identity-only-not-promoted'||!Array.isArray(review.entries)||review.entries.length>50)throw Error('Invalid reviewed identity exceptions.');
 const ids=new Set(),keys=new Set();
 return review.entries.filter(r=>r.platform===platform).map(r=>{
  const p=observations.find(p=>p.externalPlayerId===r.externalPlayerId),d=directory.find(d=>'canonical:'+d.player_id===r.key);
  if(!p||!d||!players.some(p=>p.key===r.key)||ids.has(r.externalPlayerId)||keys.has(r.key)||!r.observed||!r.canonical
    ||r.observed.name!==p.name||r.observed.team!==(p.teamAbbr??p.teamPosition?.split(' - ')[0])||r.observed.position!==(p.position??p.teamPosition?.split(' - ')[1])
    ||r.canonical.name!==d.full_name||r.canonical.team!==d.team_abbrev||r.canonical.position!==d.position_code
    ||typeof r.reason!=='string'||r.reason.length<30||!Array.isArray(r.evidence)||r.evidence.length<2||r.evidence.some(v=>typeof v!=='string'||!v))throw Error('Reviewed identity no longer agrees with its source snapshots.');
  ids.add(r.externalPlayerId);keys.add(r.key);
  return {externalPlayerId:r.externalPlayerId,nhlPlayerId:d.player_id,matchMethod:'manual',confidence:1,isAmbiguous:false,candidates:[d.player_id],name:p.name,teamAbbr:r.observed.team};
 });
}
