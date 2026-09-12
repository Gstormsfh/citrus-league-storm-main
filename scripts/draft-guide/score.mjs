// Execute Citrus's existing scorer, retaining workbook games-scaling and rank semantics.
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source = readFileSync(new URL('../../packages/shared/src/utils/draftGuide.ts', import.meta.url), 'utf8');
const { reweightProjections } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
const { data, weights } = JSON.parse(readFileSync(0, 'utf8'));
for (const group of ['skater', 'goalie']) {
  if (!weights[group] || Array.isArray(weights[group])) throw Error(`Missing ${group} settings`);
  for (const [key, value] of Object.entries(weights[group])) {
    if (!(Object.hasOwn(data.weights[group], key))) throw Error(`Unsupported category: ${key}`);
    if (typeof value !== 'number' || !Number.isFinite(value)) throw Error(`Invalid weight: ${key}`);
  }
  for (const key of Object.keys(data.weights[group])) if (!(Object.hasOwn(weights[group], key))) throw Error(`Missing weight: ${key}`);
}
const rows = data.players.map((p, i) => ({...p, sortId:i+1}));
const result = [];
for (const goalie of [false, true]) {
  const cohort = rows.filter(p=>p.isGoalie===goalie && (!p.forecastStatus || p.forecastStatus==='projected') && p.games!==null);
  const raw = cohort.map(p=>({playerId:p.sortId,playerName:p.name,position:p.position,isGoalie:goalie,...Object.fromEntries(Object.entries(p.stats).map(([k,v])=>[k,p.baseGames ? v*p.games/p.baseGames : 0]))}));
  const ranked=reweightProjections(raw,weights);
  const positions=new Map(); let previous=null,rank=0;
  for (const [i,r] of ranked.entries()) {
    const p=cohort.find(p=>p.sortId===r.playerId);
    if (previous===null || Math.abs(r.projectedPoints-previous)>1e-9) rank=i+1;
    const prev=positions.get(p.position)||{score:null,rank:0,count:0};
    if(prev.score===null || Math.abs(prev.score-r.projectedPoints)>1e-9)prev.rank=prev.count+1;
    prev.count++;prev.score=r.projectedPoints;positions.set(p.position,prev);
    const factor=p.baseGames ? p.games/p.baseGames : 0;
    result.push({...p,rank,positionRank:prev.rank,fantasyPoints:r.projectedPoints,pointsPerGame:p.games ? r.projectedPoints/p.games : 0,adjustedPoints:p.canonicalRates ? null : p.rosterProbability==null ? null:r.projectedPoints*p.rosterProbability,contributions:Object.entries(p.stats).map(([key,value])=>({key,raw:value,scaled:value*factor,weight:weights[goalie?'goalie':'skater'][key],points:value*factor*weights[goalie?'goalie':'skater'][key]}))});
    previous=r.projectedPoints;
  }
}
for (const p of rows.filter(p=>(p.forecastStatus && p.forecastStatus!=='projected') || p.games===null)) {
  result.push({...p,rank:null,positionRank:null,fantasyPoints:null,pointsPerGame:null,adjustedPoints:null,contributions:[]});
}
process.stdout.write(JSON.stringify({weights,players:result}));
