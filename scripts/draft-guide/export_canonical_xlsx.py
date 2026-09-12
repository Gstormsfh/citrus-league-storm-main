"""Create a formula-driven offline DRAFT workbook using bundled artifact-tool.

Requires explicit canonical revision and separate --output .xlsx. Changing this
review export does not patch, approve, activate or publish canonical inputs.
"""
import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess
import tempfile
from import_canonical import convert

ROOT = Path(__file__).resolve().parent
RUNTIME = Path.home() / '.cache/codex-runtimes/codex-primary-runtime/dependencies'
KEYS = ['goals','assists','power_play_points','short_handed_points','shots_on_goal','blocks','hits','penalty_minutes','wins','saves','shutouts','goals_against']


def payload(canonical, editorial, revision, league='Citrus default scoring', weights=None, *, revision_preimage=None, runtime_run_id=None, runtime_activated_at=None):
    kwargs = {}
    if revision_preimage is not None: kwargs['revision_preimage'] = revision_preimage
    if runtime_run_id is not None: kwargs['runtime_run_id'] = runtime_run_id
    if runtime_activated_at is not None: kwargs['runtime_activated_at'] = runtime_activated_at
    data = convert(canonical, editorial, revision, **kwargs)
    if weights is not None:
        for group in ('skater', 'goalie'):
            supplied = set(weights.get(group, {}))
            expected = set(data['weights'][group]) - {'plus_minus'}
            optional = {'plus_minus'} if group == 'skater' else set()
            if supplied - optional != expected or supplied - expected - optional:
                raise ValueError('Scoring categories must match supported guide categories')
            for value in weights[group].values():
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not __import__('math').isfinite(value):
                    raise ValueError('Scoring weights must be finite numbers')
        data['weights'] = weights
    keys = KEYS + (['plus_minus'] if 'plus_minus' in data['weights']['skater'] else [])
    return {'data': data, 'canonical': canonical, 'keys': keys, 'league': league,
            'scoringHash': sha256(json.dumps(data['weights'], sort_keys=True, separators=(',', ':')).encode()).hexdigest()}



