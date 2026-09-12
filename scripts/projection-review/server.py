#!/usr/bin/env python3
"""Read-only local view of the canonical projection source; edits download as patches."""
from __future__ import annotations

import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from urllib.parse import urlsplit

SCHEMA = "citrus.canonical-projection-inputs.v1"


def read_review(path: Path) -> dict:
    raw = json.loads(path.read_text())
    if not isinstance(raw, dict):
        raise ValueError("Canonical input must be an object")
    context = {"kind": "local_draft"}
    document = raw
    if "source_payload" in raw:
        if raw.get("publication_view") != "canonical_published_runs":
            raise ValueError("Published source envelope requires canonical_published_runs view marker")
        required = ("run_id", "revision", "source_run_id", "source_revision")
        if any(not isinstance(raw.get(key), str) or not raw[key].strip() for key in required):
            raise ValueError("Published source envelope is missing runtime or source identity")
        document = raw["source_payload"]
        if not isinstance(document, dict) or document.get("revision") != raw["source_revision"]:
            raise ValueError("Published source revision does not match its editable source payload")
        context = {"kind": "published_source", "publication_view": raw["publication_view"],
                   "runtime_run_id": raw["run_id"], "runtime_revision": raw["revision"],
                   "source_run_id": raw["source_run_id"], "source_revision": raw["source_revision"],
                   "verification": "exported_view_snapshot_not_live_activation_check"}
        for key in ("exported_at", "as_of"):
            if isinstance(raw.get(key), str):
                context[key] = raw[key]
    if document.get("schema_version") != SCHEMA:
        raise ValueError("Unsupported canonical source schema")
    body = {key: value for key, value in document.items() if key != "revision"}
    revision = hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
    if document.get("revision") != revision:
        raise ValueError("Canonical revision hash mismatch; use the canonical review workflow")
    if not isinstance(document.get("players"), list) or not isinstance(document.get("teams"), list):
        raise ValueError("Canonical source is missing player or team records")
    return {"source": document, "publication_context": context}


def read_source(path: Path) -> dict:
    return read_review(path)["source"]


def make_handler(source: Path):
    class Handler(BaseHTTPRequestHandler):
        def respond(self, status, body, content_type="application/json; charset=utf-8"):
            data = body.encode() if isinstance(body, str) else json.dumps(body, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            # No permissive CORS and no filesystem paths supplied by the browser.
            host = self.headers.get("Host", "").split(":", 1)[0]
            if host not in {"127.0.0.1", "localhost"}:
                self.respond(403, {"error": "Local host required"})
                return
            route = urlsplit(self.path).path
            if route == "/":
                self.respond(200, Path(__file__).with_name("index.html").read_text(), "text/html; charset=utf-8")
            elif route in {"/api/source", "/api/review"}:
                try:
                    review = read_review(source)
                    self.respond(200, review if route == "/api/review" else review["source"])
                except (OSError, ValueError, TypeError) as error:
                    self.respond(422, {"error": str(error)})
            elif route == "/api/health":
                self.respond(200, {"service": "citrus-projection-review", "mode": "read-only", "schema_version": SCHEMA})
            else:
                self.respond(404, {"error": "Not found"})

        def do_POST(self):
            self.respond(405, {"error": "Read-only review server. Export a patch for the canonical review CLI."})

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="Canonical JSON exported by the reconciliation workflow")
    parser.add_argument("--port", default=8766, type=int)
    args = parser.parse_args()
    source = args.source.expanduser().resolve()
    document = read_source(source)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(source))
    print(f"Citrus source review: http://127.0.0.1:{args.port}\nRevision: {document['revision']}\nRead-only source: {source}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
