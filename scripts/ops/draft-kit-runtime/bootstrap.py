"""Load a hash-pinned private edition before starting the download-enabled API.

Uses the Cloud Run identity to read ONE configured object, never a public URL.
The archive and every member are verified before exposing the edition to workers.
This does not enable checkout or approve the contents of an edition.
"""
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
import tarfile
import tempfile
from urllib.parse import quote
from urllib.request import Request, urlopen

MAX_ARCHIVE = 256 * 1024 * 1024
MAX_EXPANDED = 512 * 1024 * 1024


def unpack_verified(blob, digest, revision, destination):
    if not re.fullmatch(r'[a-f0-9]{64}', digest) or hashlib.sha256(blob).hexdigest() != digest:
        raise ValueError('Edition archive fingerprint mismatch')
    if not re.fullmatch(r'[a-f0-9]{64}', revision):
        raise ValueError('Missing edition revision')
    files = {}
    total = 0
    with tarfile.open(fileobj=io.BytesIO(blob), mode='r:gz') as archive:
        for member in archive:
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or '\\' in member.name:
                raise ValueError('Unsafe archive member')
            if member.isdir():
                continue
            if not member.isfile() or str(path) in files:
                raise ValueError('Linked, special or duplicate archive member')
            total += member.size
            if total > MAX_EXPANDED or len(files) >= 5000:
                raise ValueError('Edition exceeds extraction limits')
            files[str(path)] = archive.extractfile(member).read()
    manifest = json.loads(files.pop('manifest.json'))
    if manifest.get('schema') != 'citrus.private-draft-kit-bundle.v1' or manifest.get('revision') != revision:
        raise ValueError('Edition manifest revision mismatch')
    if set(manifest['files']) != set(files):
        raise ValueError('Edition file inventory mismatch')
    for name, data in files.items():
        record = manifest['files'][name]
        if len(data) != record['bytes'] or hashlib.sha256(data).hexdigest() != record['sha256']:
            raise ValueError('Edition member fingerprint mismatch')
    guide = json.loads(files['data/guide-data.json'])
    if guide.get('canonicalRevision') != revision:
        raise ValueError('Guide revision mismatch')
    destination = Path(destination)
    destination.mkdir(exist_ok=False)
    for name, data in files.items():
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    (destination / 'manifest.json').write_text(json.dumps(manifest))
    return len(files)


def download(uri):
    match = re.fullmatch(r'gs://([a-z0-9][a-z0-9._-]+)/(.+)', uri)
    if not match:
        raise ValueError('Edition must use a private GCS object')
    request = Request('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
                      headers={'Metadata-Flavor': 'Google'})
    with urlopen(request, timeout=10) as response:
        token = json.load(response)['access_token']
    bucket, name = match.groups()
    request = Request('https://storage.googleapis.com/storage/v1/b/' + quote(bucket, safe='')
                      + '/o/' + quote(name, safe='') + '?alt=media',
                      headers={'Authorization': 'Bearer ' + token})
    with urlopen(request, timeout=90) as response:
        blob = response.read(MAX_ARCHIVE + 1)
    if len(blob) > MAX_ARCHIVE:
        raise ValueError('Edition exceeds download limit')
    return blob


def main():
    # An image can be deployed gate-off without accessing private edition data.
    if os.environ.get('DRAFT_KIT_PDF_READY') == 'true':
        digest = os.environ['DRAFT_KIT_BUNDLE_SHA256']
        revision = os.environ['DRAFT_KIT_BUNDLE_REVISION']
        parent = Path(tempfile.mkdtemp(prefix='citrus-edition-'))
        edition = parent / 'edition'
        count = unpack_verified(download(os.environ['DRAFT_KIT_BUNDLE_URI']), digest, revision, edition)
        os.environ.update(DRAFT_KIT_DATA_PATH=str(edition / 'data/guide-data.json'),
                          DRAFT_KIT_SOURCE_ROOT=str(edition / 'data'),
                          DRAFT_KIT_EDITORIAL_ROOT=str(edition / 'editorial'),
                          CITRUS_DRAFT_KIT_ASSETS=str(edition / 'assets'),
                          CITRUS_DRAFT_KIT_OFFLINE_ASSETS='true')
        print(json.dumps({'event': 'draft_kit.edition_loaded', 'revision': revision,
                          'archive_sha256': digest, 'files': count}), flush=True)
    os.execvp('node', ['node', '/app/node_modules/tsx/dist/cli.mjs', '/app/server/src/index.ts'])


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Do not print remote response bodies, tokens or customer data.
        print(json.dumps({'event': 'draft_kit.edition_load_failed', 'error_type': type(error).__name__}), file=sys.stderr, flush=True)
        sys.exit(1)
