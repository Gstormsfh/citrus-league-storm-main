"""Independently check the customer PDF's rendered rows, links and source binding.

No forecast approval is implied. Review-only publication flags must survive.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import pymupdf as fitz
from customer_data import verify_snapshot,require_preseason_horizon,top_players
from scoring import calculate
from draft_tracker import verify_forms
from editorial_quality import validate_copy

def verify(path,data,source_root=None):
    verify_snapshot(data,source_root=source_root);require_preseason_horizon(data)
    manifest=json.loads(path.with_suffix('.manifest.json').read_text())
    if (manifest['canonicalRevision']!=data['canonicalRevision'] or manifest['source']!=data['source']
            or manifest.get('edition')!=data.get('edition') or manifest.get('publication')!=data.get('publication')
            or manifest.get('publicationReady') is not False):
        raise ValueError('PDF source/horizon/review binding differs')
    for file,digest in manifest['editorialFilesSha256'].items():
        if hashlib.sha256(Path(file).read_bytes()).hexdigest()!=digest:raise ValueError('Changed editorial evidence')
    players=top_players(calculate(data,manifest['weights']));bykey={p['key']:p for p in players}
    if len(players)!=300 or manifest['top300Keys']!=list(bykey):raise ValueError('Top 300 selection differs')
    rows=[];features=0;links=0
    with fitz.open(path) as doc:
        if len(doc)!=manifest['pages']:raise ValueError('PDF page coverage differs')
        for page in doc:
            validate_copy(page.get_text(),f'PDF page {page.number+1}')
            for word in page.get_text('words'):
                if word[0]<-.5 or word[1]<-.5 or word[2]>page.rect.width+.5 or word[3]>page.rect.height+.5:
                    raise ValueError('Text outside page bounds: '+str(page.number+1))
            for link in page.get_links():
                if link['kind']==fitz.LINK_GOTO and not 0<=link['page']<len(doc):raise ValueError('Invalid internal destination')
                links+=1
        for item in manifest['content']:
            if item.get('type')!='ranking':continue
            page=doc[item['page']-1];goalie=item['cohort']=='goalie'
            widths=[34,230,44,40,58,48,36,50] if goalie else [34,250,30,36,36,45,45,64]
            if not len(item['keys'])==len(item['rowBounds'])==len(item['ranks']):raise ValueError('Incomplete board geometry')
            for key,bounds,rank in zip(item['keys'],item['rowBounds'],item['ranks']):
                p=bykey[key];counts=p['canonicalCounts']
                if p['overallRank']!=rank or p['isGoalie']!=goalie:raise ValueError('Rank/cohort differs')
                # Independent of renderer raw_totals: supplied canonical counts
                # are the authoritative raw values, never weighted-stat bars.
                fmt=lambda value,d=1:f'{value:,.{d}f}'
                stats=([fmt(counts['wins']),fmt(counts['saves'],0),fmt(counts['goals_against'],0),fmt(counts['shutouts'])]
                       if goalie else [fmt(counts['goals']),fmt(counts['assists']),fmt(counts['goals']+counts['assists']),fmt(counts['shots_on_goal'],0)])
                expected=[str(rank),None,fmt(p['games'],0),*stats,fmt(p['fantasyPoints'])]
                x=bounds[0]
                for col,(width,value) in enumerate(zip(widths,expected)):
                    text=' '.join(page.get_text(clip=fitz.Rect(x+.5,bounds[1]+.2,x+width-.2,bounds[3]-.2)).split())
                    if col==1:
                        if p['name'] not in text:raise ValueError('Rendered player identity differs: '+key)
                    elif text!=value:raise ValueError(f'Rendered stat differs page {item["page"]} {key} column {col}: {text!r} != {value!r}')
                    x+=width
                rows.append(key)
            for feature in item['features']:
                idx=item['keys'].index(feature['featured']);row=item['rowBounds'][idx];card=feature['calloutBounds']
                if feature['highlightedKey']!=feature['featured'] or abs(row[3]-card[1])>.01:raise ValueError('Feature detached from its row')
                fills=[d for d in page.get_drawings() if d.get('fill') and d['fill'][0]>.9 and .7<d['fill'][1]<.95
                       and abs(d['rect'].y0-row[1])<.1 and abs(d['rect'].width-540)<.1]
                if not fills:raise ValueError('Missing featured row highlight')
                features+=1
        if Counter(rows)!=Counter(list(bykey)):raise ValueError('Board coverage is not exactly 300 unique players')
        teams=[r['team'] for r in manifest['content'] if r.get('type')=='team']
        if len(teams)!=32 or set(teams)!=set(data['schedule']):raise ValueError('Team coverage differs')
        for item in manifest['content']:
            if item.get('type')=='team' and item.get('campSource'):
                if item['campSource'] not in {link.get('uri') for link in doc[item['page']-1].get_links()}:
                    raise ValueError('Team camp note has no supporting source link: '+item['team'])
    verify_forms(path,players)
    return dict(status='PASS',canonicalRevision=data['canonicalRevision'],pages=manifest['pages'],
                rows=len(rows),featuredRows=features,links=links,teams=32,checklistPlayers=300,
                sourcePublicationReady=data['publication']['sourcePublicationReady'],publicationReady=False)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('pdf',type=Path)
    p.add_argument('--data',type=Path,required=True);p.add_argument('--source-root',type=Path);p.add_argument('--output',type=Path)
    args=p.parse_args();report=verify(args.pdf,json.loads(args.data.read_text()),args.source_root)
    if args.output:
        with args.output.open('x') as stream:json.dump(report,stream,indent=2)
    print(json.dumps(report,indent=2))
