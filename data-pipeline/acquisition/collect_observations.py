"""Collect frozen official PBP receipts without any database writes.

Run from data-pipeline: python -m acquisition.collect_observations MANIFEST OUTPUT
MANIFEST is a JSON array of canonical NHL game IDs. OUTPUT must not exist.
Each receipt includes actual retrieval time, raw response and normalization or
explicit failure. Revisions are new files, never overwritten old observations.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import signal
import time

from acquisition.event_observation_service import prepare_observation


def capture_game(game_id, request, now=lambda: datetime.now(timezone.utc).isoformat()):
    url = f'https://api-web.nhle.com/v1/gamecenter/{game_id}/play-by-play'
    try:
        response = request(url, timeout=15, max_retries=2)
        response.raise_for_status()
        payload = response.json()
        observed = now()
        if payload.get('id') != game_id:
            raise ValueError('Response game does not match request')
        prepared = prepare_observation(payload, observed)
        return {'game_id': game_id, 'url': url, 'observed_at': observed,
                'status': prepared[2]['status'], 'prepared': prepared}
    except Exception as exc:
        # Error class, never credentials/proxy URLs from exception messages.
        return {'game_id': game_id, 'url': url, 'observed_at': now(),
                'status': 'unavailable', 'reason': type(exc).__name__}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    ids = json.loads(args.manifest.read_text())
    if (not isinstance(ids, list) or not ids or len(set(ids)) != len(ids)
            or any(type(gid) is not int or len(str(gid)) != 10 or (gid//10000)%100 not in (2,3) for gid in ids)):
        parser.error('Manifest requires unique regular/playoff NHL game identities')
    args.output.mkdir(parents=True, exist_ok=False)
    import _bootstrap  # noqa: F401
    from data_pipeline.utils.citrus_request import citrus_request
    stopped = False

    def stop(*_):
        nonlocal stopped
        stopped = True

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    counts = Counter()
    for gid in ids:
        if stopped:
            break
        receipt = capture_game(gid, citrus_request)
        (args.output / f'{gid}.json').write_text(json.dumps(receipt, sort_keys=True, allow_nan=False))
        counts[receipt['status']] += 1
        print(json.dumps({'event': 'official_observation.progress', 'game_id': gid,
                          'status': receipt['status'], 'completed': sum(counts.values()), 'expected': len(ids)}), flush=True)
        time.sleep(0.25)
    health = {'expected': len(ids), 'observed': sum(counts.values()), 'statuses': dict(counts), 'interrupted': stopped}
    (args.output / 'health.json').write_text(json.dumps(health, sort_keys=True))
    print(json.dumps({'event': 'official_observation.health', **health}), flush=True)
    return 0 if counts['complete'] == len(ids) else 2


if __name__ == '__main__':
    raise SystemExit(main())
