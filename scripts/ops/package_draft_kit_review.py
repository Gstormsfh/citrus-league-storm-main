"""Assemble an immutable PRIVATE renderer-review bundle, never publication approval.

Keep private editions out of the public repository and API image. Inputs are
copied byte-for-byte with a per-file manifest; no source or editorial rebinding.
"""
import argparse
import hashlib
import json
import shutil
from pathlib import Path


def assemble(source, evidence, editorial, assets, output):
    source, evidence, editorial, assets, output = map(Path, (source, evidence, editorial, assets, output))
    data = json.loads((source / 'guide-data.json').read_text())
    canonical_name = data['source']['name']
    if Path(canonical_name).name != canonical_name:
        raise ValueError('Canonical source must be a basename')
    files = [(source / 'guide-data.json', 'data/guide-data.json'),
             (source / canonical_name, 'data/' + canonical_name)]
    if data['source'].get('revisionAlgorithm') == 'sha256_postgres_jsonb_v1':
        preimage = Path(canonical_name).with_suffix('.preimage.json').name
        files.append((source / preimage, 'data/' + preimage))
    for name in ('editorial-evidence.json', 'historical-verification.json', 'category-verification.json'):
        files.append((evidence / name, 'data/' + name))
    for name in ('board-reads.json', 'player-season-context.json', 'player-story-library.json',
                 'player-spotlights.json', 'draft-watchlist.json', 'offseason-editorial.json',
                 'team-readings.json', 'deployment-research.json', 'review.json'):
        files.append((editorial / name, 'editorial/' + name))
    files.append((evidence.parent / 'photo-rights.json', 'editorial/photo-rights.json'))
    for name in ('Barlow-Bold.ttf', 'Barlow-Regular.ttf', 'Barlow-SemiBold.ttf',
                 'BarlowCondensed-Bold.ttf', 'barlow-OFL.txt', 'barlowcondensed-OFL.txt',
                 'PHOTO-CREDITS.md', 'logo.png', 'mcdavid.jpg', 'winter-classic.jpg',
                 'original-logos.pdf', 'player-photos.pdf', 'player-photos.json'):
        files.append((assets / name, 'assets/' + name))
    portraits = json.loads((assets / 'headshots/manifest.json').read_text())
    files.append((assets / 'headshots/manifest.json', 'assets/headshots/manifest.json'))
    for record in portraits.values():
        if record.get('status') != 'downloaded':
            continue
        name = record['file']
        if Path(name).name != name:
            raise ValueError('Portrait path must be a basename')
        path = assets / 'headshots' / name
        if hashlib.sha256(path.read_bytes()).hexdigest() != record['sha256']:
            raise ValueError('Portrait changed: ' + name)
        files.append((path, 'assets/headshots/' + name))
    # Validate all sources before creating any output. Refuse symlinks as well
    # as missing files, and never overwrite another reviewed bundle.
    for path, _ in files:
        if path.is_symlink() or not path.is_file():
            raise ValueError('Missing or linked bundle input: ' + str(path))
    output.mkdir(parents=True, exist_ok=False)
    entries = {}
    for path, relative in files:
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if relative in entries:
            continue
        shutil.copyfile(path, target)
        entries[relative] = dict(sha256=hashlib.sha256(target.read_bytes()).hexdigest(), bytes=target.stat().st_size)
    manifest = dict(schema='citrus.private-draft-kit-bundle.v1', publicationReady=False,
                    purpose='Renderer acceptance only; not deployment or editorial approval',
                    revision=data['canonicalRevision'], files=entries)
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return dict(output=str(output), revision=data['canonicalRevision'], files=len(entries), publicationReady=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('source', 'evidence', 'editorial', 'assets', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(assemble(**vars(args))))
