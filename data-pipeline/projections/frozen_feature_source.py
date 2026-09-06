"""Pure adapter for freeze_historical_corpus body/receipt pairs. No refetch.

Checks consistency of captured decompressed HTTP bytes, semantic payload and
schedule identity; does not authenticate an upstream source or historical as-of.
"""
import hashlib
import json
from datetime import datetime, timezone

from acquisition.canonical_events import normalize_pbp
from acquisition.event_observation_service import prepare_observation
from monitoring.final_game_evidence import verify_final_game
from projections.analytics_publication import fingerprint, timestamp


def adapt_frozen_feature_source(body, receipt, *, now=None):
    if type(body) is not bytes or not isinstance(receipt, dict):
        raise ValueError('Exact body bytes and captured receipt required')
    receipt = json.loads(json.dumps(receipt, allow_nan=False))

    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('Duplicate JSON key')
            result[key] = value
        return result

    try:
        payload = json.loads(body, object_pairs_hook=pairs,
                             parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite JSON')))
        gid = receipt['game_id']
        url = f'https://api-web.nhle.com/v1/gamecenter/{gid}/play-by-play'
        observed = datetime.fromisoformat(timestamp(receipt['observed_at']))
        requested = datetime.fromisoformat(timestamp(receipt['requested_at']))
        clock = datetime.now(timezone.utc) if now is None else datetime.fromisoformat(timestamp(now))
        expected = receipt['schedule_identity']
        if (type(gid) is not int or type(payload['id']) is not int or payload['id'] != gid
                or receipt['url'] != url or receipt['response_url'] != url
                or type(receipt['http_status']) is not int or receipt['http_status'] != 200
                or receipt['byte_contract'] != 'requests-content-after-decompression-not-wire-bytes'
                or receipt['historical_as_of_verified'] is not False
                or requested > observed or observed > clock
                or type(receipt['body_bytes']) is not int or receipt['body_bytes'] != len(body)
                or receipt['body_sha256'] != hashlib.sha256(body).hexdigest()
                or receipt['body_file'] != f'{gid}.body.json'
                or receipt['source_payload_sha256'] != fingerprint(payload)
                or payload['gameDate'] != expected['date']
                or type(expected['game_type']) is not int or payload['gameType'] != expected['game_type']
                or expected['game_state'] not in ('OFF', 'FINAL')
                or expected['schedule_state'] != 'OK'
                or any(type(expected[f'{side}_team_id']) is not int
                       or payload[f'{side}Team']['id'] != expected[f'{side}_team_id'] for side in ('home', 'away'))):
            raise ValueError('Frozen source transport or identity conflict')
        normalized = json.loads(json.dumps(normalize_pbp(payload), allow_nan=False))
        final = json.loads(json.dumps(verify_final_game(payload), allow_nan=False))
        status = 'verified' if normalized['complete'] and final['status'] == 'verified' else 'quarantined'
        if (normalized != receipt['normalization'] or final != receipt['final_game_evidence']
                or receipt['status'] != status):
            raise ValueError('Frozen source validation drift')
        # Preserve source observation literally in the envelope; prepare normalizes
        # the same instant as established, never assigns a new freshness timestamp.
        return {'status': 'complete' if status == 'verified' else 'quarantined',
                'game_id': gid, 'url': url, 'observed_at': receipt['observed_at'],
                'prepared': list(prepare_observation(payload, receipt['observed_at'])),
                'freeze_transport_receipt': receipt,
                'adapter': 'citrus-frozen-http-feature-source-v1',
                'source_body_sha256': receipt['body_sha256'],
                'source_receipt_sha256': fingerprint(receipt)}
    except (KeyError, TypeError, AttributeError, UnicodeError, OverflowError) as exc:
        raise ValueError('Malformed frozen source pair') from exc
