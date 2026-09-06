"""Pure official-PBP causal input staging, never a fitted/serving feature matrix.

Full receipts and exclusions are retained separately from an allowlisted at-shot
view. At-shot means physical/event-time context, NOT demonstrated historical live
availability: archived annotations may have been revised after the game.
No legacy acquisition/trainer imports, artifact loading, imputation, or fitting.
"""
import json
import math
from datetime import date, datetime

from acquisition.observed_sequences import extract_observed_sequences
from projections.analytics_publication import fingerprint

VERSION = 'citrus-official-causal-input-v1'
# Existing families remain visible even when this first slice cannot compute them.
UNAVAILABLE_FAMILIES = {
    'oriented_geometry_slot_interactions': 'versioned_orientation_and_geometry_projection_required',
    'rink_adjustment': 'train_only_official_rink_fit_and_venue_identity_required',
    'categorical_encoders': 'train_only_vocabulary_and_unknown_policy_required',
    'score_strength_empty_net_powerplay_duration': 'reviewed_prefix_state_machine_required',
    'prior_event_motion_rush_rebound_royal_road': 'reviewed_boundary_and_coordinate_transform_required',
    'pass_zone_immediacy_quality_goalie_movement': 'prior_event_proxy_definition_not_observed_pass_or_tracking',
    'shift_toi_rest_and_team_composition': 'dated_shift_intervals_and_onice_roster_join_required',
    'handedness_position_off_wing': 'dated_official_player_metadata_required',
    'defender_proximity_screening': 'independent_tracking_source_required',
    'shooting_talent': 'prior_game_only_first_party_fit_and_out_of_fold_baseline_required',
    'rebound_probability_conditional_rebound_value': 'separate_targets_and_train_calibration_receipts_required',
    'xa_pass_value': 'real_pass_population_and_target_required_no_synthetic_trainer_import',
    'flurry_created_xg': 'postprediction_accounting_not_base_xg_input',
    'season_era_calibration': 'independent_calibration_window_and_model_binding_required',
    'daily_opportunity_opponent_goalie_uncertainty_gar': 'downstream_models_not_current_shot_inputs',
}


def _value(value, kind):
    if kind == 'number':
        valid = type(value) in (int, float) and math.isfinite(value)
    elif kind == 'positive_id':
        valid = type(value) is int and value > 0
    elif kind == 'side':
        valid = value in ('left', 'right')
    elif kind == 'situation':
        valid = isinstance(value, str) and len(value) == 4 and value.isascii() and value.isdigit()
    else:
        valid = isinstance(value, str) and bool(value.strip())
    return {'value': value if valid else None,
            'status': 'observed_annotation' if valid else 'unavailable',
            'reason': None if valid else 'missing_or_invalid_source_field'}


def _context(play, *, prior):
    details = play.get('details')
    details = details if isinstance(details, dict) else {}
    fields = {
        'x_raw': _value(details.get('xCoord'), 'number'),
        'y_raw': _value(details.get('yCoord'), 'number'),
        'owner_team_id': _value(details.get('eventOwnerTeamId'), 'positive_id'),
        'home_team_defending_side': _value(play.get('homeTeamDefendingSide'), 'side'),
        'situation_code_raw': _value(play.get('situationCode'), 'situation'),
    }
    if prior:
        # A previous event's outcome is historical context, but current/future
        # typeCode, outcome-specific fields and scoreboard are never predictors.
        fields['event_type_code'] = play['typeCode']
    else:
        fields['shot_type_raw'] = _value(details.get('shotType'), 'text')
    return fields


def build_causal_input_contract(receipt, *, evidence_kind, exclusions, now=None):
    """Stage a full frozen collect_observations receipt with explicit exclusions.

    ``exclusions`` is a list of {event_id, reason} for additional attempt-level
    exclusions. All other attempts remain candidate rows (not training-ready).
    No arbitrary feature expressions or learned values are accepted. Source
    gate failures return unavailable with the unchanged receipt retained.
    """
    if evidence_kind not in ('real', 'synthetic'):
        raise ValueError('Explicit real/synthetic evidence kind required')
    if not isinstance(exclusions, list):
        raise ValueError('Explicit exclusion list required')
    excluded = {}
    for item in exclusions:
        if (not isinstance(item, dict) or set(item) != {'event_id', 'reason'}
                or type(item['event_id']) is not int or item['event_id'] < 0
                or item['event_id'] in excluded or not isinstance(item['reason'], str)
                or not item['reason'].strip()):
            raise ValueError('Malformed or duplicate exclusion')
        excluded[item['event_id']] = item['reason']
    # Copy validates JSON/nonfinite values without altering the caller's bytes/object.
    frozen = json.loads(json.dumps(receipt, allow_nan=False))
    source = extract_observed_sequences(frozen, max_gap_seconds=0, now=now)
    body = {'contract': VERSION, 'status': 'unavailable', 'training_ready': False,
            'publishable': False, 'evidence_kind': evidence_kind,
            'validation_semantics': 'manifest_consistency_not_source_authentication',
            'historical_as_of_verified': False,
            'source_receipt': frozen, 'source_receipt_sha256': fingerprint(frozen),
            'source_gate': source,
            'exclusions': [{'event_id': eid, 'reason': excluded[eid]} for eid in sorted(excluded)],
            'unavailable_families': dict(UNAVAILABLE_FAMILIES),
            'rows': [], 'stream_inventory': []}
    if not source['verified']:
        body['reason'] = 'source_gate_unavailable'
    else:
        payload = frozen['prepared'][0]['payload']['pbp']
        try:
            day = date.fromisoformat(payload['gameDate'])
            observed_day = datetime.fromisoformat(source['observed_at']).date()
            if (day.isoformat() != payload['gameDate'] or day > observed_day
                    or day.year not in (payload['id'] // 1000000, payload['id'] // 1000000 + 1)):
                raise ValueError
        except (KeyError, TypeError, ValueError):
            raise ValueError('Explicit season-consistent game date required') from None
        attempts = {e['event_id'] for chain in source['chains'] for e in chain['events']}
        if not set(excluded) <= attempts:
            raise ValueError('Exclusion outside exact source attempt inventory')
        prefix = []
        for play in payload['plays']:
            eid = play['eventId']
            identity = {'event_id': eid, 'sort_order': play['sortOrder'],
                        'source_event_sha256': fingerprint(play),
                        'period': play['periodDescriptor']['number'],
                        'period_type': play['periodDescriptor']['periodType'],
                        'time_in_period': play['timeInPeriod']}
            reason = excluded.get(eid) if eid in attempts else (
                'shootout' if play['periodDescriptor']['periodType'] == 'SO' else 'not_unblocked_attempt')
            body['stream_inventory'].append({**identity, 'included_candidate': eid in attempts and reason is None,
                                              'exclusion_reason': reason})
            if eid in attempts:
                body['rows'].append({**identity, 'game_id': payload['id'], 'game_date': payload['gameDate'],
                                     'excluded_reason': reason,
                                     'at_shot_annotations': _context(play, prior=False),
                                     'strict_prior_context': list(prefix),
                                     'retrospective_labels': {'is_goal': play['typeCode'] == 505},
                                     'timing': 'event_time_not_historical_delivery_time'})
            prefix.append({**identity, 'annotations': _context(play, prior=True)})
        body.update(status='staged_not_training_ready', reason='feature_projection_and_fit_receipts_required')
    return {**body, 'contract_sha256': fingerprint(body)}
