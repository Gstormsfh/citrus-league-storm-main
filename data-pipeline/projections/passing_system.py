"""Citrus offline passing system: extraction, review, geometry and evaluation.

Run with python -m projections.passing_system --help. No network or DB access.
Metrics require an explicitly exhaustive, independently annotated frame window.
"""
import argparse
import json
from pathlib import Path

from projections.passing_sequence_review import build_packet, measure_reviewed, source_hash


def evaluate(packet, labels, *, tolerance_frames=3):
    """One-to-one maximum-cardinality matches, separately for each fixed setting.

    A match requires the same directed actor pair/team and BOTH endpoint errors
    within tolerance. Unknown intervals and boundary-straddling candidates are
    excluded. Assist matches alone are never ground truth.
    """
    if labels.get('source_sha256') != packet['source_sha256']:
        raise ValueError('Label source hash mismatch')
    if labels.get('exhaustive') is not True:
        raise ValueError('Precision/recall require an exhaustively labeled window')
    for name in ('reviewer', 'evidence_reference'):
        if not isinstance(labels.get(name), str) or not labels[name].strip():
            raise ValueError('Independent label provenance required')
    if type(tolerance_frames) is not int or tolerance_frames < 0:
        raise ValueError('Nonnegative integer endpoint tolerance required')
    start, end = labels.get('start_frame'), labels.get('end_frame')
    if not all(type(i) is int for i in (start, end)) or not 0 <= start < end < packet['frames']:
        raise ValueError('Valid inclusive annotation window required')
    unknown = labels.get('unknown_intervals', [])
    for interval in unknown:
        if (not isinstance(interval, list) or len(interval) != 2
                or not all(type(i) is int for i in interval)
                or not start <= interval[0] <= interval[1] <= end):
            raise ValueError('Invalid unknown interval')
    def eligible(a, b):
        return start <= a < b <= end and not any(a <= hi and b >= lo for lo, hi in unknown)
    truth = labels.get('passes')
    if not isinstance(truth, list):
        raise ValueError('Explicit pass-label list required, including when empty')
    identities = set()
    for p in truth:
        a, b = p.get('release_frame'), p.get('reception_frame')
        if not all(type(i) is int for i in (a, b)) or not eligible(a, b):
            raise ValueError('Pass label outside evaluable window or overlapping unknown interval')
        ids = tuple(p.get(k) for k in ('passer_player_id', 'receiver_player_id', 'team_id'))
        if not all(type(i) is int and i > 0 for i in ids) or ids[0] == ids[1]:
            raise ValueError('Invalid labeled actor pair')
        identity = (*ids, a, b)
        if identity in identities:
            raise ValueError('Duplicate ground-truth pass')
        identities.add(identity)
    metrics = {}
    for radius in (60, 84):
        for limit in (12, 24, 36):
            rows = [c for c in packet['candidates'] if c['setting'] == {
                'radius': radius, 'relative_step_limit': limit}]
            predictions = [c for c in rows if eligible(c['start_frame'], c['end_frame'])]
            edges = []
            for c in predictions:
                edges.append([i for i, p in enumerate(truth)
                    if (c['from_player_id'], c['to_player_id'], c['team_id']) ==
                       (p['passer_player_id'], p['receiver_player_id'], p['team_id'])
                    and abs(c['start_frame']-p['release_frame']) <= tolerance_frames
                    and abs(c['end_frame']-p['reception_frame']) <= tolerance_frames])
            matched = {}
            def augment(prediction, visited):
                for target in edges[prediction]:
                    if target in visited:
                        continue
                    visited.add(target)
                    if target not in matched or augment(matched[target], visited):
                        matched[target] = prediction
                        return True
                return False
            for i in range(len(predictions)):
                augment(i, set())
            tp = len(matched)
            metrics[f'{radius}/{limit}'] = {
                'true_positives': tp, 'false_positives': len(predictions)-tp,
                'false_negatives': len(truth)-tp,
                'precision': tp/len(predictions) if predictions else None,
                'recall': tp/len(truth) if truth else None,
                'excluded_candidates': len(rows)-len(predictions),
                'matches': [{'candidate_id': predictions[j]['candidate_id'], 'label_index': i,
                    'release_error_frames': predictions[j]['start_frame']-truth[i]['release_frame'],
                    'reception_error_frames': predictions[j]['end_frame']-truth[i]['reception_frame']}
                    for i, j in sorted(matched.items())]}
    return {'settings': metrics, 'tolerance_frames': tolerance_frames,
            'scope': 'reviewed replay window only; not all-shot generalization',
            'label_provenance': labels, 'production_eligible': False}


