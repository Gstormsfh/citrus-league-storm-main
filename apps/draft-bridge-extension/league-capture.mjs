/** User-triggered read of rendered league SETTINGS, not accounts, credentials,
 * rosters or historical results. Never represent this as a whole-league import. */
export function captureLeagueSettings(doc=document,href=location.href){
 const fail=message=>({ok:false,message}),clean=v=>String(v??'').replace(/\s+/g,' ').trim();
 let u;try{u=new URL(href);}catch{return fail('Open your league settings page.');}
 const tables=[...doc.querySelectorAll('table')],rows=t=>[...t.querySelectorAll('tr')].map(r=>[...r.querySelectorAll(':scope > th,:scope > td')].map(c=>clean(c.textContent)));
 let platform,leagueId,season=null,name,scoringType,teamCount,roster=[],scoring=[],settings=[];
 if(u.origin==='https://hockey.fantasysports.yahoo.com'){
  const path=/^\/(?:\d{4}\/)?hockey\/([1-9]\d{0,11})(?:\/\d+)?\/settings\/?$/.exec(u.pathname);
  if(!path)return fail('Open Yahoo’s league Settings page first.');
  platform='yahoo';leagueId=path[1];
  const table=doc.querySelector('#settings-table');if(!table)return fail('Yahoo settings have not loaded.');
  settings=rows(table).filter(r=>r.length===2&&r[0]!=='Setting').map(([label,value])=>({label:label.replace(/:$/,''),value}));
  const get=label=>settings.find(r=>r.label===label)?.value;
  if(get('League ID#')!==leagueId)return fail('The displayed league ID does not match this page.');
  name=get('League Name');scoringType=get('Scoring Type');teamCount=Number(get('Max Teams'));
  const positions=get('Roster Positions')?.split(',').map(clean);if(!positions?.length)return fail('Roster positions are missing.');
  const counts=new Map();for(const p of positions)counts.set(p,(counts.get(p)??0)+1);roster=[...counts].map(([label,count])=>({label,count}));
  for(const [group,heading] of [['skater','Forwards/Defensemen Stat Category'],['goalie','Goaltenders Stat Category']]){
   const found=tables.filter(t=>rows(t)[0]?.[0]===heading);if(found.length!==1)return fail('Both scoring sections must be visible.');
   for(const row of rows(found[0]).slice(1)){
    if(row.length!==2||!row[0]||row[1]===''||!Number.isFinite(Number(row[1])))return fail('A scoring field is incomplete.');
    scoring.push({group,label:row[0],value:Number(row[1])});
   }
  }
 }else if(u.origin==='https://fantasy.espn.com'){
  if(u.pathname!=='/hockey/league/settings'||!/^\d+$/.test(u.searchParams.get('leagueId')??''))return fail('Open ESPN’s League Settings page first.');
  platform='espn';leagueId=u.searchParams.get('leagueId');
  const year=Number(u.searchParams.get('seasonId'));if(Number.isInteger(year)&&year>=2001&&year<=2101)season=year-1;
  const all=tables.flatMap(rows),get=label=>all.find(r=>r.length===2&&r[0]===label)?.[1];
  name=get('League Name');scoringType=get('Scoring Type');teamCount=Number(get('Number of Teams'));
  settings=all.filter(r=>r.length===2&&r[0]&&r[1]&&r[0].length<=120&&r[1].length<=500).map(([label,value])=>({label,value}));
  const rosterTable=tables.filter(t=>rows(t)[0]?.join('|')==='Position|Starters|Maximums');
  if(rosterTable.length!==1)return fail('The full roster-position table must be visible.');
  for(const row of rows(rosterTable[0]).slice(1)){
   const label=/\(([^)]+)\)$/.exec(row[0])?.[1];if(row.length!==3||!label||!/^\d+$/.test(row[1]))return fail('A roster field is incomplete.');
   roster.push({label,count:Number(row[1])});
  }
  for(const [group,heading] of [['skater','Skater'],['goalie','Goaltender']]){
   const found=tables.filter(t=>rows(t)[0]?.join('')===heading);if(found.length!==1)return fail('Both scoring sections must be visible.');
   for(const row of rows(found[0]).slice(1)){
    if(row.length===1&&row[0]==='')continue;
    const match=/^(.+)\s+(-?\d+(?:\.\d+)?)$/.exec(row.join(' '));if(!match)return fail('A scoring field is incomplete.');
    scoring.push({group,label:match[1],value:Number(match[2])});
   }
  }
 }else return fail('Only ESPN and Yahoo hockey settings are supported.');
 if(!name||name.length>128||!scoringType||!Number.isInteger(teamCount)||teamCount<2||teamCount>32||roster.length>30||scoring.length>60
  ||roster.some(r=>!r.label||r.label.length>40||r.count<0||r.count>100)||scoring.some(r=>r.label.length>100||Math.abs(r.value)>10000)
  ||new Set(scoring.map(r=>r.group+':'+r.label)).size!==scoring.length)return fail('The league settings are incomplete or ambiguous.');
 return {ok:true,version:1,kind:'league-settings',platform,leagueId,season,name,scoringType,teamCount,roster,scoring,settings:settings.slice(0,100),capturedAt:new Date().toISOString(),coverage:{settings:true,rosters:false,history:false,keepers:false}};
}
