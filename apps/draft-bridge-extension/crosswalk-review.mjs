// Read-only review. Does not write a crosswalk, forecast, or provider league.
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {reviewedIdentityExceptions} from './crosswalk-overrides.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const [identitiesPath,kitPath,directoryPath,exceptionsPath]=process.argv.slice(2);if(!identitiesPath||!kitPath)throw Error('Pass observed identities JSON and the reviewed kit HTML; optionally canonical directory and reviewed exception snapshots.');
const exceptions=exceptionsPath?JSON.parse(await readFile(exceptionsPath,'utf8')):null;
const observations=JSON.parse(await readFile(identitiesPath,'utf8'));
const kit=JSON.parse(/<script id="kit-data" type="application\/json">([\s\S]*?)<\/script>/.exec(await readFile(kitPath,'utf8'))?.[1]??'null');
if(!kit?.players?.length)throw Error('Missing reviewed kit.');
const out=await mkdtemp(join(tmpdir(),'citrus-crosswalk-review-'));
await build({entryPoints:[join(here,'../../server/src/services/import/PlayerCrosswalkService.ts')],bundle:true,outfile:join(out,'match.mjs'),format:'esm',platform:'node'});
const {matchAgainstDirectory}=await import(pathToFileURL(join(out,'match.mjs')));
const directory=directoryPath?JSON.parse(await readFile(directoryPath,'utf8')):kit.players.map(p=>({player_id:Number(p.key.slice(10)),full_name:p.name,team_abbrev:p.team,jersey_number:null,position_code:p.position}));
if(!Array.isArray(directory)||!directory.length||directory.some(p=>!Number.isInteger(p.player_id)||typeof p.full_name!=='string')||new Set(directory.map(p=>p.player_id)).size!==directory.length)throw Error('Canonical directory is incomplete or ambiguous.');
const result={revision:kit.revision,projectionDate:kit.projectionDate,readOnly:true,platforms:{}};
for(const platform of ['espn','yahoo']){
 const matches=observations[platform].map(row=>{
  const teamAbbr=row.teamAbbr??row.teamPosition?.split(' - ')[0];
  const ref={...row,teamAbbr,jerseyNumber:null,position:row.position??row.teamPosition?.split(' - ')[1]};
  return {...matchAgainstDirectory(ref,directory),name:ref.name,teamAbbr};
 });
 const manual=reviewedIdentityExceptions(exceptions,platform,observations[platform],directory,kit.players);
 const accepted=[...matches.filter(m=>m.matchMethod==='name_team'&&!m.isAmbiguous&&kit.players.some(p=>p.key==='canonical:'+m.nhlPlayerId)&&!manual.some(r=>r.externalPlayerId===m.externalPlayerId)),...manual];
 const missing=kit.players.filter(p=>!accepted.some(m=>m.nhlPlayerId===Number(p.key.slice(10))));
 result.platforms[platform]={observed:observations[platform].length,matched:accepted.length,missing:missing.map(p=>({key:p.key,name:p.name,team:p.team,near:matches.filter(m=>m.nhlPlayerId===Number(p.key.slice(10)))})),mappings:accepted.map(m=>({externalPlayerId:m.externalPlayerId,key:'canonical:'+m.nhlPlayerId,name:m.name,team:m.teamAbbr,method:m.matchMethod}))};
}
console.log(JSON.stringify(result,null,2));
