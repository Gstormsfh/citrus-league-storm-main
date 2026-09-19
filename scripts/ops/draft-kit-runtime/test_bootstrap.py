import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from bootstrap import unpack_verified

REVISION = 'a' * 64


def bundle(extra=None, revision=REVISION, corrupt=False):
    files = {'data/guide-data.json': json.dumps({'canonicalRevision': revision}).encode()}
    manifest = {'schema': 'citrus.private-draft-kit-bundle.v1', 'revision': REVISION,
                'files': {name: {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
                          for name, data in files.items()}}
    if corrupt:
        files['data/guide-data.json'] += b' '
    files['manifest.json'] = json.dumps(manifest).encode()
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode='w:gz') as archive:
        for name, data in files.items():
            member = tarfile.TarInfo('./' + name)
            member.size = len(data)
            archive.addfile(member, io.BytesIO(data))
        if extra:
            archive.addfile(extra, io.BytesIO(b''))
    blob = out.getvalue()
    return blob, hashlib.sha256(blob).hexdigest()


class BootstrapTest(unittest.TestCase):
    def run_bundle(self, blob, digest, revision=REVISION):
        with tempfile.TemporaryDirectory() as folder:
            destination = Path(folder) / 'edition'
            result = unpack_verified(blob, digest, revision, destination)
            self.assertTrue((destination / 'data/guide-data.json').is_file())
            return result

    def test_valid_bundle(self):
        self.assertEqual(self.run_bundle(*bundle()), 1)

    def test_bad_archive_hash(self):
        with self.assertRaises(ValueError): self.run_bundle(bundle()[0], '0' * 64)

    def test_wrong_manifest_revision(self):
        with self.assertRaises(ValueError): self.run_bundle(*bundle(), revision='b' * 64)

    def test_wrong_guide_revision(self):
        with self.assertRaises(ValueError): self.run_bundle(*bundle(revision='b' * 64))

    def test_corrupt_member(self):
        with self.assertRaises(ValueError): self.run_bundle(*bundle(corrupt=True))

    def test_unlisted_member(self):
        with self.assertRaises(ValueError): self.run_bundle(*bundle(tarfile.TarInfo('extra')))

    def test_traversal_absolute_and_backslash(self):
        for name in ('../escape', '/escape', 'data/../../escape', 'data\\escape'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.run_bundle(*bundle(tarfile.TarInfo(name)))

    def test_duplicate_member(self):
        with self.assertRaises(ValueError): self.run_bundle(*bundle(tarfile.TarInfo('data/guide-data.json')))

    def test_links_and_devices(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.CHRTYPE, tarfile.FIFOTYPE):
            member = tarfile.TarInfo('unsafe'); member.type = kind; member.linkname = 'data/guide-data.json'
            with self.subTest(kind=kind), self.assertRaises(ValueError): self.run_bundle(*bundle(member))


if __name__ == '__main__':
    unittest.main()
