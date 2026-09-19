"""Paid renders consume immutable, identity-checked portraits without networking."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import player_portraits


class OfflinePortraitTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.cache = Path(self.temp.name) / 'headshots'
        self.cache.mkdir()
        self.blob = b'reviewed-photo-fixture'
        (self.cache / '123.png').write_bytes(self.blob)
        self.entry = dict(name='Test Player', playerId='123', file='123.png',
                          status='downloaded', sha256=hashlib.sha256(self.blob).hexdigest())
        self.players = [dict(playerId='123', name='Test Player')]
        self.directory = [dict(player_id='123', full_name='Test Player')]
        self.addCleanup(patch.stopall)
        patch.object(player_portraits, 'CACHE', self.cache).start()
        patch.dict('os.environ', CITRUS_DRAFT_KIT_OFFLINE_ASSETS='true').start()
        self.network = patch.object(player_portraits, 'fetch_portrait', side_effect=AssertionError('Network forbidden')).start()

    def prepare(self):
        (self.cache / 'manifest.json').write_text(json.dumps({'123': self.entry}))
        return player_portraits.prepare_portraits(self.players, self.directory)

    def test_accepts_exact_reviewed_identity_and_bytes_without_mutation(self):
        self.prepare()
        before = {p.name: p.read_bytes() for p in self.cache.iterdir()}
        result = player_portraits.prepare_portraits(self.players, self.directory)
        self.assertEqual(result['downloaded'], 1)
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.cache.iterdir()})
        self.network.assert_not_called()

    def test_rejects_wrong_identity_directory_hash_and_path(self):
        for field, value in [('playerId', '456'), ('name', 'Different Person'),
                             ('sha256', '0' * 64), ('file', '../outside.png'),
                             ('status', 'identity-unresolved')]:
            with self.subTest(field=field):
                original = dict(self.entry)
                self.entry[field] = value
                with self.assertRaises(ValueError):
                    self.prepare()
                self.entry = original
        self.directory[0]['full_name'] = 'Wrong Directory Person'
        with self.assertRaises(ValueError):
            self.prepare()

    def test_missing_cache_does_not_create_or_download(self):
        missing = self.cache / 'nonexistent'
        with patch.object(player_portraits, 'CACHE', missing):
            with self.assertRaises(ValueError):
                player_portraits.prepare_portraits(self.players, self.directory)
        self.assertFalse(missing.exists())
        self.network.assert_not_called()


if __name__ == '__main__':
    unittest.main()
