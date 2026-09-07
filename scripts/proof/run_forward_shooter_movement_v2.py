"""Execution-only source-hash correction; frozen statistical runner unchanged.

Rows attest the adapted source envelope, while the closure attests raw file
bytes. Check both distinct domains before rechecking raw event attribution.
"""
import argparse
from collections import defaultdict
import hashlib
import signal

import run_forward_shooter_movement as original
from projections.frozen_feature_source import adapt_frozen_feature_source

ROOT = original.ROOT
FAILED = 'scripts/proof/results/official-forward-shooter-movement-20260906-full/failure.json'
FAILED_SHA = '5d90ae212756bac3deab4689f50a4a592214c6a6ea4726a929f67248485c2225'
ORIGINAL_SHA = 'f9026ebb557033d83059ba30b34597d504d393ad539fc8317b197122d9e3d53d'
NEW_CODE = ('scripts/proof/run_forward_shooter_movement_v2.py',
            'scripts/proof/test_run_forward_shooter_movement_v2.py',
            'scripts/proof/test_forward_shooter_movement_v2_review.py',
            'data-pipeline/projections/frozen_feature_source.py', FAILED)


def verify_source_roles(closure, rows, records, *, lineage):
    original.strict_keys(rows); original.strict_keys(records)
    source = {(r['game_id'], r['event_id']): r for r in rows}
    if set(source) != {(r['game_id'], r['event_id']) for r in records}:
        raise ValueError('Exact source role membership required')
    grouped = defaultdict(list)
    for record in records: grouped[record['game_id']].append(record)
    certification = closure.read(original.reuse.CONDITIONAL+'/attempt-started.json')['started_at']
    for gid, selected in grouped.items():
        name = f'{original.FREEZE}/{gid//1000000}/pbp/{gid}'
        body = closure.safe(name+'.body.json').read_bytes()
        body_sha = hashlib.sha256(body).hexdigest()
        if body_sha != closure.checked[name+'.body.json']:
            raise ValueError('Selected raw source byte hash changed')
        receipt = closure.read(name+'.receipt.json')
        adapted = adapt_frozen_feature_source(body, receipt, now=certification)
        source_sha = original.fingerprint(adapted)
        if any(source[gid, r['event_id']]['source_sha256'] != source_sha for r in selected):
            raise ValueError('Selected adapted source envelope hash changed')
        out = original.attribution.attribute_game(body,
            [{k: r[k] for k in ('game_id', 'event_id', 'source_event_sha256')} for r in selected],
            [{k: r[k] for k in ('game_id', 'event_id', 'probability')} for r in selected],
            lineage=lineage, observed_at=receipt['observed_at'])
        actors = {r['event_id']: r for r in out['events']}
        if len(actors) != len(out['events']) or set(actors) != {r['event_id'] for r in selected}:
            raise ValueError('Source role membership changed')
        for r in selected:
            a = actors[r['event_id']]
            if (a['shooter'] != r['shooter_attribution'] or a['defending_goalie'] != r['goalie_attribution']
                    or a['shooter']['player_id'] != r['shooter_id'] or a['defending_goalie']['player_id'] != r['goalie_id']
                    or int(a['is_goal']) != r['target'] or a['event_type'] != r['event_type']):
                raise ValueError('Exact original role attribution changed')
    return {'games': len(grouped), 'events': len(records), 'body_event_and_actor_identity_exact': True,
            'adapted_source_envelope_exact': True,
            'source_sha256_meaning': 'fingerprint(adapt_frozen_feature_source(body,receipt))',
            'body_sha256_meaning': 'sha256(raw captured decompressed body bytes)',
            'certification_instant': certification,
            'method': 'original-adapter-and-actor-attribution-only-not-feature-replay', 'publishable': False}


def run(output):
    closure = original.reuse.Closure(ROOT)
    closure.pin(FAILED, FAILED_SHA)
    closure.pin('scripts/proof/run_forward_shooter_movement.py', ORIGINAL_SHA)
    failure = closure.read(FAILED)
    if failure['completed_folds'] or failure['error'] != 'Selected source body hash changed':
        raise ValueError('Exact preserved pre-fit implementation failure required')
    code, verifier = original.CODE, original.verify_source_roles
    try:
        original.CODE = (*code, *NEW_CODE)
        original.verify_source_roles = verify_source_roles
        return original.run(output)
    finally:
        original.CODE, original.verify_source_roles = code, verifier


if __name__ == '__main__':
    def stop(signum, frame): raise KeyboardInterrupt('Preserve interrupted experiment')
    signal.signal(signal.SIGTERM, stop)
    parser = argparse.ArgumentParser(); parser.add_argument('--output', required=True)
    run(parser.parse_args().output)
