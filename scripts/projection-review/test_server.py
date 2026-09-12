"""Revision safety and read-only HTTP boundary tests (no source mutation)."""
import hashlib
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import unittest

from server import SCHEMA, make_handler, read_source


def sealed(**updates):
    data = {"schema_version": SCHEMA, "players": [], "teams": [], **updates}
    data["revision"] = hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return data


class ReviewServerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.source = Path(self.directory.name) / "canonical.json"
        self.source.write_text(json.dumps(sealed()))

    def tearDown(self):
        self.directory.cleanup()

    def test_rejects_out_of_band_edit(self):
        data = json.loads(self.source.read_text())
        data["players"].append({"player_id": "unexpected"})
        self.source.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            read_source(self.source)

    def test_http_rereads_current_source_and_never_applies_patch(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.source))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        connection = HTTPConnection(*server.server_address)
        try:
            connection.request("GET", "/api/source")
            response = connection.getresponse()
            first = json.loads(response.read())
            self.assertEqual(response.getheader("Cache-Control"), "no-store")
            self.assertIsNone(response.getheader("Access-Control-Allow-Origin"))
            changed = sealed(as_of="2026-09-13")
            self.source.write_text(json.dumps(changed))
            connection.request("GET", "/api/source")
            response = connection.getresponse()
            self.assertNotEqual(first["revision"], json.loads(response.read())["revision"])
            connection.request("POST", "/api/source", body='{"player_updates":[]}')
            response = connection.getresponse()
            self.assertEqual(response.status, 405)
            response.read()
            self.assertEqual(json.loads(self.source.read_text()), changed)
            connection.request("GET", "/../../canonical.json")
            response = connection.getresponse()
            self.assertEqual(response.status, 404)
            response.read()
        finally:
            connection.close()
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
