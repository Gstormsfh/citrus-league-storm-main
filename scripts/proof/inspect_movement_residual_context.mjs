// Read-only model/source diagnosis. Does not fit or modify scoring parameters.
import fs from 'node:fs';
import crypto from 'node:crypto';
const root=process.cwd(), result=`${root}/scripts/proof/results`;
const features=`${result}/last-season-candidate-features-20260907`;
const candidate=`${result}/continuous-event-movement-20260907`;
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p));
const h=read(`${candidate}/health.json`);
for(const [file,digest]of Object.entries(h.files))if(hash(`${candidate}/${file}`)!==digest)throw Error('Candidate hash drift');
const rows=read(`${candidate}/predictions.json`), selected=new Map(rows.filter(r=>r.cell>=0&&Math.floor(r.cell/5)<3&&r.cell%5>=2).map(r=>[`${r.game_id}:${r.event_id}`,r]));
const names=read(`${features}/schema.json`).names,fh=read(`${features}/health.json`);
const groups={},fieldCounts={current:{},previous:{}},desc={},rawTypes={},sourcePins={};let joined=0;
function add(group,key,r){const a=(groups[group]??={})[key]??={events:0,goals:0,xg:0};a.events++;a.goals+=r.target;a.xg+=r.continuous;}
for(const game of read(`${features}/game-inventory.json`)){
  const path=`${features}/${game.game_id}.json`;
  if(hash(path)!==fh.files[`${game.game_id}.json`])throw Error('Feature hash drift');
  const rr=read(path).filter(r=>selected.has(`${r.game_id}:${r.event_id}`));if(!rr.length)continue;
  const body=`${result}/historical-official-freeze-20260906/2025/pbp/${game.game_id}.body.json`;
  sourcePins[body]=hash(body);const raw=read(body),playIndex=new Map(raw.plays.map((p,i)=>[p.eventId,i]));
  for(const f of rr){
    const r=selected.get(`${f.game_id}:${f.event_id}`);if(+f.label!==r.target)throw Error('Label drift');joined++;
    const v=n=>f.features[names.indexOf(n)];
    const prior=String(f.categorical.previous_event_type),distance=v('distance_to_goal_ft');
    const angle=v('immediate_recorded_live_event__event_angle_change_deg');
    const cross=v('immediate_recorded_live_event__event_crossed_centerline');
    const db=distance<10?'under10':distance<20?'10to20':distance<35?'20to35':'35plus';
    const ab=angle===null?'missing':angle<15?'under15deg':angle<45?'15to45deg':'45plusdeg';
    add('prior_event',prior,r);add('shot_distance',db,r);add('angle_change',ab,r);add('crossed_centerline',String(cross),r);
    add('prior_by_distance',`${prior}|${db}`,r);
    const i=playIndex.get(f.event_id),current=raw.plays[i],previous=raw.plays[i-1];
    if(String(previous?.typeCode)!==prior)throw Error('Prior event mismatch');
    desc[prior]=previous.typeDescKey;rawTypes[String(current.typeCode)]=current.typeDescKey;
    for(const [kind,event]of [['current',current],['previous',previous]])for(const k of Object.keys(event.details??{}))fieldCounts[kind][k]=(fieldCounts[kind][k]??0)+1;
  }
}
if(joined!==selected.size)throw Error('Incomplete join');
for(const values of Object.values(groups))for(const a of Object.values(values))a.excess_xg=a.xg-a.goals;
const output={events:joined,groups,prior_descriptions:desc,current_descriptions:rawTypes,detail_field_counts:fieldCounts,
  source_body_sha256:sourcePins,candidate_health_sha256:hash(`${candidate}/health.json`),feature_health_sha256:hash(`${features}/health.json`),
  scope:'Original fast-lateral cohort; exploratory diagnosis, no parameter fitting or causal claim',production_changed:false};
fs.writeFileSync(`${result}/movement-residual-context-20260907.json`,JSON.stringify(output),{flag:'wx'});
console.log(JSON.stringify({events:joined,groups,prior_descriptions:desc,detail_field_counts:fieldCounts},null,2));
