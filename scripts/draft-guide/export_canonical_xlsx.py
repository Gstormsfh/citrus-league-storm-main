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


def payload(canonical, editorial, revision, league='Citrus default scoring', weights=None):
    data = convert(canonical, editorial, revision)
    if weights is not None:
        for group in ('skater', 'goalie'):
            if set(weights.get(group, {})) != set(data['weights'][group]):
                raise ValueError('Scoring categories must match supported guide categories')
            for value in weights[group].values():
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not __import__('math').isfinite(value):
                    raise ValueError('Scoring weights must be finite numbers')
        data['weights'] = weights
    return {'data': data, 'canonical': canonical, 'keys': KEYS, 'league': league,
            'scoringHash': sha256(json.dumps(data['weights'], sort_keys=True, separators=(',', ':')).encode()).hexdigest()}


BUILDER = r'''
import fs from 'node:fs/promises';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';
const [input,output,preview]=process.argv.slice(2);
const x=JSON.parse(await fs.readFile(input,'utf8')),d=x.data,c=x.canonical;
const w=Workbook.create();
const names=['Read Me','Scoring','Players','Team Notes','Source History',...d.teams.map(t=>t.team)];
for(const name of names)w.worksheets.add(name);
const col=n=>{let s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)}return s};
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
 ['Unsupported category','Plus/minus is preserved in Source History, outside the current guide scorer.'],
 ['Team membership','Team tabs include canonical members and lineup slots. Slots remain scenarios; null identities are unassigned.'],
 ['Publication blockers',JSON.stringify(c.publish_blockers)],
 ],{A:28,B:105});
w.worksheets.getItem('Read Me').getRange('B2:B14').format.wrapText=true;
w.worksheets.getItem('Read Me').getRange('A7:B14').format.rowHeight=48;
const sc=put('Scoring',[
 ['Scoring group','League',...x.keys],
 ['DRAFT',x.league],['Initial revision',d.canonicalRevision],['Weights below','Editable yellow cells'],
 ['Skater',x.league,...x.keys.map(k=>d.weights.skater[k]??0)],
 ['Goalie',x.league,...x.keys.map(k=>d.weights.goalie[k]??0)]
],{A:22,B:32});
sc.getRange('C5:N6').format.fill='#E6E6E6';sc.getRange('C5:N6').format.numberFormat='0.00';
for(const [group,r]of [['skater',5],['goalie',6]])for(let j=0;j<x.keys.length;j++)if(Object.hasOwn(d.weights[group],x.keys[j]))sc.getRange(`${col(j+3)}${r}`).format.fill='#FFF1BA';
sc.getRange('A8:N8').merge();sc.getRange('A8').values=[['Yellow: supported editable scoring inputs. Grey: unsupported categories, fixed zero; not used by the guide scorer.']];sc.getRange('A8:N8').format.wrapText=true;sc.getRange('A8:N8').format.rowHeight=32;
const headers=['NHL ID','Player','Team','Position','Provenance','Forecast status','Games / starts','Roster probability','Probability semantics','Availability','Availability as of','Authority','Reason','Line','PP','Rate policy','Exposure policy','Source evidence','Legacy overrides',...x.keys.map(k=>'Rate '+k),...x.keys.map(k=>'Season '+k),'FPTS'];
const rows=[headers],byId=new Map();
for(const p of d.players){const a=p.availability;byId.set(p.playerId,rows.length+1);rows.push([p.playerId,p.name,p.team,p.position,p.source,p.forecastStatus,p.games,p.rosterProbability,p.exposureSemantics,a.status,a.as_of,a.authority,a.reason,p.line,p.powerPlay,p.ratePolicy,p.exposurePolicy,JSON.stringify(p.canonicalSources),JSON.stringify(p.legacyOverrides),...x.keys.map(k=>p.canonicalRates[k]??null),...Array(13).fill(null)])}
const ps=put('Players',rows,{A:14,B:25,F:18,I:24,M:45,R:45,S:45});
ps.getRange(`G2:G${rows.length}`).format.numberFormat='0.0';ps.getRange(`H2:H${rows.length}`).format.numberFormat='0.0%';
ps.getRange(`T2:AE${rows.length}`).format.numberFormat='0.0000';ps.getRange(`AF2:AR${rows.length}`).format.numberFormat='0.0';
const formulas=[];
for(let i=0;i<d.players.length;i++){
 const p=d.players[i],r=i+2;
 const counts=x.keys.map((k,j)=>`=IF(OR($F${r}<>"projected",NOT(ISNUMBER($G${r}))),"",IF($G${r}=0,0,IF(ISNUMBER(${col(20+j)}${r}),${col(20+j)}${r}*$G${r},"")))`);
 const group=p.isGoalie?6:5;
 counts.push(`=IF(OR($F${r}<>"projected",NOT(ISNUMBER($G${r}))),"",IF($G${r}=0,0,SUMPRODUCT(T${r}:AE${r},'Scoring'!$C$${group}:$N$${group})*$G${r}))`);formulas.push(counts);
}
ps.getRange(`AF2:AR${rows.length}`).formulas=formulas;
const notes=[['Team','Row','Column','Authority','Text']];
for(const t of d.teams)for(const n of t.canonicalNotes)notes.push([t.team,n.row??null,n.column??null,n.authority??null,n.text??null]);
put('Team Notes',notes,{A:12,B:10,C:10,D:24,E:110}).getRange(`E2:E${notes.length}`).format.wrapText=true;
const history=[['Scope','Identity','Field','Source record']];
for(const p of c.players){for(const s of p.sources)history.push(['Player',p.player_id,'source',JSON.stringify(s)]);history.push(['Player',p.player_id,'availability',JSON.stringify(p.availability)]);history.push(['Player',p.player_id,'exposure',JSON.stringify(p.exposure)]);history.push(['Player',p.player_id,'rates',JSON.stringify(p.rates)]);if(p.legacy_overrides?.length)history.push(['Player',p.player_id,'legacy_overrides',JSON.stringify(p.legacy_overrides)]);}
for(const entry of c.review_history??[])history.push(['Revision',c.revision,'review_history',JSON.stringify(entry)]);
put('Source History',history,{A:14,B:16,C:22,D:120}).getRange(`D2:D${history.length}`).format.wrapText=true;
for(const t of d.teams){
 const tr=[['NHL ID','Player / slot','Position','Forecast status','Games / starts','FPTS','Availability','Line','PP'],['DRAFT',d.canonicalRevision,null,null,'Scoring',x.league],['Canonical members']];
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
 s.getRange('B2:D2').merge();s.getRange('F2:I2').merge();s.getRange('A2:I2').format.wrapText=true;s.getRange('A2:I2').format.rowHeight=44;
 for(const [dest,src]of references)s.getRange(`E${dest}:F${dest}`).formulas=[[`=IF(ISNUMBER('Players'!G${src}),'Players'!G${src},"")`,`=IF(ISNUMBER('Players'!AR${src}),'Players'!AR${src},"")`]];
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


def export(canonical_path, editorial_path, revision, output, *, league='Citrus default scoring', weights=None):
    output = Path(output).resolve()
    if output.exists() or output.suffix.lower() != '.xlsx':
        raise ValueError('Choose a new .xlsx output path')
    x = payload(json.loads(Path(canonical_path).read_text()), json.loads(Path(editorial_path).read_text()), revision, league, weights)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='citrus-canonical-xlsx-') as folder:
        work = Path(folder)
        (work / 'node_modules').symlink_to(RUNTIME / 'node/node_modules', target_is_directory=True)
        (work / 'input.json').write_text(json.dumps(x, allow_nan=False))
        (work / 'build.mjs').write_text(BUILDER)
        subprocess.run([os.environ.get('CITRUS_NODE', str(RUNTIME / 'node/bin/node')), str(work/'build.mjs'), str(work/'input.json'), str(output), str(output.with_suffix('.preview.png'))], check=True, timeout=600)
    return output


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('canonical',type=Path);p.add_argument('--revision',required=True);p.add_argument('--editorial',type=Path,default=ROOT/'workbook-data.json');p.add_argument('--output',type=Path,required=True);p.add_argument('--settings',type=Path);p.add_argument('--league',default='Citrus default scoring');a=p.parse_args()
    settings=json.loads(a.settings.read_text()) if a.settings else None
    print(export(a.canonical,a.editorial,a.revision,a.output,league=a.league,weights=settings.get('weights',settings) if settings else None))


if __name__=='__main__':main()
