import {defaultLeagueStats,type LeagueStatSetting} from '@citrus/shared';
export interface LeagueSettingsCapture {
  ok:true;version:1;kind:'league-settings';platform:'espn'|'yahoo';leagueId:string;season:number|null;
  name:string;scoringType:string;teamCount:number;capturedAt:string;
  roster:Array<{label:string;count:number}>;scoring:Array<{group:'skater'|'goalie';label:string;value:number}>;
  settings:Array<{label:string;value:string}>;
  coverage:{settings:true;rosters:false;history:false;keepers:false};
}
export interface LeagueSettingsPrefill {name:string;teamsCount:number;rosterSlots:Record<string,number>;stats:LeagueStatSetting[];scoringFormat:'h2h-points'|'total-points';positionType:'forward'|'individual';draftType:'snake'|'auction';minGoalieGames?:number}
const aliases:Record<string,string>={'skater:G':'g','skater:A':'a','skater:PPP':'ppp','skater:SHP':'shg','skater:SOG':'sog','skater:BLK':'blk','skater:HIT':'hit','skater:PIM':'pim','skater:+/-':'pm','goalie:W':'w','goalie:SV':'sv','goalie:SO':'so','goalie:SHO':'so','goalie:GA':'ga'};
/** Copy supported settings, never rescore players or replace missing values with defaults. */
export function reviewBrowserLeagueSettings(raw:unknown){
  const s=raw as LeagueSettingsCapture;
  if(!s||JSON.stringify(s).length>32000||s.ok!==true||s.version!==1||s.kind!=='league-settings'||!['espn','yahoo'].includes(s.platform)
    ||!/^\d{1,12}$/.test(s.leagueId)||typeof s.name!=='string'||!s.name.trim()||s.name.length>64||typeof s.scoringType!=='string'
    ||!Number.isInteger(s.teamCount)||s.teamCount<2||s.teamCount>32||!Array.isArray(s.roster)||s.roster.length>30||!Array.isArray(s.scoring)||s.scoring.length>60
    ||!Array.isArray(s.settings)||s.settings.length>100||!Number.isFinite(Date.parse(s.capturedAt))
    ||s.coverage?.settings!==true||s.coverage.rosters!==false||s.coverage.history!==false||s.coverage.keepers!==false)throw Error('This is not a supported league-settings capture.');
  const issues:string[]=[],stats=defaultLeagueStats().map(stat=>({...stat,enabled:false,points:0})),seen=new Set<string>();
  const format=/^Head[- ]to[- ]Head(?: -)? Points$/i.test(s.scoringType)?'h2h-points':/^Points$/i.test(s.scoringType)?'total-points':null;
  if(!format)issues.push(`Scoring format needs manual setup: ${s.scoringType}.`);
  for(const row of s.scoring){
    if(!row||typeof row.label!=='string'||row.label.length>100||!['skater','goalie'].includes(row.group)||!Number.isFinite(row.value)||Math.abs(row.value)>10000)throw Error('Invalid scoring row.');
    const abbr=/\(([^)]+)\)$/.exec(row.label)?.[1],id=aliases[row.group+':'+abbr],stat=stats.find(v=>v.id===id);
    if(!stat){if(row.value!==0)issues.push(`Unsupported point category: ${row.label} (${row.value}).`);continue;}
    if(seen.has(id))throw Error('Duplicate scoring category.');seen.add(id);stat.points=row.value;stat.enabled=row.value!==0;
  }
  if(!stats.some(s=>s.enabled))issues.push('No supported scoring values were found.');
  const rosterSlots:Record<string,number>={C:0,LW:0,RW:0,F:0,D:0,UTIL:0,G:0,BN:0,IR:0};
  const slots=new Set<string>();
  for(const row of s.roster){
    if(!row||typeof row.label!=='string'||row.label.length>40||!Number.isInteger(row.count)||row.count<0||row.count>100)throw Error('Invalid roster row.');
    const slot=row.label.toUpperCase()==='BE'?'BN':row.label.toUpperCase();
    if(slots.has(slot))throw Error('Duplicate roster slot.');slots.add(slot);
    if(!(slot in rosterSlots)){if(row.count)issues.push(`Unsupported roster slot: ${row.label} × ${row.count}.`);}else rosterSlots[slot]=row.count;
  }
  if(rosterSlots.F&&['C','LW','RW'].some(k=>rosterSlots[k]))issues.push('Mixed forward and individual-position slots need manual setup.');
  for(const r of s.settings)if(!r||typeof r.label!=='string'||r.label.length>120||typeof r.value!=='string'||r.value.length>500)throw Error('Invalid source setting.');
  const draft=s.settings.find(r=>r.label==='Draft Type')?.value;
  const draftType=/^(Snake|Live Standard Draft)$/i.test(draft??'')?'snake':/^(Auction|Live Salary Cap Draft)$/i.test(draft??'')?'auction':null;
  if(!draftType)issues.push('Draft format needs manual confirmation.');
  const minimum=s.settings.find(r=>r.label==='Min goalie appearances per team per week')?.value;
  const minGoalieGames=minimum&&/^\d+$/.test(minimum)?Number(minimum):undefined;
  const prefill:LeagueSettingsPrefill|null=issues.length?null:{name:s.name,teamsCount:s.teamCount,rosterSlots,stats,scoringFormat:format!,positionType:rosterSlots.F?'forward':'individual',draftType:draftType!,...(minGoalieGames!==undefined?{minGoalieGames}:{})};
  return {capture:s,issues,prefill,notice:'Copies league name, team count, roster slots, points scoring and draft format only. Review scheduling, waivers, playoffs and keeper rules in the form. Player rosters, managers and history are not imported.'};
}
