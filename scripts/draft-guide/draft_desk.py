"""Single-file offline draft desk. Uses the existing customer board, not a new scorer."""
import base64,hashlib,json
from pathlib import Path
from customer_exports import select_board
from customer_data import raw_totals,clean
from layout import ASSETS

ROOT=Path(__file__).resolve().parent
def desk_payload(data,weights,league,*,source_root=None):
    players,weights=select_board(data,weights,source_root=source_root)
    payload=dict(version=1,league=clean(league),projectionDate=data['source']['asOf'][:10],
                 revision=data['canonicalRevision'],weights=weights,
                 players=[dict(key=p['key'],name=p['name'],team=p['team'],position=p['position'],
                               rank=p['overallRank'],points=p['fantasyPoints'],games=p['games'],
                               goalie=p['isGoalie'],totals=raw_totals(p)) for p in players])
    payload['fingerprint']=hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    return payload

def desk_html(data,weights,league,*,source_root=None):
    payload=desk_payload(data,weights,league,source_root=source_root)
    encoded=json.dumps(payload,ensure_ascii=True).replace('<','\\u003c').replace('>','\\u003e').replace('&','\\u0026')
    template=(ROOT/'draft_desk.html').read_text()
    script=(ROOT/'draft_desk.cjs').read_text()
    charts=(ROOT.parents[1]/'packages/shared/src/draftCompare/charts.js').read_text()
    font=base64.b64encode((ASSETS/'BarlowCondensed-Bold.ttf').read_bytes()).decode()
    # Insert untrusted data last so a league name cannot be interpreted as a template token.
    return template.replace('__DISPLAY_FONT__',font).replace('__DESK_SCRIPT__',charts+'\n'+script).replace('__KIT_DATA__',encoded).encode()

if __name__ == '__main__':
    import argparse
    parser=argparse.ArgumentParser(description='Build the offline desk with the existing Citrus board and default snapshot weights.')
    parser.add_argument('--data',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--league',required=True)
    args=parser.parse_args()
    data=json.loads(args.data.read_text())
    args.output.write_bytes(desk_html(data,data['weights'],args.league))
    print(args.output)
