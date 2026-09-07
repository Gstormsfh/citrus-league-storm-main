"""Exact reviewed-source offline feature replay, without changing strict gates.

Reuses original arithmetic and raw event order. Source-specific exception accepts
only the pinned statistical partition after transport/normalization revalidation.
Not historical-as-of evidence, training acceptance, or production activation.
"""
import argparse
from collections import Counter
from pathlib import Path
import re

import partition_reviewed_goal_credit as credit
from collect_development_sog_reports import module
from run_calibration_transfer import ROOT, reuse, pin_run, file_sha, fingerprint
from projections.causal_feature_contract import _context
from projections.causal_feature_projector import project_row_features
from projections.compact_feature_export import FEATURES, BASELINE_FEATURES, COORDINATES
from projections.development_feature_export import EXTRA_NUMERIC, prefix_measurements, _period
from projections.frozen_feature_source import adapt_frozen_feature_source
from run_movement_candidate import project as movement_project, NAMES

SOURCE = 'scripts/proof/results/reviewed-goal-credit-partition-20260907-full'
SHA = '939dd885644ff900afd86d582b9ec1c136c7c22d3177859a6f8b42e1ed9184d1'
SCHEMA = {'version': 'citrus-matched-pre-shot-movement-v1', 'names': list(FEATURES+EXTRA_NUMERIC+NAMES),
          'categorical_names': ['shot_type', 'previous_event_type']}


def project(payload, partition):
    """Pure arithmetic; run() establishes the exact source/review gate first."""
    plays = payload['plays']; inventory = partition['events']
    if payload['id'] != partition['game_id'] or len(plays) != len(inventory):
        raise ValueError('Complete aligned raw inventory required')
    home, away = payload['homeTeam']['id'], payload['awayTeam']['id']
    movement = movement_project(plays, home=home, away=away)
    scores = {home: 0, away: 0}; previous = prior = faceoff = None
    first = plays[0] if plays else {}
    score_known = (first.get('typeCode') == 520 and first.get('timeInPeriod') == '00:00'
                   and first.get('periodDescriptor') == {'number': 1, 'periodType': 'REG'})
    rows = []; exclusions = []; availability = Counter()
    for index, (play, member) in enumerate(zip(plays, inventory)):
        if (member['raw_sequence_index'] != index or member['event_id'] != play['eventId']
                or member['source_event_sha256'] != fingerprint(play)):
            raise ValueError('Detached raw inventory event')
        descriptor = play['periodDescriptor']
        identity = {'event_id': play['eventId'], 'period': descriptor['number'],
                    'period_type': descriptor['periodType'], 'time_in_period': play['timeInPeriod']}
        if member['statistical_shot_attempt']:
            base = project_row_features({**identity, 'at_shot_annotations': _context(play, prior=False),
                'strict_prior_context': [prior] if prior else []}, home, away, score_state=(score_known, scores))
            missing = [n for n in BASELINE_FEATURES if base[n]['value'] is None]
            extra = prefix_measurements(play, previous, faceoff, home=home, away=away,
                base_row={'coordinates': {n: base[n] for n in COORDINATES},
                          'features': {n: base[n]['value'] for n in FEATURES}})
            values = [int(base[n]['value']) if type(base[n]['value']) is bool else base[n]['value'] for n in FEATURES]
            values += [extra['values'][n] for n in EXTRA_NUMERIC] + movement[play['eventId']]
            if len(values) != len(SCHEMA['names']): raise ValueError('Exact schema width required')
            availability.update(n for n, v in zip(SCHEMA['names'], values) if v is None)
            if missing:
                exclusions.append({'event_id': play['eventId'], 'reason': 'missing_geometry', 'fields': missing})
            else:
                row = {'game_id': payload['id'], 'event_id': play['eventId'], 'game_date': payload['gameDate'],
                       'label': bool(member['shot_event_goal']), 'features': values, 'categorical': extra['categorical'],
                       'source_event_sha256': member['source_event_sha256']}
                row['feature_sha256'] = fingerprint({'schema_sha256': fingerprint(SCHEMA), 'values': values, 'categorical': row['categorical']})
                rows.append(row)
        elif member.get('reviewed_non_shot_goal'):
            exclusions.append({'event_id': play['eventId'], 'reason': 'reviewed_non_shot_goal_credit_preserved'})
        # Every raw goal changes score AFTER emitting that event's predictors.
        # The unchanged movement selector resets on all goals, including awards.
        if play['typeCode'] == 505 and descriptor['periodType'] != 'SO':
            owner = play['details'].get('eventOwnerTeamId')
            if owner not in scores: raise ValueError('Unknown goal owner')
            scores[owner] += 1
        if previous is None or _period(previous) != _period(play): faceoff = None
        if play['typeCode'] == 502: faceoff = play
        previous = play; prior = {**identity, 'annotations': _context(play, prior=True)}
    return {'game_id': payload['id'], 'rows': rows, 'exclusions': exclusions,
            'missing_by_feature': dict(availability), 'pre_shootout_goal_credits': scores,
            'publishable': False, 'production_changed': False, 'original_gate_modified': False}


