#!/bin/zsh
cd "$(dirname "$0")" || exit 1
CITRUS_PYTHON="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
if [[ ! -x "$CITRUS_PYTHON" ]]; then CITRUS_PYTHON=python3; fi
export CITRUS_NODE="${CITRUS_NODE:-$(command -v node)}"
if [[ -z "$CITRUS_NODE" ]]; then export CITRUS_NODE="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"; fi
export CITRUS_GUIDE_DATA="${CITRUS_GUIDE_DATA:-workbook-data.json}"
"$CITRUS_PYTHON" - <<'PY'
import json
import os
import socket
import sys
import urllib.request
import webbrowser
from pathlib import Path

url = 'http://127.0.0.1:8765'
expected = json.loads(Path(os.environ['CITRUS_GUIDE_DATA']).read_text())
try:
    # Ignore system proxies for this local-only check. Never follow redirects
    # to another service when deciding whether this is our configurator.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect)
    with opener.open(url + '/api/data', timeout=8) as response:
        payload = json.loads(response.read(16 * 1024 * 1024))
    source = payload.get('source', {})
    matches = (
        source == expected['source']
        and payload.get('weights') == expected['weights']
        and isinstance(payload.get('rookies'), list)
        and isinstance(payload.get('result'), dict)
        and isinstance(payload['result'].get('players'), list)
        and bool(payload['result']['players'])
    )
    if matches:
        print('Opening the existing Citrus guide configurator. No second server started.')
        webbrowser.open(url)
        sys.exit(0)
except (OSError, ValueError, TypeError, AttributeError):
    pass

# A failed/mismatched response might mean the port is free, an unrelated app
# owns it, or an existing guide is busy generating a PDF. Never stop its process.
try:
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 8765))
except OSError:
    print('Port 8765 is already in use, but its service could not be verified as this Citrus guide.')
    print('If another guide is generating a PDF, wait for it to finish and try again.')
    print('Otherwise, close the previous guide server in its Terminal window, or stop the app using port 8765, then reopen this launcher.')
    print('No existing process was stopped.')
    sys.exit(1)
sys.exit(10)  # Free port: let the existing runtime launch the server below.
PY
CITRUS_LAUNCH_STATUS=$?
if [[ "$CITRUS_LAUNCH_STATUS" == 10 ]]; then
  "$CITRUS_PYTHON" server.py --data "$CITRUS_GUIDE_DATA" --open
else
  exit "$CITRUS_LAUNCH_STATUS"
fi
