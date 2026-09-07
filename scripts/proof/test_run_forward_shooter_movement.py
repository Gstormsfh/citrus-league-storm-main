"""Synthetic forward-stage contracts; no accuracy or real-data fit claims."""
from copy import deepcopy
import json
import numpy as np
import pytest
import run_forward_shooter_movement as runner


def feature(gid=2022020001, eid=1, day='2022-10-01', label=False):
    return {'game_id': gid, 'event_id': eid, 'game_date': day, 'label': label,
            'features': [0, 5, 5], 'categorical': {'shot_type': 'wrist'}}


def record(row):
    return {k: row[k] for k in ('game_id', 'event_id', 'game_date')} | {
        'probability': .1, 'target': int(row['label']), 'shooter_id': None, 'goalie_id': None,
        'source_event_sha256': 'a'*64, 'shooter_attribution': {}, 'goalie_attribution': {}, 'event_type': 'shot-on-goal'}


def test_join_is_keyed_order_independent_and_preserves_unknowns():
    rows = [feature(eid=1), feature(eid=2, label=True)]
    records = [record(r) for r in rows]
    before = deepcopy(records)
    assert runner.join_records(rows, records[::-1]) == records
    assert records == before and runner.join_records(rows, records)[0]['shooter_id'] is None
    updated = runner.replace_probabilities(records, rows[::-1], [.2, .3])
    assert [r['probability'] for r in updated] == [.3, .2]
    assert records == before


@pytest.mark.parametrize('change', ['bool_row', 'float_row', 'bool_record', 'float_record', 'duplicate', 'target', 'date', 'hash', 'extra', 'label_float'])
def test_join_rejects_identity_aliases_and_malformed_sources(change):
    row = feature(); old = record(row); rows, records = [row], [old]
    if change == 'bool_row': row['event_id'] = True
    if change == 'float_row': row['event_id'] = 1.
    if change == 'bool_record': old['event_id'] = True
    if change == 'float_record': old['event_id'] = 1.
    if change == 'duplicate': records.append(deepcopy(old))
    if change == 'target': old['target'] = 1
    if change == 'date': old['game_date'] = '2022-10-02'
    if change == 'hash': old['source_event_sha256'] = 'z'*64
    if change == 'extra': old['future_actor'] = 8470000
    if change == 'label_float': row['label'] = 0.
    with pytest.raises(ValueError): runner.join_records(rows, records)


@pytest.mark.parametrize('values', [[], [float('nan')], [float('inf')], [0], [1], [[.1]], [.1, .2], [True]])
def test_probability_join_rejects_malformed_vectors(values):
    row = feature()
    with pytest.raises(ValueError): runner.replace_probabilities([record(row)], [row], values)


def test_probability_join_rejects_alias_without_mutation():
    row = feature(); old = record(row); old['event_id'] = True
    with pytest.raises(ValueError): runner.replace_probabilities([old], [row], [.2])


def test_strict_four_stage_chronology():
    stages = [[feature(gid=2020020001+i, day=f'2020-10-0{i+1}')] for i in range(4)]
    assert len(runner.stage_chronology(*stages)) == 4
    stages[2][0]['game_date'] = stages[1][0]['game_date']
    with pytest.raises(ValueError): runner.stage_chronology(*stages)
    stages[2][0]['game_date'] = '2020-10-03'
    stages[3][0]['game_id'] = stages[0][0]['game_id']
    with pytest.raises(ValueError): runner.stage_chronology(*stages)


def test_guard_requires_both_losses_against_all_three_controls():
    loss = {n: {m: .1 for m in runner.METRICS} for n in runner.OUTPUTS}
    assert runner.primary_passed(loss)
    for control in runner.CONTROLS:
        for metric in runner.METRICS:
            changed = deepcopy(loss); changed[control][metric] -= 1e-12
            assert not runner.primary_passed(changed)
    loss['shooter']['brier'] = float('nan')
    assert not runner.primary_passed(loss)


def test_source_labels_cannot_enter_identity_prediction_requests():
    rows = [record(feature())]
    changed = deepcopy(rows); changed[0]['target'] = 1
    assert runner.prediction_inputs(rows) == runner.prediction_inputs(changed)
    assert 'target' not in runner.prediction_inputs(rows)[0]


def test_synthetic_identity_fit_json_and_unknown_inference():
    records = [record(feature(gid=2022020001, eid=i, day='2022-10-01', label=i%3 == 0)) for i in range(12)]
    for i, r in enumerate(records): r['shooter_id'] = 8470001 if i%2 else None
    fit_rows = runner.prediction_inputs(records)
    models = {mode: json.loads(runner.encode(runner.identity.fit(fit_rows, [r['target'] for r in records], mode=mode)))
              for mode in ('global_control', 'shooter')}
    val = [record(feature(gid=2022020002, eid=i, day='2022-10-02', label=False)) for i in range(3)]
    for r, pid in zip(val, [None, 8470001, 8479999]): r['shooter_id'] = pid
    requests = runner.prediction_inputs(val)
    for mode, model in models.items():
        assert 'goalie' not in model['effects']
        actual = runner.identity_score(model, requests)
        assert runner.identity_score(model, requests[::-1]) == actual
        for i, row in enumerate(requests):
            assert runner.identity_score(model, [row]) == [actual[i]]
        with pytest.raises(ValueError): runner.identity_score(model, [requests[0], requests[0]])
        audit = runner.audit_fit(fit_rows, [r['target'] for r in records], model, requests,
                                [r['probability'] for r in actual])
        assert audit['max_prediction_absolute_error'] <= 1e-12


def test_preflight_rejects_one_outcome_before_allocations():
    with pytest.raises(ValueError, match='Both outcomes'):
        runner.preflight({}, [{'target': 0}], [{'target': 0}, {'target': 1}], {}, {}, {})
