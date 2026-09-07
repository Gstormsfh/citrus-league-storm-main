// Complete recursive field census of the existing archive, not an extra feed.
const fs=require('fs'),crypto=require('crypto');
const root=process.cwd(),base=root+'/scripts/proof/results',out=base+'/pbp-field-census-20260907';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
fs.mkdirSync(out);const save=(n,v)=>fs.writeFileSync(out+'/'+n,JSON.stringify(v),{flag:'wx'});
const fields={},types={},reasons={},pins={};let games=0,events=0;
function walk(v,path){
 const f=fields[path]??={occurrences:0,types:{}};f.occurrences++;const t=v===null?'null':Array.isArray(v)?'array':typeof v;f.types[t]=(f.types[t]??0)+1;
 if(Array.isArray(v)){for(const x of v)walk(x,path+'[]');}
 else if(v&&typeof v==='object'){for(const [k,x]of Object.entries(v))walk(x,path?path+'.'+k:k);}
}
const dir=base+'/historical-official-freeze-20260906/2025/pbp';
for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.body.json'))){
 const body=fs.readFileSync(dir+'/'+file),g=JSON.parse(body);pins[file]=hash(body);games++;walk(g,'');
 for(const p of g.plays??[]){events++;types[p.typeDescKey]=(types[p.typeDescKey]??0)+1;
  if(p.details?.reason){reasons[p.typeDescKey]??={};reasons[p.typeDescKey][p.details.reason]=(reasons[p.typeDescKey][p.details.reason]??0)+1;}}
}
for(const [path,f]of Object.entries(fields)){
 f.review_class=path.startsWith('plays[].details.')?'event_detail_requires_current_vs_prior_review':
 path==='plays[].pptReplayUrl'?'goal_selected_link_not_predictor':path.startsWith('plays[]')?'event_envelope':
 path.startsWith('rosterSpots')?'roster_annotation_not_shift_tracking':'game_metadata_or_container';
 if(/assist|scoringPlayerTotal|homeScore|awayScore|homeSOG|awaySOG|highlight|discreteClip|goalInGame/.test(path))f.review_class='current_outcome_or_cumulative_annotation_not_direct_predictor';
}
save('fields.json',fields);save('source-sha256.json',pins);save('summary.json',{games,events,distinct_paths:Object.keys(fields).length,event_types:types,reason_distributions:reasons,
 scope:'All raw 2025-26 PBP fields; not proof of historical live availability',production_changed:false});
save('health.json',{status:'complete-pbp-field-census',files:Object.fromEntries(fs.readdirSync(out).map(f=>[f,hash(fs.readFileSync(out+'/'+f))]))});
console.log({games,events,distinct_paths:Object.keys(fields).length});
