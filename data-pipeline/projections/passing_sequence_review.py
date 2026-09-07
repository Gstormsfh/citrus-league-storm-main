"""Offline bridge from transfer candidates to explicitly reviewed measurements.

Review packets deliberately contain no inferred shot cutoff or net position.
Reviewer assertions are provenance, not ground truth established by this code.
"""
import hashlib
import json
import math

from projections.tracked_comotion_candidates import extract
from projections.passing_sequence_geometry import measure
from projections.passing_time_alignment import reconcile


def source_hash(body):
    return hashlib.sha256(body).hexdigest()


def build_packet(body, *, game_id, event_id, goalie_ids=()):
    frames = json.loads(body)
    digest = source_hash(body)
    candidates = []
    for radius in (60, 84):
        for limit in (12, 24, 36):
            result = extract(frames, goalie_ids=goalie_ids, radius=radius,
                             relative_step_limit=limit)
            for candidate in result['candidates']:
                identity = [digest, radius, limit, candidate['from_player_id'],
                            candidate['to_player_id'], candidate['start_frame'], candidate['end_frame']]
                candidates.append({**candidate, 'candidate_id': hashlib.sha256(
                    json.dumps(identity).encode()).hexdigest(),
                    'setting': {'radius': radius, 'relative_step_limit': limit},
                    'review_status': 'unreviewed', 'geometry': None})
    return {'schema_version': 1, 'game_id': game_id, 'event_id': event_id,
            'source_sha256': digest, 'frames': len(frames), 'candidates': candidates,
            'coverage': 'goal-selected replay; not representative all-shot coverage',
            'absence_means_no_pass': False, 'production_eligible': False,
            'missing_requirements': ['independent pass/shot frame review',
                                     'coordinate orientation and net reference',
                                     'verified timing convention']}


def measure_reviewed(body, annotation):
    """Accept explicit reviewed direct-pass annotations, independent of detector IDs.

    This also permits annotating missed detections. Rejected/uncertain examples
    remain in review data; they cannot silently become model no-pass labels.
    """
    if annotation.get('source_sha256') != source_hash(body):
        raise ValueError('Annotation does not match replay bytes')
    for key in ('reviewer', 'evidence_reference', 'coordinate_units', 'coordinate_reference', 'timing_reference'):
        if not isinstance(annotation.get(key), str) or not annotation[key].strip():
            raise ValueError(f'Missing review provenance: {key}')
    if annotation.get('classification') != 'reviewed_direct_pass':
        raise ValueError('Only explicitly reviewed direct passes can be measured here')
    frames = json.loads(body)
    release, reception, shot = (annotation.get(k) for k in ('release_frame', 'reception_frame', 'shot_frame'))
    if not all(type(i) is int for i in (release, reception, shot)) or not 0 <= release < reception < shot < len(frames):
        raise ValueError('Distinct ordered release, reception and shot frames required')
    if annotation.get('receiver_player_id') != annotation.get('shooter_player_id'):
        raise ValueError('Receiver movement requires the receiver to be the shooter')
    sender, receiver, team = (annotation.get(k) for k in ('passer_player_id', 'receiver_player_id', 'team_id'))
    if not all(type(i) is int and i > 0 for i in (sender, receiver, team)) or sender == receiver:
        raise ValueError('Distinct positive player IDs and team required')
    tick = annotation.get('seconds_per_tick')
    if type(tick) not in (int, float) or not math.isfinite(tick) or tick <= 0:
        raise ValueError('Verified positive seconds-per-tick required')
    anchors = annotation.get('alignment_anchors')
    if not isinstance(anchors, list):
        raise ValueError('Independent video/replay timing landmarks required')
    alignment = reconcile(anchors, seconds_per_tick=tick)
    if not alignment['consistent']:
        raise ValueError('Video/replay landmarks disagree; measurement withheld')
    transform = annotation.get('coordinate_transform')
    if not isinstance(transform, dict):
        raise ValueError('Explicit renderer-to-output coordinate transform required')
    scale, origin = transform.get('units_per_renderer_unit'), transform.get('origin_renderer')
    signs = transform.get('axis_signs')
    if (type(scale) not in (int, float) or not math.isfinite(scale) or scale <= 0
            or not isinstance(origin, (list, tuple)) or len(origin) != 2
            or not all(type(v) in (int, float) and math.isfinite(v) for v in origin)
            or not isinstance(signs, (list, tuple)) or len(signs) != 2
            or not all(type(v) is int and v in (-1, 1) for v in signs)):
        raise ValueError('Finite isotropic scale, origin and axis signs required')
    previous = None
    for frame in frames[release:shot+1]:
        stamp = frame.get('timeStamp')
        if type(stamp) not in (int, float) or not math.isfinite(stamp) or (previous is not None and stamp != previous+1):
            raise ValueError('Do not bridge missing or unordered replay ticks')
        previous = stamp
        puck = frame.get('onIce', {}).get('1', {})
        if not all(type(puck.get(k)) in (int, float) and math.isfinite(puck[k]) for k in ('x', 'y')):
            raise ValueError('Missing puck trajectory within reviewed sequence')
    for index, player in ((release, sender), (reception, receiver), (shot, receiver)):
        matches = [a for a in frames[index]['onIce'].values() if a.get('playerId') == player]
        if len(matches) != 1 or matches[0].get('teamId') != team:
            raise ValueError('Reviewed actor/team not uniquely present at endpoint')
    def point(index):
        p = frames[index]['onIce']['1']
        # Net must already be in this output coordinate frame. A unit label
        # alone must never relabel native renderer positions as physical feet.
        return tuple((p[k]-origin[i])*scale*signs[i] for i,k in enumerate(('x','y')))
    geometry = measure(release=point(release), reception=point(reception), shot=point(shot),
        net=annotation.get('net'), coordinate_units=annotation['coordinate_units'],
        flight_seconds=(frames[reception]['timeStamp']-frames[release]['timeStamp'])*tick,
        reception_to_shot_seconds=(frames[shot]['timeStamp']-frames[reception]['timeStamp'])*tick)
    geometry['receiver_movement_measurement_basis'] = 'puck endpoints, not tracked skater travel distance'
    return {'source_sha256': source_hash(body), 'annotation': dict(annotation), 'geometry': geometry,
            'timing_alignment': alignment,
            'review_assertions_independently_verified_by_code': False,
            'production_eligible': False, 'model_training_eligible': False}
