import { readDeskFile, type DeskFile } from './deskConnection';

export interface BrowserBundle {
  version: 1; platform: 'espn' | 'yahoo'; file: DeskFile;
  mappings: Array<{externalPlayerId:string;key:string}>;
  scoringVerified: boolean;
}
export interface BrowserSnapshot {
  ok:true;version:1;platform:'espn'|'yahoo';leagueId?:string|null;roomId?:string;season?:number|null;
  status:'in_progress'|'paused'|'finished';currentPick:number;totalRounds:number;title:string;
  teamCount?:number|null;teams?:unknown[];
  picks:Array<{externalPlayerId:string;overallPick:number}>;
}
export function readBrowserBundle(raw:BrowserBundle):BrowserBundle {
  if(!raw||raw.version!==1||!['espn','yahoo'].includes(raw.platform)||!Array.isArray(raw.mappings)
    ||raw.mappings.length>300||typeof raw.scoringVerified!=='boolean')throw Error('Invalid companion board.');
  const file=readDeskFile(JSON.stringify(raw.file));
  const seen=new Set<string>(),mapped=new Set<string>(),keys=new Set(file.kit.players.map(p=>p.key));
  for(const row of raw.mappings){
    if(!row||!keys.has(row.key)||!/^[1-9]\d{0,11}$/.test(row.externalPlayerId)||seen.has(row.externalPlayerId)||mapped.has(row.key))throw Error('Player identities cannot be verified.');
    seen.add(row.externalPlayerId);mapped.add(row.key);
  }
  if(mapped.size!==keys.size)throw Error('Some board players do not have verified provider IDs.');
  return {...raw,file};
}
export function browserAvailability(bundle:BrowserBundle,s:BrowserSnapshot,receivedAt:number,previousIdentity?:string,now=Date.now()) {
  if(!s||s.ok!==true||s.version!==1||s.platform!==bundle.platform||!['in_progress','paused','finished'].includes(s.status)
    ||!Number.isFinite(receivedAt)||receivedAt>now+1000||now-receivedAt>6000
    ||!Array.isArray(s.picks)||s.picks.length>3200||!Number.isInteger(s.currentPick)||s.currentPick<1
    ||!Number.isInteger(s.totalRounds)||s.totalRounds<1||s.totalRounds>100
    ||!/^\d{1,12}$/.test(String(s.roomId??s.leagueId??'')))throw Error('Draft availability is unverified. Keeping the last confirmed board.');
  const identity=`${s.platform}:${s.roomId??s.leagueId}:${s.season}`;
  if(previousIdentity&&identity!==previousIdentity)throw Error('The source draft changed. Reconnect explicitly.');
  const slots=new Set<number>(),ids=new Set<string>();
  for(const pick of s.picks){
    if(!/^[1-9]\d{0,11}$/.test(pick.externalPlayerId)||!Number.isInteger(pick.overallPick)||pick.overallPick<1||slots.has(pick.overallPick)||ids.has(pick.externalPlayerId))throw Error('Conflicting pick history. Keeping the last confirmed board.');
    slots.add(pick.overallPick);ids.add(pick.externalPlayerId);
  }
  const teamCount=Number(s.teamCount??(Array.isArray(s.teams)?s.teams.length:NaN));
  if([...slots].some(n=>n>s.picks.length)||s.picks.length!==s.currentPick-1
    ||(s.status==='finished'&&(!Number.isInteger(teamCount)||teamCount<2||teamCount>32||s.picks.length!==s.totalRounds*teamCount)))throw Error('Incomplete pick history. Keeping the last confirmed board.');
  return {identity,unavailableIds:new Set(bundle.mappings.filter(m=>ids.has(m.externalPlayerId)).map(m=>m.key.slice('canonical:'.length)))};
}
