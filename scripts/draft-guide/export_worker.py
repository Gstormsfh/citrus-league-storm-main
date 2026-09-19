"""Private API worker. One bounded JSON request on stdin, one download on stdout."""
import argparse
import json
import sys
import tempfile
from pathlib import Path
from customer_exports import rankings_csv, cheat_sheet
from customer_data import verify_snapshot

def run(request, data, *, source_root=None, editorial_root=None):
    name=request.get('league','')
    if not isinstance(name,str) or not 1<=len(name.strip())<=64:
        raise ValueError('League name must be 1-64 characters.')
    weights=request['weights']
    if not isinstance(weights,dict) or set(weights)!={'skater','goalie'}:
        raise ValueError('Both scoring groups are required.')
    for group in ('skater','goalie'):
        if not isinstance(weights[group],dict) or set(weights[group])!=set(data['weights'][group]):
            raise ValueError('Use the supported scoring categories shown in your settings.')
        for value in weights[group].values():
            if isinstance(value,bool) or not isinstance(value,(int,float)) or not -10000<=value<=10000:
                raise ValueError('Scoring weights must be finite numbers between -10000 and 10000.')
    kind=request['format']
    if kind=='connected':
        from draft_desk import desk_payload
        return json.dumps(desk_payload(data,weights,name,source_root=source_root),allow_nan=False).encode()
    if kind=='desk':
        from draft_desk import desk_html
        return desk_html(data,weights,name,source_root=source_root)
    if kind=='csv':return rankings_csv(data,weights,name,source_root=source_root)
    if kind=='cheatsheet':return cheat_sheet(data,weights,name,source_root=source_root)
    verify_snapshot(data,source_root=source_root)
    with tempfile.TemporaryDirectory(prefix='citrus-paid-export-') as folder:
        path=Path(folder)/'download.pdf'
        if kind=='tracker':
            from draft_tracker import generate_tracker
            generate_tracker(data,weights,name,path,source_root=source_root)
        elif kind=='pdf':
            from customer_edition import generate_customer
            options={'source_root':source_root}
            if editorial_root is not None:options['editorial_root']=editorial_root
            generate_customer(data,weights,name,path,**options)
        else:raise ValueError('Unknown download format.')
        return path.read_bytes()

if __name__=='__main__':
    try:
        parser=argparse.ArgumentParser(description=__doc__)
        parser.add_argument('data',type=Path);parser.add_argument('--source-root',type=Path)
        parser.add_argument('--editorial-root',type=Path);args=parser.parse_args()
        request=json.loads(sys.stdin.buffer.read(32769))
        data=json.loads(args.data.read_text())
        sys.stdout.buffer.write(run(request,data,source_root=args.source_root,editorial_root=args.editorial_root))
    except (ValueError,KeyError,TypeError) as error:
        print(str(error),file=sys.stderr)
        sys.exit(2)
