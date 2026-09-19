"""Cache the existing Citrus directory's NHL-ID portraits for review PDFs.

These are reference assets, not a commercial photo licence. Never substitute
another player's portrait or an arena photo when an identity cannot be resolved.
"""
import concurrent.futures, hashlib, io, json, re, unicodedata, subprocess, os
from pathlib import Path
from urllib.request import urlopen
from PIL import Image
from scoring import calculate
from customer_data import top_players

ROOT=Path(__file__).resolve().parent
CACHE=Path(os.environ.get('CITRUS_DRAFT_KIT_ASSETS',str(ROOT/'assets')))/'headshots'
# Explicit, NHL-ID-scoped directory aliases. Never join two Petterssons by name.
ALIASES={'8484210':('Gabriel Perreault','Gabe Perreault'),
         '8480064':('Joshua Norris','Josh Norris'),
         '8482737':('Zack Bolduc','Zachary Bolduc'),
         '8483678':('Elias N. Pettersson','Elias Pettersson'),
         '8478136':('Jacob Middleton','Jake Middleton')}
ARTICLE_IMAGES={
    '8486067':('https://www.nhl.com/news/gavin-mckenna-signs-entry-level-contract-with-toronto-maple-leafs','https://media.d3.nhle.com/image/private/t_ratio16_9-size50/v1783121418/prd/viiafvbox0hmbyqucinf.jpg'),
    '8484390':('https://frontend.d3.nhle.com/fr/news/roman-kantserov-khl-premier-trio-blackhawks-chicago-bedard','https://media.d3.nhle.com/image/private/t_ratio16_9-size50/v1785785399/prd/foxqoftegzgyis30ohkt.png'),
    '8486103':('https://www.nhl.com/sharks/news/sharks-sign-forward-ivar-stenberg-to-an-entry-level-contract','https://media.d3.nhle.com/image/private/t_ratio16_9-size50/prd/ufrgapzagfn6x6svvdqy.jpg')}
# Visually checked against the named subjects in the official articles.
REVIEWED_ARTICLE_HASHES={'8486067':'72899da57698a193bd9f3d52c272deb2aa26f53df7915cde1bfe761c30a919af',
 '8484390':'b814ed52f3f23599055085fab7b6e37439a3e249e0ad91f4b3a216009a38436b',
 '8486103':'6b7e651b067f2987fae95c37721a1502739f4f01315d7614974bda04ff0835dc'}

def normalized(name):
    return ''.join(c for c in unicodedata.normalize('NFKD',name).casefold() if c.isalnum())

def fetch_portrait(p, directory):
    pid=str(p['playerId']);d=directory.get(pid)
    if not d or (normalized(d['full_name'])!=normalized(p['name']) and
                 ALIASES.get(pid)!=(p['name'],d['full_name'])):
        return pid,dict(name=p['name'],status='identity-unresolved')
    url=d.get('headshot_url','')
    if not re.fullmatch(r'https://assets\.nhle\.com/mugs/nhl/\d{8}/[A-Z]+/'+pid+r'\.png',url):
        return pid,dict(name=p['name'],status='source-unresolved')
    target=CACHE/(pid+'.png')
    try:
        blob=target.read_bytes() if target.exists() else urlopen(url,timeout=20).read()
        im=Image.open(io.BytesIO(blob));im.load()
        if min(im.size)<100:raise ValueError('Image too small')
        if not target.exists():target.write_bytes(blob)
        return pid,dict(name=p['name'],directoryName=d['full_name'],playerId=pid,url=url,file=target.name,
                       sha256=hashlib.sha256(blob).hexdigest(),size=list(im.size),status='downloaded',
                       rights='Commercial permission not verified')
    except Exception as exc:
        return pid,dict(name=p['name'],url=url,status='unavailable',reason=str(exc))

