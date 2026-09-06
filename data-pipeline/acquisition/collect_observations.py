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
import sys
import time


def capture_game(game_id, request, now=lambda: datetime.now(timezone.utc).isoformat()):
    url = f'https://api-web.nhle.com/v1/gamecenter/{game_id}/play-by-play'
    try:
        from acquisition.event_observation_service import prepare_observation
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


def load_request():
    import _bootstrap  # noqa: F401
    from data_pipeline.utils.citrus_request import citrus_request
    return citrus_request


def write_receipt(path, value):
    # Readers glob *.json; a disk error must not expose a partial receipt.
    # A fresh output directory and unique manifest guarantee a fresh target.
    pending = path.with_suffix('.pending')
    with pending.open('x') as handle:
        handle.write(json.dumps(value, sort_keys=True, allow_nan=False))
        handle.flush()
    pending.rename(path)


def emit_health(output, health, persist):
    health['health_persisted'] = persist
    if persist:
        try:
            write_receipt(output / 'health.json', health)
        except Exception as exc:
            health['health_persisted'] = False
            health['status'] = 'failed'
            health['failures'].append({'phase': 'persist_health', 'reason': type(exc).__name__})
    message = json.dumps({'event': 'official_observation.health', **health}, sort_keys=True)
    try:
        print(message, flush=True)
    except (OSError, ValueError):
        # A closed progress pipe must not erase the terminal health signal.
        print(message, file=sys.stderr, flush=True)
    return 0 if health['status'] == 'complete' else 2


def collect(ids, output):
    stopped = False
    created = False
    phase = 'create_output'
    current_game = None
    counts = Counter()
    failures = []
    previous_handlers = {}

    def stop(*_):
        nonlocal stopped
        stopped = True

    try:
        output.mkdir(parents=True, exist_ok=False)
        created = True
        phase = 'import_request'
        request = load_request()
        phase = 'install_signal_handlers'
        for sig in (signal.SIGINT, signal.SIGTERM):
            previous_handlers[sig] = signal.signal(sig, stop)
        for gid in ids:
            if stopped:
                break
            current_game = gid
            phase = 'capture_receipt'
            receipt = capture_game(gid, request)
            phase = 'persist_receipt'
            write_receipt(output / f'{gid}.json', receipt)
            counts[receipt['status']] += 1
            phase = 'progress'
            print(json.dumps({'event': 'official_observation.progress', 'game_id': gid,
                              'status': receipt['status'], 'completed': sum(counts.values()), 'expected': len(ids)}), flush=True)
            time.sleep(0.25)
    except (Exception, SystemExit) as exc:
        failures.append({'phase': phase, 'game_id': current_game, 'reason': type(exc).__name__})
    except KeyboardInterrupt:
        stopped = True
    finally:
        for sig, handler in previous_handlers.items():
            try:
                signal.signal(sig, handler)
            except Exception as exc:
                failures.append({'phase': 'restore_signal_handlers', 'reason': type(exc).__name__})
    health = {'expected': len(ids), 'observed': sum(counts.values()), 'statuses': dict(counts),
              'interrupted': stopped, 'failures': failures,
              'status': 'complete' if not failures and not stopped and counts['complete'] == len(ids) else 'failed'}
    return emit_health(output, health, created)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    try:
        ids = json.loads(args.manifest.read_text())
        if (not isinstance(ids, list) or not ids
                or any(type(gid) is not int or len(str(gid)) != 10 or (gid//10000)%100 not in (2,3) for gid in ids)
                or len(set(ids)) != len(ids)):
            raise ValueError('Manifest requires unique regular/playoff NHL game identities')
    except Exception as exc:
        return emit_health(args.output, {'expected': None, 'observed': 0, 'statuses': {},
            'interrupted': False, 'status': 'failed',
            'failures': [{'phase': 'read_manifest', 'reason': type(exc).__name__}]}, False)
    return collect(ids, args.output)


if __name__ == '__main__':
    raise SystemExit(main())