BUILDER = r'''
import fs from 'node:fs/promises';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';
const [input,output,preview]=process.argv.slice(2);
const x=JSON.parse(await fs.readFile(input,'utf8')),d=x.data,c=x.canonical;
const edition=d.edition??{},remaining=edition.horizon==='remaining_season';
const horizon=remaining?'Remaining season':'Full season';
const volumeLabel=remaining?'Remaining games / starts':'Full-season games / starts';
const w=Workbook.create();
const names=['Read Me','Scoring','Players','Team Notes','Source History',...d.teams.map(t=>t.team)];
for(const name of names)w.worksheets.add(name);
const col=n=>{let s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)}return s};
const rateEnd=col(19+x.keys.length),countStart=col(20+x.keys.length),scoreColumn=col(20+2*x.keys.length),weightEnd=col(2+x.keys.length);
function put(name,rows,widths={}){
 const s=w.worksheets.getItem(name),nc=Math.max(...rows.map(r=>r.length)),nr=rows.length;
 s.getRange(`A1:${col(nc)}${nr}`).values=rows.map(r=>[...r,...Array(nc-r.length).fill(null)]);
 s.getRange(`A1:${col(nc)}${nr}`).format.font={name:'Arial',size:10};
 s.getRange(`A1:${col(nc)}${nr}`).format.rowHeight=22;
 s.getRange(`A1:${col(nc)}${nr}`).format.columnWidth=15;
 s.getRange(`A1:${col(nc)}1`).format={fill:'#173D2A',font:{name:'Arial',size:10,bold:true,color:'#FFFFFF'},rowHeight:34,wrapText:true};
 for(const [letter,width] of Object.entries(widths))s.getRange(`${letter}1:${letter}${nr}`).format.columnWidth=width;
 s.showGridLines=false;s.freezePanes.freezeRows(1);return s;
}
put('Read Me',[
 ['Citrus canonical export','DRAFT — LOCAL SCORING PREVIEW'],
 ['Canonical revision',d.canonicalRevision],['As of',c.as_of],['Season',c.season],
 ['Scoring label',x.league],['Initial scoring fingerprint',x.scoringHash],
 ['Authority','This workbook is an offline review export. Changes do not alter or approve canonical inputs.'],
 ['Scoring','Edit yellow Scoring cells to recalculate FPTS. The initial fingerprint identifies export settings, not later Excel edits.'],
 ['Exposure','Rates are already per game/start. Counts = rate × explicit exposure once.'],
 ['Unavailable forecasts','Blank exposure and unavailable FPTS remain blank, never zero. Availability is separate from forecast coverage.'],
 ['Probability','Roster probability is metadata only. It never multiplies counts or fantasy points.'],
 ['Plus/minus',x.keys.includes('plus_minus')?'Signed plus/minus uses the selected skater weight; missing enabled values withhold FPTS.':'Preserved in Source History; not configured in this scoring edition.'],
 ['Team membership','Team tabs include canonical members and lineup slots. Slots remain scenarios; null identities are unassigned.'],
 ['Publication blockers',JSON.stringify(c.publish_blockers)],
 ['Forecast horizon',horizon],
 ['Parent source revision',edition.parentSourceRevision??d.canonicalRevision],
 ['Runtime revision',edition.runtimeRevision??null],
 ['Runtime run ID',edition.runtimeRunId??null],
 ['Source as of',edition.sourceAsOf??c.as_of],
 ['Runtime as of',edition.kind==='effective_runtime'?edition.asOf:null],
 [edition.componentRepair?'Inherited model refresh at':'Runtime refreshed at',edition.refreshedAt?`UTC ${edition.refreshedAt}`:null],
 ['Exposure provenance','Source History keeps original full-season exposure and runtime remaining exposure separately. Displayed counts and FPTS use the labeled horizon.'],
 ...(edition.activatedAt?[['Runtime activated at',`UTC ${edition.activatedAt}`]]:[]),
 ...(edition.parentRuntimeRevision?[['Parent runtime revision',edition.parentRuntimeRevision]]:[]),
 ],{A:28,B:105});
w.worksheets.getItem('Read Me').getRange(`B2:B${22+(edition.activatedAt?1:0)+(edition.parentRuntimeRevision?1:0)}`).format.wrapText=true;
w.worksheets.getItem('Read Me').getRange(`A7:B${22+(edition.activatedAt?1:0)+(edition.parentRuntimeRevision?1:0)}`).format.rowHeight=48;
const sc=put('Scoring',[
 ['Scoring group','League',...x.keys],
 ['DRAFT',x.league],['Initial revision',d.canonicalRevision],['Weights below','Editable yellow cells'],
 ['Skater',x.league,...x.keys.map(k=>d.weights.skater[k]??0)],
 ['Goalie',x.league,...x.keys.map(k=>d.weights.goalie[k]??0)]
],{A:22,B:32});
sc.getRange(`C5:${weightEnd}6`).format.fill='#E6E6E6';sc.getRange(`C5:${weightEnd}6`).format.numberFormat='0.00';
for(const [group,r]of [['skater',5],['goalie',6]])for(let j=0;j<x.keys.length;j++)if(Object.hasOwn(d.weights[group],x.keys[j]))sc.getRange(`${col(j+3)}${r}`).format.fill='#FFF1BA';
sc.getRange(`A8:${weightEnd}8`).merge();sc.getRange('A8').values=[['Yellow: supported editable scoring inputs. Grey: unsupported categories, fixed zero; not used by the guide scorer.']];sc.getRange(`A8:${weightEnd}8`).format.wrapText=true;sc.getRange(`A8:${weightEnd}8`).format.rowHeight=32;
const headers=['NHL ID','Player','Team','Position','Provenance','Forecast status',volumeLabel,'Roster probability','Probability semantics','Availability','Availability as of','Authority','Reason','Line','PP','Rate policy','Exposure policy','Source evidence','Legacy overrides',...x.keys.map(k=>'Rate '+k),...x.keys.map(k=>(remaining?'Remaining ':'Full season ')+k),'FPTS'];
const rows=[headers],byId=new Map();
for(const p of d.players){const a=p.availability;byId.set(p.playerId,rows.length+1);rows.push([p.playerId,p.name,p.team,p.position,p.source,p.forecastStatus,p.games,p.rosterProbability,p.exposureSemantics,a.status,a.as_of,a.authority,a.reason,p.line,p.powerPlay,p.ratePolicy,p.exposurePolicy,JSON.stringify(p.canonicalSources),JSON.stringify(p.legacyOverrides),...x.keys.map(k=>p.canonicalRates[k]??null),...Array(x.keys.length+1).fill(null)])}
const ps=put('Players',rows,{A:14,B:25,F:18,I:24,M:45,R:45,S:45});
ps.getRange(`G2:G${rows.length}`).format.numberFormat='0.0';ps.getRange(`H2:H${rows.length}`).format.numberFormat='0.0%';
ps.getRange(`T2:${rateEnd}${rows.length}`).format.numberFormat='0.0000';ps.getRange(`${countStart}2:${scoreColumn}${rows.length}`).format.numberFormat='0.0';
const formulas=[];
for(let i=0;i<d.players.length;i++){
 const p=d.players[i],r=i+2;
 const counts=x.keys.map((k,j)=>`=IF(OR($F${r}<>"projected",NOT(ISNUMBER($G${r}))),"",IF($G${r}=0,${p.canonicalCounts?.[k]===0?'0':'""'},IF(ISNUMBER(${col(20+j)}${r}),${col(20+j)}${r}*$G${r},"")))`);
 const group=p.isGoalie?6:5;
 const missing=x.keys.map((k,j)=>Object.hasOwn(d.weights[p.isGoalie?'goalie':'skater'],k)?`AND('Scoring'!$${col(j+3)}$${group}<>0,NOT(ISNUMBER(${col(20+j)}${r})),NOT(AND($G${r}=0,${p.canonicalCounts?.[k]===0?'TRUE':'FALSE'})))`:null).filter(Boolean).join(',');
 counts.push(`=IF(OR($F${r}<>"projected",NOT(ISNUMBER($G${r}))),"",IF(OR(${missing}),"",IF($G${r}=0,0,SUMPRODUCT(T${r}:${rateEnd}${r},'Scoring'!$C$${group}:$${weightEnd}$${group})*$G${r})))`);formulas.push(counts);
}
ps.getRange(`${countStart}2:${scoreColumn}${rows.length}`).formulas=formulas;
const notes=[['Team','Row','Column','Authority','Text']];
for(const t of d.teams)for(const n of t.canonicalNotes)notes.push([t.team,n.row??null,n.column??null,n.authority??null,n.text??null]);
put('Team Notes',notes,{A:12,B:10,C:10,D:24,E:110}).getRange(`E2:E${notes.length}`).format.wrapText=true;
const history=[['Scope','Identity','Field','Source record']];
for(const p of c.players){for(const s of p.sources)history.push(['Player',p.player_id,'source',JSON.stringify(s)]);history.push(['Player',p.player_id,'availability',JSON.stringify(p.availability)]);history.push(['Player',p.player_id,'exposure',JSON.stringify(p.exposure)]);history.push(['Player',p.player_id,'rates',JSON.stringify(p.rates)]);if(p.legacy_overrides?.length)history.push(['Player',p.player_id,'legacy_overrides',JSON.stringify(p.legacy_overrides)]);}
if(edition.kind==='effective_runtime'){
 history.push(['Edition',edition.runtimeRevision,'runtime_identity',JSON.stringify(edition)]);
 for(const p of d.players){history.push(['Player',p.playerId,'full_season_exposure',JSON.stringify(p.canonicalExposure)]);history.push(['Player',p.playerId,'remaining_exposure',JSON.stringify(p.canonicalRemaining)]);if(p.canonicalRateComponents)history.push(['Player',p.playerId,'rate_components',JSON.stringify(p.canonicalRateComponents)]);}
}
for(const entry of c.review_history??[])history.push(['Revision',c.revision,'review_history',JSON.stringify(entry)]);
put('Source History',history,{A:14,B:16,C:22,D:120}).getRange(`D2:D${history.length}`).format.wrapText=true;
for(const t of d.teams){
 const tr=[['NHL ID','Player / slot','Position','Forecast status',volumeLabel,'FPTS','Availability','Line','PP'],['DRAFT',d.canonicalRevision,null,null,'Scoring',x.league],[horizon,edition.kind==='effective_runtime'?`Source ${edition.parentSourceRevision}; run ${edition.runtimeRunId}; as of ${edition.asOf}`:'Canonical members']];
 const references=[];
 for(const p of d.players.filter(p=>p.team===t.team)){const r=byId.get(p.playerId);references.push([tr.length+1,r]);tr.push([p.playerId,p.name,p.position,p.forecastStatus,null,null,p.availability.status,p.line,p.powerPlay]);}
 tr.push([],['Lineup slots']);
 for(const slot of t.lineupSlots){const r=byId.get(slot.player_id);const pos=tr.length+1;tr.push([slot.player_id,`${slot.slot??''} ${slot.name}`,slot.position,slot.snapshot_status,null,null,slot.notes??null]);if(r)references.push([pos,r]);}
 tr.push([],['Special teams']);for(const st of t.specialTeams)tr.push([st.unit,st.imported_text,st.snapshot_status]);
 tr.push([],['Team notes','Canonical source notes and reviewed text']);
 const noteRows=[];
 for(const n of t.canonicalNotes){
  const text=String(n.text??'');const chunks=text.match(/[\s\S]{1,1800}/g)||[''];
  for(const chunk of chunks){noteRows.push([tr.length+1,chunk]);tr.push([`Row ${n.row??'new'} / Col ${n.column??'-'} / ${n.authority??'unknown'}`,chunk]);}
 }
 const s=put(t.team,tr,{A:14,B:40,C:14,D:20,E:17,F:15,G:35});
 if(edition.kind==='effective_runtime'){s.getRange('B3:I3').merge();s.getRange('A3:I3').format.wrapText=true;s.getRange('A3:I3').format.rowHeight=44;}
 s.getRange('B2:D2').merge();s.getRange('F2:I2').merge();s.getRange('A2:I2').format.wrapText=true;s.getRange('A2:I2').format.rowHeight=44;
 for(const [dest,src]of references)s.getRange(`E${dest}:F${dest}`).formulas=[[`=IF(ISNUMBER('Players'!G${src}),'Players'!G${src},"")`,`=IF(ISNUMBER('Players'!${scoreColumn}${src}),'Players'!${scoreColumn}${src},"")`]];
 s.getRange(`E2:F${tr.length}`).format.numberFormat='0.0';
 for(const [r,text]of noteRows){s.getRange(`B${r}:I${r}`).merge();s.getRange(`A${r}:I${r}`).format.wrapText=true;s.getRange(`A${r}:I${r}`).format.rowHeight=Math.max(65,Math.ceil(text.length/145)*15+12);}

}
const errors=await w.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30},summary:'formula errors'});
console.log(errors.ndjson);
console.log((await w.inspect({kind:'table',range:'Players!A1:H5',include:'values,formulas',tableMaxRows:5,tableMaxCols:8})).ndjson);
const ana=w.worksheets.getItem('ANA');const anaNotes=ana.getUsedRange().values.findIndex(r=>r[0]==='Team notes')+1;
const noteImage=await w.render({sheetName:'ANA',range:`A${anaNotes}:I${anaNotes+5}`,scale:1.3});await fs.writeFile(preview.replace('.png','-notes.png'),new Uint8Array(await noteImage.arrayBuffer()));
const image=await w.render({sheetName:'ANA',range:'A1:I12',scale:1.3});await fs.writeFile(preview,new Uint8Array(await image.arrayBuffer()));
await(await SpreadsheetFile.exportXlsx(w)).save(output);
'''


