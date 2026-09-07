from copy import deepcopy
import pytest
from run_zone_context_candidate import NAMES, ZONE_CATEGORY, augment, primary_passed, project


def event(eid, time, y, code=506, owner=1):
    return {'eventId': eid, 'sortOrder': eid, 'timeInPeriod': time,
            'periodDescriptor': {'number': 1, 'periodType': 'REG'},
            'homeTeamDefendingSide': 'left', 'typeCode': code,
            'details': {'eventOwnerTeamId': owner, 'xCoord': 75, 'yCoord': y}}


def test_zone_append_keeps_original_movement_and_causal_context():
    from run_movement_candidate import project as previous
    events = [event(1, '00:10', -10), event(2, '00:12', 10)]
    out = project(events, home=1, away=2)
    assert len(NAMES) == len(set(NAMES)) == 30
    assert out[2]['values'][:24] == previous(events, home=1, away=2)[2]
    assert out[2]['categorical'][ZONE_CATEGORY] is not None
    changed = [events[0], {**events[1], 'typeCode': 505}, event(3, '00:14', -4)]
    assert project(changed, home=1, away=2)[2] == out[2]


def test_outside_three_seconds_zone_missing_but_movement_preserved():
    out = project([event(1, '00:10', -10), event(2, '00:14', 10)], home=1, away=2)[2]
    assert out['values'][-6:] == [None] * 6
    assert out['categorical'][ZONE_CATEGORY] is None
    assert out['values'][12] == 4


def test_augment_preserves_actuals_and_numeric_categorical_originals():
    rows = [{'game_id': 1, 'event_id': 2, 'features': [4.], 'categorical': {'type': 'wrist'}, 'label': True}]
    before = deepcopy(rows)
    extra = {(1, 2): {'values': [None] * 30, 'categorical': {ZONE_CATEGORY: 'crease'}}}
    out = augment(rows, extra, {'version': 'test'})
    assert rows == before
    assert out[0]['features'] == [4.] + [None] * 30
    assert out[0]['categorical'] == {'type': 'wrist', ZONE_CATEGORY: 'crease'}
    assert out[0]['label'] is True


@pytest.mark.parametrize('values', [[None] * 29, [True] + [None] * 29, [float('inf')] + [None] * 29])
def test_bad_vector_rejected(values):
    with pytest.raises(ValueError):
        augment([{'game_id': 1, 'event_id': 2}], {(1, 2): {'values': values, 'categorical': {ZONE_CATEGORY: None}}}, {})


def test_guard_requires_both_metrics_against_both_controls():
    baseline = {'brier': .06, 'log_loss_clipped': .22}
    losses = {name: dict(baseline) for name in ('zone_monotone_group', 'frozen_monotone_group', 'frozen_movement_monotone_group')}
    assert primary_passed(losses)
    for control in ('frozen_monotone_group', 'frozen_movement_monotone_group'):
        for metric in baseline:
            changed = deepcopy(losses)
            changed[control][metric] -= .0001
            assert not primary_passed(changed)
