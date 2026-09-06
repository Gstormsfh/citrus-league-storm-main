"""Nonpublishing source-gated accounting; never changes prediction columns.

Prediction validation is a supplied, hash-bound attestation, not independently
verified calibration. Legacy callers have no such receipt and remain unavailable.
No artifact loading, network, database, training, inferred lineage or opt-in gate.
"""
import re
import logging

from acquisition.observed_sequences import extract_observed_sequences
from projections.analytics_publication import fingerprint
from projections.sequence_value import GOAL, Lineage, Probability, Shot, survival_weighted_flurry


def apply_sequence_shadow(frame, payload, game_id, *, context=None):
    """Attach a per-game diagnostic to DataFrame.attrs; return that diagnostic.

    Context contains source_receipt, max_gap_seconds, prediction_receipt and
    validation_receipt. The latter explicitly distinguishes synthetic/real
    evidence and binds the entire prediction receipt, including artifact hashes.
    Success means shadow computation only, never approval to publish.
    """
    report = {'mode': 'shadow', 'publishable': False, 'status': 'unavailable',
              'game_id': game_id, 'chains': [],
              'validation_semantics': 'caller-attested-not-independently-verified'}

    def finish(reason, **extra):
        result = {**report, 'reason': reason, **extra}
        frame.attrs['sequence_shadow'] = result
        logging.getLogger(__name__).info('sequence_shadow game=%s status=%s reason=%s publishable=false',
                                         game_id, result['status'], reason)
        return result

    def digest(value):
        if not isinstance(value, str) or re.fullmatch('[0-9a-f]{64}', value) is None:
            raise ValueError('missing_artifact_digest')
        return value

    try:
        if context is None:
            return finish('source_and_prediction_receipts_missing')
        if not isinstance(context, dict):
            return finish('malformed_context')
        source = extract_observed_sequences(context['source_receipt'],
                                            max_gap_seconds=context['max_gap_seconds'])
        if source['verified'] is not True:
            return finish('source_unavailable', source_reason=source['reason'])
        if (type(game_id) is not int or game_id != source['game_id']
                or fingerprint(payload) != source['source_payload_sha256']):
            return finish('actual_source_conflict')
        prediction = context['prediction_receipt']
        validation = context['validation_receipt']
        evidence_kind = validation['evidence_kind']
        if evidence_kind not in ('synthetic', 'real'):
            return finish('evidence_kind_missing')
        report['evidence_kind'] = evidence_kind
        if (validation['status'] != 'passed'
                or validation['prediction_receipt_sha256'] != fingerprint(prediction)
                or not isinstance(validation['gate_version'], str)
                or not validation['gate_version'].strip()):
            return finish('prediction_validation_conflict')
        digest(validation['evidence_sha256'])
        if (prediction['source_receipt_sha256'] != source['source_receipt_sha256']
                or prediction['conditioning'] != GOAL
                or prediction['origin'] != 'citrus'):
            return finish('prediction_lineage_conflict')
        lineage = Lineage(source['source_receipt_sha256'],
                          digest(prediction['model_sha256']),
                          digest(prediction['features_sha256']),
                          digest(prediction['calibrator_sha256']))
        expected = {(e['game_id'], e['event_id']): e
                    for chain in source['chains'] for e in chain['events']}
        estimates = {}
        for row in prediction['events']:
            key = (row['game_id'], row['event_id'])
            if any(type(i) is not int for i in key) or key not in expected or key in estimates:
                return finish('prediction_population_conflict')
            event = expected[key]
            if (row['source_event_sha256'] != event['source_event_sha256']
                    or type(row['sort_order']) is not int or row['sort_order'] != event['sort_order']):
                return finish('prediction_event_identity_conflict')
            estimates[key] = Probability(row['value'], GOAL, lineage)
        actual = {}
        # Column records retain integer IDs; iterrows may coerce them to floats.
        # No row-position pairing and no probability imputation or clipping.
        for row in frame.to_dict(orient='records'):
            key = (row['game_id'], row['event_id'])
            if any(type(i) is not int for i in key) or key not in expected or key in actual:
                return finish('actual_population_conflict')
            actual[key] = Probability(row['xG_Value'], GOAL, lineage).value
        if set(actual) != set(expected) or set(estimates) != set(expected):
            return finish('incomplete_attempt_population')
        if any(actual[key] != estimates[key].value for key in expected):
            return finish('actual_prediction_conflict')
        chains = []
        for chain in source['chains']:
            shots = [Shot(str(e['event_id']), str(e['game_id']), str(e['team_id']),
                          e['period'], e['sort_order'], e['is_goal'],
                          estimates[(e['game_id'], e['event_id'])]) for e in chain['events']]
            value = survival_weighted_flurry(shots, sequence_verified=True,
                                             verification_receipt=chain['chain_id'])
            chains.append({'chain_id': chain['chain_id'], 'event_ids': list(value.shot_ids),
                           'contributions': list(value.contributions),
                           'cumulative': list(value.cumulative), 'survival': value.survival})
        return finish('shadow_accounting_only', status='computed', chains=chains,
                      model_sha256=lineage.model, features_sha256=lineage.features,
                      calibrator_sha256=lineage.calibrator,
                      source_receipt_sha256=source['source_receipt_sha256'],
                      prediction_receipt_sha256=fingerprint(prediction),
                      validation_receipt_sha256=fingerprint(validation),
                      definition=source['definition'], max_gap_seconds=source['max_gap_seconds'])
    except (KeyError, TypeError, ValueError, AttributeError, OverflowError):
        return finish('missing_or_invalid_evidence')