def process(body, receipt, pbp, *, event_id, reviews=None, labels=None):
    digest = source_hash(body)
    if receipt.get('sha256') != digest:
        raise ValueError('Replay receipt hash mismatch')
    if receipt.get('status') != 200:
        raise ValueError('Successful retrieval receipt required')
    if receipt.get('game') != pbp.get('id') or receipt.get('event') != event_id:
        raise ValueError('Receipt game/event mismatch')
    events = [p for p in pbp['plays'] if p['eventId'] == event_id]
    if len(events) != 1 or not events[0].get('pptReplayUrl'):
        raise ValueError('Exactly one source-linked event required')
    if events[0]['pptReplayUrl'] != receipt.get('replay_url', receipt.get('url')):
        raise ValueError('PBP and receipt replay URL mismatch')
    goalies = [p['playerId'] for p in pbp['rosterSpots'] if p['positionCode'] == 'G']
    packet = build_packet(body, game_id=pbp['id'], event_id=event_id, goalie_ids=goalies)
    measured, unresolved, seen_reviews = [], [], set()
    for review in reviews or []:
        if review.get('source_sha256') != digest:
            raise ValueError('Review source hash mismatch')
        if review.get('classification') == 'reviewed_direct_pass':
            identity = tuple(review.get(k) for k in ('passer_player_id', 'receiver_player_id',
                                                     'release_frame', 'reception_frame', 'shot_frame'))
            if identity in seen_reviews:
                raise ValueError('Duplicate reviewed measurement')
            seen_reviews.add(identity)
            measured.append(measure_reviewed(body, review))
        elif review.get('classification') in ('uncertain', 'rejected'):
            if not all(isinstance(review.get(k), str) and review[k].strip()
                       for k in ('reviewer', 'evidence_reference', 'reason')):
                raise ValueError('Unresolved reviews need provenance and reason')
            unresolved.append(review)
        else:
            raise ValueError('Unknown review classification')
    return {'schema_version': 1, 'packet': packet, 'reviewed_measurements': measured,
            'unresolved_reviews': unresolved,
            'detector_evaluation': evaluate(packet, labels) if labels is not None else None,
            'status': 'offline_review_required' if not measured else 'offline_reviewed_measurements',
            'production_eligible': False, 'model_training_eligible': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('replay', 'receipt', 'pbp', 'out'):
        parser.add_argument('--'+name, required=True, type=Path)
    parser.add_argument('--event', required=True, type=int)
    parser.add_argument('--reviews', type=Path, help='JSON list of reviewed/uncertain/rejected annotations')
    parser.add_argument('--labels', type=Path, help='Exhaustive-window labels for detector evaluation')
    args = parser.parse_args()
    if args.out.exists():
        parser.error('Output exists; evidence is never overwritten')
    read = lambda p: json.loads(p.read_bytes())
    result = process(args.replay.read_bytes(), read(args.receipt), read(args.pbp),
                     event_id=args.event, reviews=read(args.reviews) if args.reviews else None,
                     labels=read(args.labels) if args.labels else None)
    result['input_sha256'] = {name: source_hash(path.read_bytes()) for name in
        ('replay', 'receipt', 'pbp', 'reviews', 'labels') if (path := getattr(args, name)) is not None}
    result['code_sha256'] = {name: source_hash(Path(__file__).with_name(name).read_bytes()) for name in
        ('passing_system.py', 'passing_sequence_review.py', 'passing_sequence_geometry.py',
         'tracked_comotion_candidates.py', 'tracked_transfer_candidates.py', 'passing_time_alignment.py')}
    serialized = json.dumps(result, allow_nan=False)
    with args.out.open('x') as f:
        f.write(serialized)
    print(json.dumps({'status': result['status'], 'candidate_variants': len(result['packet']['candidates']),
                      'reviewed_measurements': len(result['reviewed_measurements']), 'output': str(args.out)}))


if __name__ == '__main__':
    main()
