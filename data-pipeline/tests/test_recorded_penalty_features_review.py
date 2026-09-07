"""Independent annotation validation and additive-row immutability contracts."""
from copy import deepcopy
import json
from pathlib import Path

import pytest
from projections import recorded_penalty_features as m
from projections import pre_shot_penalty_context as source
from projections.analytics_publication import fingerprint


def annotation():
    return dict(version=source.VERSION, scope=source.SCOPE, publishable=False,
                same_team=source._emit(dict(id=1, owner=9, type='MIN', duration=2, time=0), None, 301),
                opponent=source._empty('no_recorded_penalty_in_current_period'))


def test_annotation_values_units_missingness_and_no_mutation():
    value = annotation()
    before = deepcopy(value)
    result = m.flatten(value)
    assert result['values'] == [301, 2, None, None]
    assert result['categorical']['recorded_penalty_same_team__type'] == 'MIN'
    assert result['categorical']['recorded_penalty_same_team__annotation_state'] == 'recorded:type_known:duration_known'
    assert result['categorical']['recorded_penalty_opponent__annotation_state'] == 'unavailable:no_recorded_penalty_in_current_period'
    assert value == before
    # Age exceeding recorded duration is valid historical annotation, not countdown.
    assert result['values'][0] > 60 * result['values'][1]


def test_observed_zero_not_missing_or_no_annotation():
    value = annotation()
    channel = value['same_team']
    channel['seconds_since_recorded_penalty_event'] = 0
    channel['recorded_duration_minutes'] = 0
    channel['recorded_type_code'] = 'PS'
    result = m.flatten(value)
    assert result['values'][:2] == [0, 0]
    assert result['categorical']['recorded_penalty_same_team__type'] == 'PS'


@pytest.mark.parametrize('missing_type,missing_duration', [(True, False), (False, True), (True, True)])
def test_recorded_missing_fields_remain_distinct(missing_type, missing_duration):
    value = annotation()
    channel = value['same_team']
    if missing_type:
        channel['recorded_type_code'] = None
        channel['availability']['type'] = 'missing_or_unknown_recorded_type'
    if missing_duration:
        channel['recorded_duration_minutes'] = None
        channel['availability']['duration'] = 'missing_or_invalid_recorded_duration'
    result = m.flatten(value)
    state = f"recorded:type_{'missing' if missing_type else 'known'}:duration_{'missing' if missing_duration else 'known'}"
    assert result['categorical']['recorded_penalty_same_team__annotation_state'] == state
    assert result['values'][0] == 301


@pytest.mark.parametrize('field,bad', [('seconds_since_recorded_penalty_event', -1),
    ('seconds_since_recorded_penalty_event', 1201), ('seconds_since_recorded_penalty_event', True),
    ('seconds_since_recorded_penalty_event', float('nan')), ('recorded_duration_minutes', 61),
    ('recorded_duration_minutes', 10 ** 1000), ('recorded_duration_minutes', False),
    ('recorded_type_code', 'OTHER'), ('prior_event_id', True), ('penalty_team_id', -1)])
def test_malformed_recorded_channel_rejected(field, bad):
    value = annotation()
    value['same_team'][field] = bad
    with pytest.raises(ValueError):
        m.flatten(value)


def test_contradictory_availability_and_hidden_extra_field_rejected():
    value = annotation()
    value['same_team']['availability']['type'] = 'missing_or_unknown_recorded_type'
    with pytest.raises(ValueError):
        m.flatten(value)
    value = annotation()
    value['same_team']['scoringPlayerId'] = 100
    with pytest.raises(ValueError):
        m.flatten(value)


@pytest.mark.parametrize('field,bad', [('status', 'unknown'), ('reason', 'invented_reason'),
                                     ('recorded_duration_minutes', 0), ('prior_event_id', 0)])
def test_unavailable_channel_does_not_admit_values(field, bad):
    value = annotation()
    value['opponent'][field] = bad
    with pytest.raises(ValueError):
        m.flatten(value)


def row_fixture():
    root = Path(__file__).resolve().parents[2]
    plan = json.loads((root / 'docs/analytics-recorded-penalty-candidate-plan-20260906.json').read_text())
    base = deepcopy(plan['features']['base_schema'])
    schema = deepcopy(base)
    schema['version'] = plan['features']['candidate_schema_version']
    schema['names'] += list(m.NAMES)
    schema['categorical_names'] += list(m.CATEGORIES)
    row = dict(split='train', game_id=2019020001, event_id=10, game_date='2019-10-02', label=0,
               features=[None] * len(base['names']), categorical={n: None for n in base['categorical_names']},
               source_sha256='a' * 64)
    row['feature_sha256'] = fingerprint(dict(schema_sha256=fingerprint(base), values=row['features'], categorical=row['categorical']))
    extra = {(row['game_id'], row['event_id']): m.flatten(annotation())}
    return row, extra, schema, base


def test_augmentation_preserves_originals_and_deep_isolation():
    row, extra, schema, base = row_fixture()
    before = deepcopy((row, extra, schema, base))
    result = m.augment_rows([row], extra, schema, base)[0]
    assert result['features'][:len(base['names'])] == row['features']
    assert result['features'][len(base['names']):] == [301, 2, None, None]
    assert result['source_sha256'] == row['source_sha256']
    assert result['label'] == row['label']
    assert result['feature_sha256'] != row['feature_sha256']
    result['features'][0] = 123
    result['categorical']['shot_type'] = 'mutated'
    assert (row, extra, schema, base) == before


def test_changed_original_hash_and_wrong_append_width_rejected():
    row, extra, schema, base = row_fixture()
    row['features'][0] = 1
    with pytest.raises(ValueError):
        m.augment_rows([row], extra, schema, base)
    row, extra, schema, base = row_fixture()
    next(iter(extra.values()))['values'].append(999)
    with pytest.raises(ValueError):
        m.augment_rows([row], extra, schema, base)


@pytest.mark.parametrize('bad', [True, -1, 1201])
def test_flattened_augmentation_age_must_retain_declared_type_and_bounds(bad):
    row, extra, schema, base = row_fixture()
    next(iter(extra.values()))['values'][0] = bad
    with pytest.raises(ValueError):
        m.augment_rows([row], extra, schema, base)


def test_flattened_augmentation_cannot_admit_undeclared_category():
    row, extra, schema, base = row_fixture()
    next(iter(extra.values()))['categorical']['recorded_penalty_same_team__type'] = 'FAKE'
    with pytest.raises(ValueError):
        m.augment_rows([row], extra, schema, base)


def test_both_channels_cannot_name_same_team():
    value = annotation()
    value['opponent'] = deepcopy(value['same_team'])
    with pytest.raises(ValueError):
        m.flatten(value)
