"""Replay official source bytes before a create-only retrospective experiment.

The adapter never loads legacy models. Test feature and inventory JSON are not
parsed until the experiment has persisted its fitted pipeline. File byte hashes
can be checked beforehand without interpreting test outcomes.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
from itertools import groupby
import json
from pathlib import Path

from projections.analytics_publication import fingerprint
from projections.compact_feature_export import (FEATURES, FEATURE_FILES, INVENTORY_FILES, _split, project_compact_game,
                                                validate_windows)
from projections.frozen_feature_source import adapt_frozen_feature_source
from projections.chronological_fit import cohort_digests
from projections import chronological_fit
from projections.chronological_experiment import run_chronological_experiment
from projections.chronological_experiment import _persist

VERSION = 'citrus-byte-replayed-export-experiment-v1'
BOOLEAN_FEATURES = frozenset(('shooting_empty_net', 'defending_empty_net'))
GROUP_DIMENSIONS = ('shot_type', 'strength', 'defending_empty_net', 'season', 'rink_home_id', 'rebound')
DEPENDENCIES = (
    'projections/compact_feature_export.py', 'projections/causal_feature_projector.py',
    'projections/causal_feature_contract.py', 'projections/frozen_feature_source.py',
    'projections/analytics_publication.py', 'acquisition/observed_sequences.py',
    'acquisition/canonical_events.py', 'acquisition/event_observation_service.py',
    'monitoring/final_game_evidence.py', 'monitoring/appearance_contract.py',
    'monitoring/toi_source_receipt.py')


def validate_plan_semantics(plan):
    expected_population = {
        'version': 'strict-official-unblocked-geometry-matched-v1',
        'event_types': ['non_shootout_goal', 'shot_on_goal', 'missed_shot'],
        'whole_game_source_gate': 'exact_receipt_body_schedule_final_totals_identity_order_and_clock_validation',
        'eligibility': 'known_explicit_attacking_orientation_and_valid_distance_and_angle',
        'context_missing_policy': 'train_only_median_imputation_and_fixed_missingness_indicators',
        'missing_shot_type': 'retain_unknown_group_not_inferred_from_outcome',
        'empty_net': 'included_and_separately_reported',
        'blocked_shots_and_shootout': 'excluded_with_reason_in_full_source_inventory',
        'unapproved_statistical_exceptions': 'retain_quarantined_game_not_silently_adjudicated',
        'same_event_cohort_for_all_predictors': True}
    if (plan['population'] != expected_population
            or plan['source'] != 'newly_frozen_official_nhl_gamecenter_play_by_play'
            or plan['schema']['boolean_encoding'] != {name: 'false=0,true=1,null=missing' for name in BOOLEAN_FEATURES}
            or plan['evaluation']['predictors'] != [name + '_' + kind for name in ('prevalence', 'geometry', 'context')
                                                   for kind in ('raw', 'calibrated')]
            or plan['fit']['prevalence'] != 'training_outcome_rate_only'
            or plan['fit']['geometry'] != 'train_scaled_distance_abs_angle_quadratic_interaction_logistic'
            or plan['fit']['calibration'] != 'separate_later_window_fixed_L2_sigmoid_on_clipped_logit'
            or plan['fit']['test_loading'] != 'only_after_create_only_fit_artifacts_and_complete_pipeline_receipt_are_persisted'
            or plan['evaluation']['automatic_acceptance_or_serving_promotion'] is not False):
        raise ValueError('Declared source/population/encoding/predictor policy differs from execution')


def file_sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def strict_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('Duplicate JSON field')
            result[key] = value
        return result

    def constant(_):
        raise ValueError('Non-JSON numeric constant')
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)


def json_lines(path):
    with Path(path).open('rb') as stream:
        for line in stream:
            if not line.strip():
                raise ValueError('Empty line in immutable event inventory')
            yield strict_json(line)


def encode_features(row, schema):
    """Only the two reviewed binary goalie-presence fields accept Boolean input."""
    if tuple(schema['names']) != FEATURES or set(row['features']) != set(FEATURES):
        raise ValueError('Exact declared feature family and order required')
    values = []
    for name in schema['names']:
        value = row['features'][name]
        if name in BOOLEAN_FEATURES:
            if value is not None and type(value) is not bool:
                raise ValueError('Explicit source Boolean required for empty-net feature')
            value = int(value) if value is not None else None
        elif type(value) is bool:
            raise ValueError('Boolean cannot stand in for a measured numeric feature')
        values.append(value)
    return values


def encode_groups(groups):
    if set(groups) != set(GROUP_DIMENSIONS) | {'rebound_reason'}:
        raise ValueError('Exact declared subgroup inventory required')
    result = {}
    for name in GROUP_DIMENSIONS:
        value = groups[name]
        if value is None or value == 'unknown':
            result[name] = None
        elif name == 'defending_empty_net':
            if type(value) is not bool:
                raise ValueError('Explicit empty-net group Boolean required')
            result[name] = 'empty_net' if value else 'goalie_present'
        elif name in ('season', 'rink_home_id'):
            if type(value) is not int:
                raise ValueError('Exact source season/rink identity required')
            result[name] = str(value)
        elif not isinstance(value, str) or not value.strip():
            raise ValueError('Invalid categorical source group')
        else:
            result[name] = value
    return result


class ReplayedExport:
    """Source-authenticate each split independently; do not trust exported flags."""

    def __init__(self, export_dir, freeze_dir, plan_path, *, now=None):
        self.export = Path(export_dir).resolve()
        self.freeze = Path(freeze_dir).resolve()
        self.plan_path = Path(plan_path).resolve()
        self.plan_bytes = self.plan_path.read_bytes()
        self.plan = strict_json(self.plan_bytes)
        if (self.plan['contract'] != 'citrus-first-official-retrospective-experiment-plan-v1'
                or self.plan['evidence_claim'] != 'retrospective_current_source_revisions'
                or self.plan['untouched_test_claim'] is not False or self.plan['publishable'] is not False):
            raise ValueError('Explicit nonpublishing retrospective plan required')
        validate_windows(self.plan['windows'])
        validate_plan_semantics(self.plan)
        fit = self.plan['fit']
        actual = chronological_fit.CONFIG
        if (fit['seed'] != actual['seed'] or fit['logistic'] != actual['logistic']
                or fit['context'] != actual['context'] or fit['calibration_C'] != actual['calibration']['C']
                or fit['calibration_logit_epsilon'] != actual['calibration']['epsilon']
                or fit['test_tuning'] is not False):
            raise ValueError('Actual fit configuration differs from declared experiment')
        self.schema = {key: self.plan['schema'][key] for key in ('version', 'names')}
        if tuple(self.schema['names']) != FEATURES:
            raise ValueError('Declared plan does not match reviewed numeric schema')
        self.now = now or datetime.now(timezone.utc).isoformat()
        self.manifest_path = self.export / 'export-manifest.json'
        self.manifest_bytes = self.manifest_path.read_bytes()
        self.manifest = strict_json(self.manifest_bytes)
        m = self.manifest
        if (m['contract'] != 'citrus-official-compact-feature-export-v1'
                or m['status'] != 'export_complete_not_fit_accepted'
                or m['historical_as_of_verified'] is not False or m['publishable'] is not False
                or m['source_and_code_drift_check'] != 'passed' or m['source_failure_games']
                or m['windows'] != self.plan['windows'] or m['feature_schema'] != self.schema['names']
                or m['seasons'] != self.plan['source_seasons']
                or Path(m['source_freeze']).resolve() != self.freeze
                or m['manifest_content_sha256'] != fingerprint({k: v for k, v in m.items() if k != 'manifest_content_sha256'})):
            raise ValueError('Incomplete, detached or wrong export manifest')
        if set(m['output_files']) != set(FEATURE_FILES.values()) | set(INVENTORY_FILES.values()) | {'game-inventory.jsonl'}:
            raise ValueError('Exact complete split output inventory required')
        pipeline = Path(__file__).resolve().parents[1]
        expected_code = {str((pipeline / name).resolve()) for name in DEPENDENCIES}
        if set(m['code_sha256']) != expected_code:
            raise ValueError('Exact reviewed export dependency closure required')
        self.code_hashes = {**m['code_sha256'], str(Path(__file__).resolve()): file_sha(__file__)}
        self.schedule_path = self.freeze / 'schedule-manifest.json'
        schedule_bytes = self.schedule_path.read_bytes()
        if hashlib.sha256(schedule_bytes).hexdigest() != m['schedule_manifest_sha256']:
            raise ValueError('Frozen schedule bytes changed')
        schedule = strict_json(schedule_bytes)
        self.expected = {name: {} for name in ('train', 'calibration', 'test', 'outside_windows')}
        seen = set()
        for season in m['seasons']:
            report = schedule[str(season)]
            if (report['season'] != season or report['window_complete'] is not True
                    or report['reported_season_within_window'] is not True or report['unresolved_game_ids']):
                raise ValueError('Incomplete selected schedule window')
            for gid in report['terminal_game_ids']:
                if type(gid) is not int or gid // 1000000 != season or gid in seen:
                    raise ValueError('Duplicate or conflicting scheduled game')
                seen.add(gid)
                identity = report['games'][str(gid)]
                self.expected[_split(identity['date'], self.plan['windows'])][gid] = identity
        if len(seen) != m['expected_games'] or len(seen) != m['counts']['games']:
            raise ValueError('Export does not cover selected scheduled population')
        self.source_files = {}
        self.replays = {}
        self.verify_unchanged()

    def verify_unchanged(self):
        if self.manifest_path.read_bytes() != self.manifest_bytes or self.plan_path.read_bytes() != self.plan_bytes:
            raise ValueError('Export or experiment plan changed')
        if file_sha(self.schedule_path) != self.manifest['schedule_manifest_sha256']:
            raise ValueError('Source schedule changed')
        for name, metadata in self.manifest['output_files'].items():
            if Path(name).name != name:
                raise ValueError('Unsafe export file name')
            path = self.export / name
            if path.is_symlink() or path.stat().st_size != metadata['bytes'] or file_sha(path) != metadata['sha256']:
                raise ValueError('Immutable export output changed')
        for path, digest in {**self.code_hashes, **self.source_files}.items():
            if file_sha(path) != digest:
                raise ValueError('Source or replay code changed')

    def load_split(self, split):
        if split not in ('train', 'calibration', 'test') or split in self.replays:
            raise ValueError('Each declared split may be replayed only once')
        self.verify_unchanged()
        feature_name, inventory_name = f'{split}.features.jsonl', f'{split}.game-inventory.jsonl'
        if feature_name not in self.manifest['output_files'] or inventory_name not in self.manifest['output_files']:
            raise ValueError('Separate split feature/inventory files required')
        feature_groups = iter(groupby(json_lines(self.export / feature_name), key=lambda row: row['game_id']))
        pending = next(feature_groups, None)
        rows, groups, counts, replay_inventory = [], [], Counter(), []
        games_seen = set()
        schema_sha = fingerprint(self.schema)
        for game in json_lines(self.export / inventory_name):
            gid = game['game_id']
            if type(gid) is not int or gid in games_seen or gid not in self.expected[split]:
                raise ValueError('Duplicate or unscheduled split game')
            games_seen.add(gid)
            folder = self.freeze / str(gid // 1000000) / 'pbp'
            body_path, receipt_path = folder / f'{gid}.body.json', folder / f'{gid}.receipt.json'
            if body_path.is_symlink() or receipt_path.is_symlink():
                raise ValueError('Symlink source evidence prohibited')
            body, receipt_bytes = body_path.read_bytes(), receipt_path.read_bytes()
            receipt = strict_json(receipt_bytes)
            if receipt['schedule_identity'] != self.expected[split][gid]:
                raise ValueError('Original source/schedule identity mismatch')
            source = adapt_frozen_feature_source(body, receipt, now=self.now)
            replay = project_compact_game(source, evidence_kind='real', windows=self.plan['windows'], now=self.now)
            expected_game = replay['game_inventory']
            expected_game.update(source_body_file=str(body_path), source_receipt_file=str(receipt_path),
                source_body_bytes_sha256=hashlib.sha256(body).hexdigest(),
                source_receipt_bytes_sha256=hashlib.sha256(receipt_bytes).hexdigest())
            if game != expected_game:
                raise ValueError('Full exported game inventory differs from source replay')
            self.source_files[str(body_path)] = expected_game['source_body_bytes_sha256']
            self.source_files[str(receipt_path)] = expected_game['source_receipt_bytes_sha256']
            actual_rows = []
            if pending is not None and pending[0] == gid:
                actual_rows = list(pending[1])
                pending = next(feature_groups, None)
            if actual_rows != replay['rows']:
                raise ValueError('Exported features/labels/exclusions differ from independent source replay')
            counts['games'] += 1
            counts['candidate_rows'] += len(actual_rows)
            counts['source_excluded_games'] += game['source_excluded_game']
            replay_inventory.append({'game_id': gid, 'source_sha256': game['source_sha'],
                                     'game_inventory_sha256': fingerprint(game)})
            for row in actual_rows:
                if row['cohort_eligibility']['geometry_baseline'] is not True:
                    counts['excluded_candidate_rows'] += 1
                    continue
                values = encode_features(row, self.schema)
                rows.append({'split': split, 'game_id': gid, 'event_id': row['event_id'],
                    'game_date': row['game_date'], 'label': int(row['label']), 'features': values,
                    'source_sha256': row['source_sha'],
                    'feature_sha256': fingerprint({'schema_sha256': schema_sha, 'values': values})})
                groups.append({'game_id': gid, 'event_id': row['event_id'], 'groups': encode_groups(row['groups'])})
        if games_seen != set(self.expected[split]) or pending is not None:
            raise ValueError('Missing/extra complete split game or feature inventory')
        rows.sort(key=lambda row: (row['game_date'], row['game_id'], row['event_id']))
        groups.sort(key=lambda row: (row['game_id'], row['event_id']))
        if (len(rows) != self.manifest['output_files'][feature_name]['geometry_baseline_rows']
                or counts['candidate_rows'] != self.manifest['output_files'][feature_name]['rows']):
            raise ValueError('Declared selected population count mismatch')
        counts['eligible_rows'] = len(rows)
        self.replays[split] = {'counts': dict(counts), 'source_replay_sha256': fingerprint(replay_inventory)}
        self.verify_unchanged()
        print(json.dumps({'event': 'verified_export.split_replayed', 'split': split, **self.replays[split]}), flush=True)
        cohort = {'split': split, 'window': self.plan['windows'][split], 'rows': rows, **cohort_digests(rows)}
        return {'cohort': cohort, 'groups': groups}


def execute_verified_export(export_dir, freeze_dir, plan_path, output):
    # The outer directory belongs to this adapter; the model runner owns only
    # its fresh child. Inner completed health never substitutes for outer health.
    directory = Path(output)
    directory.mkdir(exist_ok=False)
    try:
        replay = ReplayedExport(export_dir, freeze_dir, plan_path)
        train = replay.load_split('train')['cohort']
        calibration = replay.load_split('calibration')['cohort']
        provenance = {'export_manifest_sha256': hashlib.sha256(replay.manifest_bytes).hexdigest(),
            'source_inventory_sha256': replay.manifest['schedule_manifest_sha256'],
            'export_combined_inventory_sha256': replay.manifest['output_files']['game-inventory.jsonl']['sha256'],
            'execution_plan_sha256': hashlib.sha256(replay.plan_bytes).hexdigest(),
            'adapter_code_sha256': file_sha(__file__), 'evidence_kind': 'real'}
        result = run_chronological_experiment(train=train, calibration=calibration, schema=replay.schema,
            test_window=replay.plan['windows']['test'], provenance=provenance, output=directory / 'experiment',
            read_test=lambda: replay.load_split('test'), scorecard_config=replay.plan['evaluation']['scorecard'],
            group_dimensions=GROUP_DIMENSIONS)
        replay.verify_unchanged()
        receipt_sha = _persist(directory, 'source-replay-receipt.json', {
            'contract': VERSION, 'source_and_code_drift_check': 'passed', 'splits': replay.replays,
            'scope': 'train-calibration-test-only; outside-window/combined inventories hash-checked not replayed',
            'publishable': False, 'provenance': provenance})
        health = {'status': 'completed-source-replayed-retrospective-not-publishable', 'publishable': False,
                  'source_replay_receipt_sha256': receipt_sha, 'experiment_health_sha256': file_sha(directory / 'experiment/health.json'),
                  'pipeline_sha256': result['pipeline_sha256']}
        _persist(directory, 'health.json', health)
        return health
    except Exception as error:
        try:
            _persist(directory, 'failure.json', {'status': 'failed-source-verification-or-experiment',
                'error_type': type(error).__name__, 'publishable': False,
                'completion_contract': 'Inner experiment health alone is insufficient; outer health and replay receipt are required.'})
        except OSError:
            pass
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('export-dir', 'freeze-dir', 'plan', 'output'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    try:
        result = execute_verified_export(args.export_dir, args.freeze_dir, args.plan, args.output)
        print(json.dumps({'event': 'verified_export.experiment_finished', **result}), flush=True)
        return 0
    except Exception as error:
        print(json.dumps({'event': 'verified_export.experiment_failed', 'status': 'failed-not-publishable',
                          'error_type': type(error).__name__}), flush=True)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
