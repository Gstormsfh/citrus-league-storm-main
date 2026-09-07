"""Read-only public-host routing receipt; never prints keys or entire bundles."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[2]


def fetch(url):
    with urlopen(url, timeout=20) as response:
        body = response.read()
        return body, {'url': url, 'effective_url': response.url, 'status': response.status,
                      'body_sha256': hashlib.sha256(body).hexdigest(), 'bytes': len(body)}


def run(output):
    output = Path(output).absolute()
    if output.parent != ROOT / 'scripts/proof/results' or not output.name.startswith('public-routing-'):
        raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False)
    results = []
    for origin in ('https://citrusfantasysports.com', 'https://www.citrusfantasysports.com',
                   'https://citrus-fantasy-staging.web.app'):
        html, page = fetch(origin + '/')
        assets = re.findall(r'/assets/index-[^"\s]+\.js', html.decode())
        if len(assets) != 1:
            raise ValueError('One main module required')
        bundle, asset = fetch(origin + assets[0])
        # Only public endpoint origins: never extract API keys, bearer tokens or DSNs.
        asset['public_endpoint_origins'] = sorted(set(re.findall(
            r'https://[a-zA-Z0-9.-]+(?:\.supabase\.co|\.run\.app|\.citrusfantasysports\.com)', bundle.decode())))
        health_raw, health = fetch(origin + '/api/health')
        decoded = json.loads(health_raw)
        health['response'] = {k: decoded.get(k) for k in ('status', 'service', 'version', 'uptime', 'checks', 'timestamp')}
        results.append({'page': page, 'main_asset': asset, 'health': health})
    report = {'observed_at': datetime.now(timezone.utc).isoformat(), 'origins': results,
              'limitations': ['Public health does not prove forecast endpoint correctness or installed iOS routing.',
                              'No credentials or private API operations used.']}
    with (output / 'report.json').open('x') as stream:
        json.dump(report, stream, indent=2)
        stream.write('\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    run(sys.argv[1])