def export(canonical_path, editorial_path, revision, output, *, league='Citrus default scoring', weights=None, revision_preimage=None, runtime_run_id=None, runtime_activated_at=None):
    output = Path(output).resolve()
    if output.exists() or output.suffix.lower() != '.xlsx':
        raise ValueError('Choose a new .xlsx output path')
    x = payload(json.loads(Path(canonical_path).read_text()), json.loads(Path(editorial_path).read_text()), revision, league, weights, revision_preimage=revision_preimage, runtime_run_id=runtime_run_id, runtime_activated_at=runtime_activated_at)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='citrus-canonical-xlsx-') as folder:
        work = Path(folder)
        (work / 'node_modules').symlink_to(RUNTIME / 'node/node_modules', target_is_directory=True)
        (work / 'input.json').write_text(json.dumps(x, allow_nan=False))
        (work / 'build.mjs').write_text(BUILDER)
        subprocess.run([os.environ.get('CITRUS_NODE', str(RUNTIME / 'node/bin/node')), str(work/'build.mjs'), str(work/'input.json'), str(output), str(output.with_suffix('.preview.png'))], check=True, timeout=600)
    return output


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('canonical',type=Path);p.add_argument('--revision',required=True);p.add_argument('--editorial',type=Path,default=ROOT/'workbook-data.json');p.add_argument('--output',type=Path,required=True);p.add_argument('--settings',type=Path);p.add_argument('--league',default='Citrus default scoring');p.add_argument('--revision-preimage',type=Path);p.add_argument('--runtime-run-id');p.add_argument('--runtime-activated-at');a=p.parse_args()
    settings=json.loads(a.settings.read_text()) if a.settings else None
    print(export(a.canonical,a.editorial,a.revision,a.output,league=a.league,weights=settings.get('weights',settings) if settings else None,revision_preimage=a.revision_preimage.read_text() if a.revision_preimage else None,runtime_run_id=a.runtime_run_id,runtime_activated_at=a.runtime_activated_at))


if __name__=='__main__':main()
