"""Audit actual worker downloads against raw canonical counts, not the scorer."""
import argparse,csv,hashlib,json,math,re
from pathlib import Path
import pymupdf as fitz
from customer_data import verify_snapshot,require_preseason_horizon
from draft_tracker import verify_forms

LABELS={'goals':'goals','assists':'assists','shots_on_goal':'shots on goal',
 'power_play_points':'power-play points','short_handed_points':'short-handed points',
 'hits':'hits','blocks':'blocks','penalty_minutes':'penalty minutes','plus_minus':'plus/minus',
 'wins':'wins','saves':'saves','goals_against':'goals against','shutouts':'shutouts'}

def verify(root,data,source_root):
    verify_snapshot(data,source_root=source_root);require_preseason_horizon(data)
    receipt=json.loads((root/'receipt.json').read_text())
    artifacts={a['format']:Path(a['path']) for a in receipt['artifacts']}
    if set(artifacts)!={'csv','desk','tracker','cheatsheet','pdf'}:raise ValueError('Missing format')
    for a in receipt['artifacts']:
        raw=Path(a['path']).read_bytes()
        if len(raw)!=a['bytes'] or hashlib.sha256(raw).hexdigest()!=a['sha256']:
            raise ValueError('Download bytes differ from receipt')
    desk=json.loads((root/'connected.json').read_text())
    embedded=re.search(r'<script id="kit-data" type="application/json">(.*?)</script>',artifacts['desk'].read_text(),re.S)
    if not embedded or json.loads(embedded[1])!=desk:raise ValueError('Offline and connected desks differ')
    if desk['revision']!=data['canonicalRevision'] or receipt['revision']!=desk['revision']:
        raise ValueError('Download revision differs')
    if desk['weights']!=data['weights']:raise ValueError('Acceptance scoring differs')
    bykey={p['key']:p for p in data['players']}
    rows=list(csv.DictReader(artifacts['csv'].read_text(encoding='utf-8-sig').splitlines()))
    if len(rows)!=300 or len(desk['players'])!=300 or len({p['key'] for p in desk['players']})!=300:
        raise ValueError('Board coverage differs')
    checked=0;form_players=[]
    def equal(a,b):
        if not math.isfinite(float(a)) or not math.isclose(float(a),float(b),rel_tol=1e-12,abs_tol=1e-10):
            raise ValueError(f'Canonical number mismatch: {a} vs {b}')
    for rank,(row,p) in enumerate(zip(rows,desk['players']),1):
        source=bykey[p['key']];counts=source['canonicalCounts']
        if (int(row['Overall rank'])!=rank or p['rank']!=rank
            or row['NHL player ID']!=str(source['playerId']) or row['Player']!=source['name']
            or row['Team']!=source['team'] or row['Position']!=source['position']
            or row['Projection revision']!=desk['revision'] or p['name']!=source['name']
            or p['team']!=source['team'] or p['totals']!=counts):raise ValueError('Player identity/counts differ')
        if json.loads(row['Scoring weights JSON'])!=desk['weights']:raise ValueError('CSV scoring differs')
        group='goalie' if source['isGoalie'] else 'skater'
        expected=sum(counts.get(stat,0)*weight for stat,weight in desk['weights'][group].items())
        equal(p['points'],expected);equal(row['Projected fantasy points'],expected)
        equal(p['games'],source['games'])
        equal(row['Projected goalie starts' if source['isGoalie'] else 'Projected games'],source['games'])
        for stat,label in LABELS.items():
            cell=row['Projected '+label]
            if stat in counts:equal(cell,counts[stat]);checked+=1
            elif cell!='':raise ValueError('Missing stat fabricated in CSV')
        form_players.append(dict(source,overallRank=rank))
    verify_forms(artifacts['tracker'],form_players);verify_forms(artifacts['pdf'],form_players)
    pages={}
    for format in ('tracker','cheatsheet','pdf'):
        with fitz.open(artifacts[format]) as pdf:
            pages[format]=len(pdf)
            for page in pdf:
                for word in page.get_text('words'):
                    if word[0]<-.5 or word[1]<-.5 or word[2]>page.rect.width+.5 or word[3]>page.rect.height+.5:
                        raise ValueError('Download text outside page: '+format)
    if pages['tracker']!=6 or pages['cheatsheet']!=4:raise ValueError('Print sheet coverage differs')
    return dict(status='PASS',revision=desk['revision'],players=300,rawStatComparisons=checked,
                pages=pages,scope='Actual local worker artifacts; not live publication or forecast accuracy approval')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('downloads',type=Path);p.add_argument('--data',type=Path,required=True)
    p.add_argument('--source-root',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();report=verify(a.downloads,json.loads(a.data.read_text()),a.source_root)
    with a.output.open('x') as f:json.dump(report,f,indent=2)
    print(json.dumps(report,indent=2))