def prepare_portraits(players, directory_rows):
    """Resolve the selected league's players, including newly reweighted entrants."""
    directory={str(d['player_id']):d for d in directory_rows}
    manifest=CACHE/'manifest.json'
    entries=json.loads(manifest.read_text()) if manifest.exists() else {}
    if os.environ.get('CITRUS_DRAFT_KIT_OFFLINE_ASSETS')=='true':
        # Paid rendering must be deterministic and must not download or modify
        # the shared asset bundle while processing a customer's request.
        for p in players:
            pid=str(p['playerId']);entry=entries.get(pid);record=directory.get(pid)
            if not entry or entry.get('status')!='downloaded' or not record:
                raise ValueError('Reviewed portrait unavailable: '+pid)
            if (str(entry.get('playerId'))!=pid or normalized(entry.get('name',''))!=normalized(p['name'])
                    or (normalized(record.get('full_name',''))!=normalized(p['name'])
                        and ALIASES.get(pid)!=(p['name'],record.get('full_name')))):
                raise ValueError('Reviewed portrait name mismatch: '+pid)
            path=(CACHE/entry['file']).resolve()
            if not path.is_relative_to(CACHE.resolve()) or hashlib.sha256(path.read_bytes()).hexdigest()!=entry['sha256']:
                raise ValueError('Reviewed portrait fingerprint mismatch: '+pid)
        return dict(requested=len(players),downloaded=len(players),issues={})
    CACHE.mkdir(parents=True,exist_ok=True)
    pending=[p for p in players if entries.get(str(p['playerId']),{}).get('status')!='downloaded'
             or not (CACHE/entries[str(p['playerId'])].get('file','missing')).exists()]
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        entries.update(dict(pool.map(lambda p:fetch_portrait(p,directory),pending)))
    # Identical responses across different IDs can be a generic silhouette.
    hashes={}
    for pid,e in entries.items():
        if e.get('sha256'):hashes.setdefault(e['sha256'],[]).append(pid)
    for ids in hashes.values():
        if len(ids)>1 or entries[ids[0]]['sha256']=='ae3f3b1a9ba14a92c24dfe676a09505bd17436d56aee1d13ec580696ee141151':
            for pid in ids:entries[pid]['status']='duplicate-image-review'
    for pid,e in entries.items():
        if e['status']!='duplicate-image-review':continue
        try:
            article,url=ARTICLE_IMAGES[pid]
            blob=subprocess.run(['node','--input-type=module','-e',
                'const r=await fetch(process.argv[1]);if(!r.ok)throw Error(r.status);process.stdout.write(Buffer.from(await r.arrayBuffer()));',url],
                capture_output=True,check=True,timeout=30).stdout
            im=Image.open(io.BytesIO(blob));im.load()
            target=CACHE/(pid+'-action.jpg');target.write_bytes(blob)
            e.update(url=url,sourcePage=article,file=target.name,sha256=hashlib.sha256(blob).hexdigest(),size=list(im.size),status='action-review')
            if e['sha256']==REVIEWED_ARTICLE_HASHES.get(pid):
                e.update(status='downloaded',kind='article-photo',focalX=.43 if pid=='8486103' else .5)
        except Exception as exc:e['reason']=str(exc)
    if pending:manifest.write_text(json.dumps(entries,indent=2))
    selected_ids={str(p['playerId']) for p in players}
    failures={pid:e for pid,e in entries.items() if pid in selected_ids and e['status']!='downloaded'}
    if failures:raise ValueError('Player photography needs review: '+', '.join(e['name'] for e in failures.values()))
    return dict(requested=len(selected_ids),downloaded=len(selected_ids),issues=failures)

def main():
    data=json.loads((ROOT/'review-inputs/guide-data.json').read_text())
    evidence=json.loads((ROOT/'review-inputs/editorial-evidence.json').read_text())
    selected={p['key']:p for p in top_players(calculate(data,data['weights']))}
    alternate=json.loads((ROOT/'review-inputs/bangers-settings.json').read_text())
    selected.update({p['key']:p for p in top_players(calculate(data,alternate.get('weights',alternate)))})
    print(json.dumps(prepare_portraits(list(selected.values()),evidence['directory']),indent=2))

if __name__=='__main__':main()
