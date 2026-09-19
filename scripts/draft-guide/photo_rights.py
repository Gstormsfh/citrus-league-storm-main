"""Trace actual PDF photo use to evidence. A credit is not a licence.

Review exports stay available. --require-basis is a separate photo-copyright
preflight, not an assertion of comprehensive legal or paid-launch clearance.
"""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).parent
ASSETS = ROOT / 'assets'


def photo_receipt(images, registry=None, portraits=None, assets=ASSETS):
    registry = registry if registry is not None else json.loads((ROOT/'photo-rights.json').read_text())
    portraits = portraits if portraits is not None else json.loads((assets/'headshots/manifest.json').read_text())
    entries = {}
    for image in images:
        asset = image['asset']
        portrait = image.get('kind') == 'player-portrait'
        pid = str(image.get('playerId', ''))
        key = 'portrait:'+pid if portrait else 'asset:'+str(asset)
        if key in entries and portrait:
            previous=entries[key]
            if (image.get('sha256')!=previous['sha256'] or image.get('url')!=previous['sourceUrl']
                    or Path(str(asset)).resolve()!=Path(previous['file'])):
                raise ValueError('Repeated photo placement changed source: '+pid)
        if key not in entries:
            if portrait:
                record = portraits.get(pid)
                if not record or record.get('status') != 'downloaded':
                    raise ValueError('Photo evidence identity missing: '+pid)
                path = (assets/'headshots'/record['file']).resolve()
                if not path.is_relative_to((assets/'headshots').resolve()):
                    raise ValueError('Photo path escapes asset directory')
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                if digest != record['sha256'] or digest != image.get('sha256'):
                    raise ValueError('Photo evidence hash mismatch: '+pid)
                if path != Path(str(asset)).resolve() or record['url'] != image.get('url'):
                    raise ValueError('Photo evidence source mismatch: '+pid)
                credit = registry.get('articleCredits', {}).get(pid, {})
                entries[key] = dict(id=key,playerId=pid,subject=image['subject'],file=str(path),
                    sha256=digest,sourcePage=record.get('sourcePage',record['url']),
                    sourceUrl=record['url'],credit=credit.get('credit'),
                    kind=record.get('kind','headshot'),status='permission_pending',
                    reason='Source and identity verified; no applicable reuse permission or reviewed exception is recorded.',
                    licence=None,advertisingApproval='not_assessed',uses=[])
            else:
                record = registry.get('publicLicences', {}).get(str(asset))
                if record:
                    path = (assets/str(asset)).resolve()
                    if not path.is_relative_to(assets.resolve()):raise ValueError('Photo path escapes asset directory')
                    digest = hashlib.sha256(path.read_bytes()).hexdigest()
                    if digest != record['sha256']:raise ValueError('Public-licence photo hash mismatch: '+str(asset))
                    entries[key] = dict(id=key,subject=image['subject'],file=str(path),sha256=digest,
                        sourcePage=record['sourcePage'],sourceUrl=record['originalSource'],credit=record['creator'],
                        title=record['title'],kind='action-photo',status='public_licence_documented',
                        licence=record['licence'],licenceUrl=record['licenceUrl'],changes=record['changes'],
                        evidence=record['evidence'],conditions=record['conditions'],
                        advertisingApproval=record['advertisingApproval'],uses=[])
                else:
                    entries[key] = dict(id=key,subject=image.get('subject'),kind='unregistered',
                        status='permission_pending',licence=None,reason='Unregistered photo or supplied PDF image.',uses=[])
        entries[key]['uses'].append(dict(page=image['page'],purpose='editorial_cover' if image['page']==1 else 'editorial_interior',rect=image.get('rect')))
    records = sorted(entries.values(), key=lambda r:r['id'])
    pending = [r['id'] for r in records if r['status']!='public_licence_documented']
    return dict(reviewedAt=registry['reviewedAt'],scope=registry['scope'],
        summary=dict(uniquePhotos=len(records),placements=sum(len(r['uses']) for r in records),
                     publicLicenceDocumented=len(records)-len(pending),permissionPending=len(pending)),
        photoCopyrightBasisComplete=not pending,publicationApproved=False,
        pendingAssetIds=pending,assets=records,notIncluded=registry['notIncluded'],
        registrySha256=hashlib.sha256(json.dumps(registry,sort_keys=True).encode()).hexdigest())


def require_documented_basis(receipt):
    if not receipt['photoCopyrightBasisComplete']:
        raise ValueError(f"Photo copyright preflight: {receipt['summary']['permissionPending']} assets need documented permission or a reviewed legal exception. Review PDFs are unchanged.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest',type=Path)
    parser.add_argument('--require-basis',action='store_true')
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    receipt = photo_receipt(manifest['images'])
    out = args.manifest.with_name(args.manifest.name.replace('.manifest.json','.photo-rights.json'))
    if out == args.manifest:parser.error('Expected an edition .manifest.json path')
    out.write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt['summary'],indent=2))
    if args.require_basis:
        try:require_documented_basis(receipt)
        except ValueError as error:parser.exit(2,str(error)+'\n')


if __name__=='__main__':main()