def run(output):
    output = Path(output).absolute()
    if output.parent != ROOT/'scripts/proof/results' or any(p.is_symlink() for p in (output, *output.parents)):
        raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False); closure = reuse.Closure(ROOT); writer = module('collect_goal_sog_evidence')
    for name in ('scripts/proof/reconstruct_reviewed_features.py', 'scripts/proof/test_reconstruct_reviewed_features.py',
                 'scripts/proof/run_movement_candidate.py', 'data-pipeline/projections/pre_shot_history.py',
                 'data-pipeline/projections/pre_shot_movement.py', 'data-pipeline/projections/causal_feature_projector.py',
                 'data-pipeline/projections/causal_feature_contract.py', 'data-pipeline/projections/compact_feature_export.py',
                 'data-pipeline/projections/development_feature_export.py', 'data-pipeline/projections/frozen_feature_source.py',
                 'data-pipeline/acquisition/canonical_events.py', 'data-pipeline/acquisition/event_observation_service.py',
                 'data-pipeline/monitoring/final_game_evidence.py', 'data-pipeline/projections/analytics_publication.py'):
        closure.pin(name, file_sha(ROOT/name))
    health = pin_run(closure, SOURCE, SHA, 'complete-reviewed-goal-credit-partition')
    closure.mapping(closure.read(SOURCE+'/consumed-file-sha256.json'))
    summary = {'games': 0, 'feature_rows': 0, 'shot_event_goals': 0, 'exclusions': Counter(),
               'publishable': False, 'production_changed': False, 'historical_as_of_verified': False}
    for name in sorted(n for n in health['files'] if re.fullmatch(r'\d{10}\.json', n)):
        saved = closure.read(SOURCE+'/'+name); gid = saved['game_id']; review = closure.read(credit.SOURCE+'/'+name)
        stem = f'scripts/proof/results/historical-official-freeze-20260906/{gid//1000000}/pbp/{gid}'
        body = closure.safe(stem+'.body.json').read_bytes(); receipt = closure.read(stem+'.receipt.json')
        source = adapt_frozen_feature_source(body, receipt)
        if (source['status'] != 'quarantined' or receipt['normalization']['complete'] is not True
                or receipt['final_game_evidence']['reason'] != 'final_attempt_totals_mismatch'
                or not receipt['final_game_evidence']['differences']
                or any(d['field'] != 'sog' for d in receipt['final_game_evidence']['differences'])):
            raise ValueError('Only exact SOG-statistical exception accepted')
        payload = closure.read(stem+'.body.json'); rebuilt = credit.partition(payload, review)
        if {k: v for k, v in saved.items() if k != 'report_attempt_correspondence'} != rebuilt:
            raise ValueError('Partition replay mismatch')
        out = project(payload, rebuilt); out['source_body_sha256'] = receipt['body_sha256']
        writer.write_new(output/name, out); summary['games'] += 1; summary['feature_rows'] += len(out['rows'])
        summary['shot_event_goals'] += sum(r['label'] for r in out['rows'])
        summary['exclusions'].update(r['reason'] for r in out['exclusions'])
    closure.verify(); writer.write_new(output/'schema.json', SCHEMA)
    writer.write_new(output/'consumed-file-sha256.json', closure.checked); writer.write_new(output/'summary.json', summary)
    writer.write_new(output/'health.json', {'status': 'complete-reviewed-feature-reconstruction-not-inference',
        'publishable': False, 'files': {p.name: file_sha(p) for p in output.iterdir() if p.is_file()}})
    print(summary, flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--output', required=True); run(parser.parse_args().output)
