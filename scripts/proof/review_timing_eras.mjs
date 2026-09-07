import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import {fileURLToPath} from 'node:url';
export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const PLAN='docs/analytics-timing-era-audit-plan-20260906.md';
export const PINS={plan:'160481f8b77a2d833546077cb8ffc27ba77730d85c2ddd94b000c64ce8a77d9a',manifest:'9e19e40264c826d8cf818d2c02b0a10b3de1d4d13cba65c470433b616b2f4534',export:'3105195b90d4d9a756773b94aec471c6a146b9fbdce96a5b3e9dfab921b34819',prior:'bc30a53dbd06331e7f065f053bf0300a3606004ff98a6df6c2d8496784091569'};
export const DIMENSIONS={season_state_gap:['season','state','gap_band'],month_state_gap:['month','state','gap_band'],season_type_gap:['season','current_type','gap_band'],season_state_gap_coords_actor:['season','state','gap_band','same_raw_coordinates','same_actor'],season_state_gap_game_type:['season','state','gap_band','game_type']};
const EXPORT='scripts/proof/results/official-development-features-20260906';
const PRIOR='scripts/proof/results/prior-sog-fidelity-20260906-full';
function check(value,message){if(!value)throw Error(message);}
const integer=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
export function safe(root,name){check(typeof name==='string'&&!name.split(/[\\/]/).includes('..'),'Traversal rejected');const p=path.resolve(root,name);check(p.startsWith(root+path.sep),'Contained file required');let q=p;while(q!==root){check(!fs.lstatSync(q).isSymbolicLink(),'Symlink rejected');q=path.dirname(q);}return p;}
export async function sha(file){const h=crypto.createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');}
async function pin(root,name,expected){check(digest(expected),'Expected SHA required');const p=safe(root,name);check(await sha(p)===expected,`Hash drift: ${name}`);return p;}
export async function* lines(file){const stream=fs.createReadStream(file);const reader=readline.createInterface({input:stream,crlfDelay:Infinity});try{for await(const line of reader){check(line.length>0&&line.length<=100000,'Bounded nonempty JSONL line');yield JSON.parse(line);}}finally{reader.close();stream.destroy();}}
export function key(r){check(integer(r.game_id,1,9999999999)&&integer(r.event_id,0,999999999),'Strict event key');return `${r.game_id}/${r.event_id}`;}
function clock(s){check(typeof s==='string'&&/^\d{2}:\d{2}$/.test(s)&&Number(s.slice(3))<60,'Canonical clock');return Number(s.slice(0,2))*60+Number(s.slice(3));}
function period(p){check(p&&integer(p.number,1,99)&&['REG','OT','SO'].includes(p.periodType),'Canonical period');return p;}
function point(p){check(Array.isArray(p)&&p.length===2&&p.every(v=>v===null||typeof v==='number'&&Number.isFinite(v)),'Finite point or explicit null');return p.every((v,i)=>v!==null&&Math.abs(v)<=[100,42.5][i]);}
function actor(x){check(x===null||integer(x,1000000,9999999),'Known bounded actor or null');return x;}
export function validateRow(r){
 key(r);check(integer(r.season,2019,2023)&&Math.floor(r.game_id/1000000)===r.season,'Original seasons only');
 check(typeof r.month==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(r.month)&&r.month>='2019-07'&&r.month<'2024-07'&&[r.season,r.season+1].includes(Number(r.month.slice(0,4))),'Development month');
 check(['regular','playoff'].includes(r.game_type)&&[505,506,507].includes(r.current_type)&&integer(r.target,0,1)&&r.target===Number(r.current_type===505),'Official target/type');
 const cp=period(r.current_period),ct=clock(r.current_clock);check(cp.periodType!=='SO','Shootout excluded');
 check(integer(r.current_order,0,Number.MAX_SAFE_INTEGER)&&integer(r.raw_play_index,0,99999),'Raw order/index');
 const has=r.previous_event_id!==null;let same=false,gap=null;
 if(has){check(integer(r.previous_event_id,0,999999999)&&r.previous_event_id!==r.event_id&&integer(r.previous_order,0,r.current_order-1)&&r.raw_play_index>0,'Strict predecessor');const pp=period(r.previous_period),pt=clock(r.previous_clock);check(integer(r.previous_type,0,9999),'Prior event type');check(pp.number<=cp.number&&(pp.number!==cp.number||pp.periodType===cp.periodType&&pt<=ct),'Period/clock order');same=pp.number===cp.number&&pp.periodType===cp.periodType;if(same)gap=ct-pt;}
 else check(r.previous_order===null&&r.previous_clock===null&&r.previous_period===null&&r.previous_type===null&&r.raw_play_index===0,'Absent predecessor fields');
 const band=gap===null?'no_same_period_predecessor':gap===0?'same_clock':gap<=1?'up_to_1s':gap<3?'over_1_under_3s':gap<=10?'from_3_to_10s':'over_10s';
 check(r.gap_seconds===gap&&r.gap_band===band,'Independent gap mismatch');
 for(const n of ['current_owner','previous_owner'])check(r[n]===null||integer(r[n],1,Number.MAX_SAFE_INTEGER),'Known owner or null');
 const live=[502,503,504,506,507,508,525].includes(r.previous_type);
 const state=same&&live&&r.current_owner!==null&&r.previous_owner!==null?String(Number(r.previous_type===506&&r.current_owner===r.previous_owner)):null;
 check(r.state===state,'Independent prior state mismatch');
 const a=point(r.current_coordinates),b=point(r.previous_coordinates);
 const equal=a&&b?r.current_coordinates.every((v,i)=>v===r.previous_coordinates[i]):null;
 check(r.same_raw_coordinates===equal,'Signed coordinate equality mismatch');
 const ca=actor(r.current_actor),pa=actor(r.previous_actor);
 check(r.same_actor===(ca===null||pa===null?null:ca===pa),'Actor equality mismatch');
 check(r.actor_diagnostic_retrospective_not_predictor===true,'Retrospective actor declaration');
 for(const n of ['source_body_sha256','source_receipt_sha256','source_envelope_sha256','source_event_sha256'])check(digest(r[n]),'Hash domains');
 check(has?digest(r.previous_source_event_sha256):r.previous_source_event_sha256===null,'Prior source hash');return r;
}
export class Counts{
 constructor(){this.events=0;this.goals=0;this.games=new Set();this.keys=new Set();this.cells=Object.fromEntries(Object.keys(DIMENSIONS).map(n=>[n,new Map()]));}
 add(r){validateRow(r);const k=key(r);check(!this.keys.has(k)&&this.events<1000000,'Duplicate/oversize membership');this.keys.add(k);this.events++;this.goals+=r.target;this.games.add(r.game_id);for(const [name,fields]of Object.entries(DIMENSIONS)){const c=JSON.stringify(fields.map(n=>r[n]));const x=this.cells[name].get(c)??{events:0,goals:0,games:new Set()};x.events++;x.goals+=r.target;x.games.add(r.game_id);this.cells[name].set(c,x);}}
 compare(saved){check(this.events>0&&saved.publishable===false&&this.events===saved.events&&this.goals===saved.goals&&this.games.size===saved.games,'Overall counts');check(JSON.stringify(Object.keys(saved.rollups).sort())===JSON.stringify(Object.keys(DIMENSIONS).sort()),'All five rollups');let comparisons=0;for(const [name,cells]of Object.entries(this.cells)){const seen=new Set();let n=0,g=0;check(saved.rollups[name].length===cells.size,'Exact rollup cells');for(const row of saved.rollups[name]){const k=JSON.stringify(row.cell),x=cells.get(k);check(x&&!seen.has(k)&&row.events===x.events&&row.goals===x.goals&&row.games===x.games.size,'Rollup mismatch');seen.add(k);n+=row.events;g+=row.goals;comparisons++;}check(n===this.events&&g===this.goals,'Rollup conservation');}return comparisons;}
}
function inventory(folder){return fs.readdirSync(folder,{withFileTypes:true}).flatMap(e=>{check(!e.isSymbolicLink(),'Output symlink');return e.isDirectory()?inventory(path.join(folder,e.name)).map(n=>e.name+'/'+n):[e.name];}).sort();}
export async function review(run,output){
 run=path.resolve(run);output=path.resolve(output);const parent=path.join(ROOT,'scripts/proof/results');
 check(path.dirname(run)===parent&&path.basename(run).startsWith('timing-era-audit-')&&path.dirname(output)===parent&&path.basename(output).startsWith('timing-era-review-'),'Scoped directories');safe(ROOT,run);check(!fs.existsSync(output),'Create-only review');fs.mkdirSync(output);const files={};
 async function save(n,v){const bytes=JSON.stringify(v,null,2)+'\n';fs.writeFileSync(path.join(output,n),bytes,{flag:'wx'});files[n]=crypto.createHash('sha256').update(bytes).digest('hex');}
 try{
 const checker={};for(const n of ['scripts/proof/review_timing_eras.mjs','scripts/proof/test_review_timing_eras.mjs'])checker[n]=await sha(safe(ROOT,n));
 const hp=path.join(run,'health.json'),healthSHA=await sha(hp),health=read(hp);check(health.status==='complete-timing-era-no-fit-audit'&&health.publishable===false,'Complete source audit required');
 check(JSON.stringify(inventory(run))===JSON.stringify([...Object.keys(health.files),'health.json'].sort()),'Exact output inventory');for(const [n,d]of Object.entries(health.files))await pin(run,n,d);
 await pin(ROOT,PLAN,PINS.plan);await pin(ROOT,EXPORT+'/manifest.json',PINS.manifest);await pin(ROOT,EXPORT+'/development.jsonl',PINS.export);await pin(ROOT,PRIOR+'/health.json',PINS.prior);
 const declaration=read(path.join(run,'declaration.json'));check(declaration.source_health_sha256===PINS.prior&&declaration.specification_sha256===PINS.plan&&['publishable','fits','predictions','later_event_bodies_parsed'].every(k=>declaration[k]===false),'Bound declaration');
 const checked=read(path.join(run,'checked-file-sha256.json'));for(const [n,d]of Object.entries(checked))await pin(ROOT,n,d);
 for(const [n,d]of Object.entries(declaration.code_and_source_sha256))check(checked[n]===d,'Declaration closure');
 check(checked[EXPORT+'/manifest.json']===PINS.manifest&&checked[EXPORT+'/development.jsonl']===PINS.export&&checked[PRIOR+'/health.json']===PINS.prior,'Original pins in closure');
 const manifest=read(path.join(ROOT,EXPORT,'manifest.json'));check(manifest.publishable===false&&JSON.stringify(manifest.source_seasons)==='[2019,2020,2021,2022,2023]','Export season scope');
 const originals=new Map();const pos=manifest.schema.names.indexOf('immediate_previous_sog_same_team');check(pos>=0,'Original state schema');
 for await(const r of lines(path.join(ROOT,EXPORT,'development.jsonl'))){const k=key(r);check(!originals.has(k)&&originals.size<1000000&&r.split==='development'&&typeof r.label==='boolean','Original membership');originals.set(k,[Number(r.label),r.game_date.slice(0,7),r.features[pos]===null?null:String(r.features[pos]),r.categorical.previous_event_type,r.source_sha256]);}
 const counts=new Counts();for await(const r of lines(path.join(run,'rows.jsonl'))){counts.add(r);const old=originals.get(key(r));const prior=r.previous_period&&r.previous_period.number===r.current_period.number&&r.previous_period.periodType===r.current_period.periodType?String(r.previous_type):null;check(old&&old[0]===r.target&&old[1]===r.month&&old[2]===r.state&&old[3]===prior&&old[4]===r.source_envelope_sha256,'Exact original export join');const stem=`scripts/proof/results/historical-official-freeze-20260906/${r.season}/pbp/${r.game_id}`;check(checked[stem+'.body.json']===r.source_body_sha256&&checked[stem+'.receipt.json']===r.source_receipt_sha256,'Row source hash binding');}
 check(counts.events===originals.size&&counts.events===manifest.counts.eligible_events&&counts.events===541067,'Full original population');const comparisons=counts.compare(read(path.join(run,'accounting.json')));const result=read(path.join(run,'result.json'));check(result.events===counts.events&&result.goals===counts.goals&&result.games===counts.games.size&&['publishable','production_changed','fits','predictions'].every(k=>result[k]===false),'Final result');
 check(await sha(hp)===healthSHA,'Late source health drift');check(JSON.stringify(inventory(run))===JSON.stringify([...Object.keys(health.files),'health.json'].sort()),'Late output inventory drift');for(const [n,d]of Object.entries(health.files))await pin(run,n,d);for(const [n,d]of Object.entries(checker))await pin(ROOT,n,d);
 await pin(ROOT,EXPORT+'/manifest.json',PINS.manifest);await pin(ROOT,EXPORT+'/development.jsonl',PINS.export);
 await save('report.json',{source_directory:path.relative(ROOT,run),source_health_sha256:healthSHA,checker_sha256:checker,pins:PINS,events:counts.events,games:counts.games.size,goals:counts.goals,rollup_cells_compared:comparisons,current_consumed_hashes_verified:Object.keys(checked).length,publishable:false,fits:false,limitations:['Saved raw clock/period/coordinate/actor arithmetic independently recomputed.','Original export membership and hashes checked; no independent full raw-body feature reconstruction.','Current-revision descriptive consistency, not physically correct timing or causal evidence.']});
 await save('health.json',{status:'complete-independent-timing-era-review',publishable:false,files:{...files}});
 }catch(error){await save('failure.json',{error:String(error),publishable:false,files:{...files}});throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const args=process.argv.slice(2);check(args.length===4&&args[0]==='--run'&&args[2]==='--output','--run DIR --output DIR');await review(args[1],args[3]);}
