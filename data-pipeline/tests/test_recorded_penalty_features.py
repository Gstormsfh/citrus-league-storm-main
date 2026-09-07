"""Synthetic complete-loader integration; never reads the real annotation corpus."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path

import pytest

from projections import recorded_penalty_features as candidate
from projections import verified_movement_reuse_v2 as reuse
from projections import pre_shot_penalty_context as penalty
from test_verified_movement_reuse_v2 import fixture


def setup(monkeypatch, tmp_path, change=None):
    args = fixture()
    folds, groups = reuse.reconstruct(*args)
    base_schema = args[3]
    actual_plan = json.loads((Path(__file__).resolve().parents[2] / candidate.PLAN).read_text())
    plan = deepcopy(actual_plan)
    plan['features']['base_schema'] = base_schema
    development = json.loads((Path(__file__).resolve().parents[2] / 'docs/analytics-development-ablation-plan-20260906.json').read_text())
    config = development['config']
    config['views'] = {'base_numeric_names': base_schema['names'][:2], 'enhanced_numeric_names': base_schema['names'][:],
                       'enhanced_categorical_names': base_schema['categorical_names'][:]}
    annotation = {'version': penalty.VERSION, 'scope': penalty.SCOPE, 'publishable': False,
                  'same_team': penalty._empty('no_recorded_penalty_in_current_period'),
                  'opponent': penalty._empty('no_recorded_penalty_in_current_period')}
    items = [{'game_id': row['game_id'], 'event_id': row['event_id'], 'annotation': deepcopy(annotation)} for row in args[0]]
    expected_keys = hashlib.sha256(''.join(f'{r["game_id"]}:{r["event_id"]}\n' for r in items).encode()).hexdigest()
    if change == 'duplicate': items.append(deepcopy(items[0]))
    if change == 'missing': items.pop()
    if change == 'extra': items[0]['event_id'] = 200
    if change == 'bool': items[0]['event_id'] = True
    if change == 'reorder': items.reverse()
    if change == 'outcome': items[0]['annotation']['target'] = 1
    if change == 'current_prior':
        items[0]['annotation']['same_team'] = {'status': 'recorded_annotation', 'reason': None,
            'prior_event_id': 1, 'penalty_team_id': 2, 'recorded_type_code': 'MIN',
            'recorded_duration_minutes': 2, 'seconds_since_recorded_penalty_event': 0,
            'availability': {'type': None, 'duration': None, 'age': None}}
    raw = b''.join(json.dumps(item, separators=(',', ':')).encode() + b'\n' for item in items)
    vector = tmp_path / 'vectors.jsonl'
    vector.write_bytes(raw)
    source = plan['source']
    source['penalty_files_sha256']['vectors.jsonl'] = hashlib.sha256(raw).hexdigest()
    if change == 'consumed_drift': source['penalty_files_sha256']['vectors.jsonl'] = '0' * 64
    folder = source['penalty_directory']
    fast_folder = str(Path(source['fast_proof']['path']).parent)
    records = {
        candidate.PLAN: plan,
        fast_folder + '/health.json': {'status': 'complete-verified-feature-reuse-proof-not-acceptance', 'publishable': False, 'report_sha256': 'a' * 64},
        candidate.SLOW + '/health.json': {'status': 'complete-verified-feature-reuse-proof-not-acceptance', 'publishable': False, 'report_sha256': 'b' * 64},
        fast_folder + '/report.json': {'mode': 'fast', 'comparison': {'fixture': True}, 'checked_sha256': {}, 'code': {}},
        candidate.SLOW + '/report.json': {'mode': 'slow', 'opposite_mode_equivalent': True, 'comparison': {'fixture': True}, 'checked_sha256': {}, 'code': {}},
        folder + '/health.json': {'status': source['penalty_expected_status'], 'publishable': False, 'files': source['penalty_files_sha256']},
        folder + '/declaration.json': {'source_and_code_sha256': {}},
        folder + '/result.json': {'checked_sha256': {}, 'eligible_rows': len(args[0]), 'ordered_event_key_sha256': expected_keys,
            'games': [{'game_id': row['game_id'], 'eligible_rows': 1} for row in args[0]]},
    }
    if change == 'equivalence': records[candidate.SLOW + '/report.json']['opposite_mode_equivalent'] = False
    if change == 'comparison': records[candidate.SLOW + '/report.json']['comparison'] = {}
    if change == 'count': records[folder + '/result.json']['eligible_rows'] += 1

    class Closure:
        def __init__(self, root): self.checked, self.inventories = {}, {}
        def pin(self, name, sha): self.checked[str(name)] = sha
        def mapping(self, values): self.checked.update(values)
        def inventory(self, name, values): self.inventories[name] = values
        def read(self, name): return records[name]
        def safe(self, name):
            assert name == folder + '/vectors.jsonl'
            return vector
        def verify(self): pass

    base = reuse.VerifiedFeatures(folds, groups, base_schema, config, 'base', 'instant', Closure(tmp_path),
                                  reuse.content_seal(folds, groups, base_schema, config))
    monkeypatch.setattr(candidate.reuse, 'Closure', Closure)
    return base


def test_complete_loader_preserves_base_and_all_cohorts(monkeypatch, tmp_path):
    base = setup(monkeypatch, tmp_path)
    before = deepcopy((base.folds, base.groups, base.schema, base.config))
    result = candidate.load(base, tmp_path)
    assert (base.folds, base.groups, base.schema, base.config) == before
    assert result.schema['names'] == base.schema['names'] + list(candidate.NAMES)
    assert result.schema['categorical_names'] == base.schema['categorical_names'] + list(candidate.CATEGORIES)
    assert result.groups == base.groups and result.cache_key != base.cache_key
    for fold, parts in base.folds.items():
        for split, part in parts.items():
            augmented = result.folds[fold][split]
            # membership_sha256 hashes complete rows, including the new features.
            assert part['membership_sha256'] != augmented['membership_sha256']
            assert part['source_sha256'] == augmented['source_sha256']
            for original, row in zip(part['rows'], augmented['rows']):
                assert row['features'][:len(base.schema['names'])] == original['features']
                assert row['features'][-4:] == [None] * 4
                assert row['label'] == original['label']
                assert {k: v for k, v in row.items() if k not in ('features', 'categorical', 'feature_sha256')} == {
                    k: v for k, v in original.items() if k not in ('features', 'categorical', 'feature_sha256')}
    result.verify()
    result.folds['fold1']['train']['rows'][0]['features'][-1] = 10
    with pytest.raises(ValueError): result.verify()
    base.verify()


@pytest.mark.parametrize('change', ['duplicate', 'missing', 'extra', 'bool', 'reorder', 'outcome',
                                   'current_prior', 'consumed_drift', 'equivalence', 'comparison', 'count'])
def test_complete_loader_fails_on_bad_population_or_certification(monkeypatch, tmp_path, change):
    base = setup(monkeypatch, tmp_path, change)
    with pytest.raises(ValueError): candidate.load(base, tmp_path)


def test_source_to_features_ignores_current_goal_future_and_team_labels():
    from test_pre_shot_penalty_context import event, penalty as source_penalty
    events = [source_penalty(), event(2, clock='01:10')]
    def feature(sequence, home=1, away=2):
        return candidate.flatten(penalty.project(sequence, home=home, away=away)[2])
    before = feature(events)
    changed = deepcopy(events)
    changed[-1]['typeCode'] = 505
    changed[-1]['details'].update(homeScore=99, awayScore=98, scoringPlayerId=999)
    assert feature(changed) == before
    assert feature(events + [source_penalty(3, clock='01:20')]) == before
    renamed = deepcopy(events)
    for item in renamed:
        item['details']['eventOwnerTeamId'] = {1: 8, 2: 7}[item['details']['eventOwnerTeamId']]
    assert feature(renamed, home=8, away=7) == before


def test_source_to_features_zero_missing_replacement_and_period_boundaries():
    from test_pre_shot_penalty_context import event, penalty as source_penalty
    events = [source_penalty(), event(2), event(3, 509, '01:05', 2),
              event(4, clock='01:10'), event(5, period=2, clock='00:05'),
              event(6, period=4, kind='SO', clock='00:00')]
    projected = penalty.project(events, home=1, away=2)
    assert candidate.flatten(projected[2])['values'][2:] == [0, 2]
    assert candidate.flatten(projected[4])['values'][2:] == [5, None]
    assert candidate.flatten(projected[4])['categorical']['recorded_penalty_opponent__annotation_state'] == 'recorded:type_missing:duration_missing'
    assert candidate.flatten(projected[5])['values'] == [None] * 4
    assert candidate.flatten(projected[6])['categorical']['recorded_penalty_opponent__annotation_state'] == 'unavailable:shootout_scope_unsupported'


def test_source_to_features_unattributed_penalty_invalidates_both_sides():
    from test_pre_shot_penalty_context import event, penalty as source_penalty
    events = [source_penalty(), source_penalty(2, clock='01:05', owner=None), event(3, clock='01:10')]
    result = candidate.flatten(penalty.project(events, home=1, away=2)[3])
    assert result['values'] == [None] * 4
    assert all(result['categorical'][f'recorded_penalty_{side}__annotation_state'] == 'unavailable:unattributed_recorded_penalty'
               for side in candidate.CHANNELS)
