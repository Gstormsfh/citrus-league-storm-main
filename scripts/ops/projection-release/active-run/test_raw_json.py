import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('raw_json', Path(__file__).with_name('raw_json.py'))
raw_json = importlib.util.module_from_spec(spec)
spec.loader.exec_module(raw_json)


class ExactNumericTransport(unittest.TestCase):
    def test_raw_sql_preserves_signed_fraction_and_quoted_text(self):
        text = '{"rate": -0.123456789012345678901234, "count": 123.000000000000000001, "note": "$raw$ and \'quoted\'"}'
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'payload.json'
            path.write_text(text)
            literal = raw_json.sql_json_literal(path)
            delimiter = literal[:literal.index('$', 1) + 1]
            self.assertEqual(literal, delimiter + text + delimiter + '::jsonb')

    def test_float_roundtrip_cannot_pass_revision_preimage_check(self):
        text = '{"count": 123.000000000000000001}'
        revision = hashlib.sha256(text.encode()).hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            preimage, payload = root / 'preimage.txt', root / 'payload.json'
            preimage.write_text(text)
            payload.write_text(text[:-1] + ', "revision": "' + revision + '"}')
            raw_json.verify_postgres_revision(payload, preimage, revision)
            payload.write_text('{"count":123.0,"revision":"' + revision + '"}')
            with self.assertRaisesRegex(ValueError, 'differs from exact'):
                raw_json.verify_postgres_revision(payload, preimage, revision)


if __name__ == '__main__':
    unittest.main()
