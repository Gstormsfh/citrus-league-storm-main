from copy import deepcopy
import pytest
from run_movement_candidate import CONTEXTS, NAMES, augment, flatten, primary_passed
from projections.pre_shot_movement import NAMES as MEASUREMENTS


def record():
    return {context: {'values': {name: None for name in MEASUREMENTS},
                      'prior_owner_relation': None} for context in CONTEXTS}


def test_flatten_exact_order_and_nullable_relation():
    row = record()
    row[CONTEXTS[0]]['values'] = dict(zip(MEASUREMENTS, range(11)))
    row[CONTEXTS[0]]['prior_owner_relation'] = 'opponent'
    assert len(NAMES) == len(set(NAMES)) == 24
    assert flatten(row) == list(range(11)) + [0] + [None] * 12
    row[CONTEXTS[1]]['prior_owner_relation'] = 'same_team'
    assert flatten(row)[-1] == 1


def test_augment_preserves_originals_and_outcomes():
    original = [{'game_id': 1, 'event_id': 2, 'features': [4.], 'categorical': ['wrist'], 'label': True}]
    before = deepcopy(original)
    out = augment(original, {(1, 2): [None] * 24}, {'version': 'test', 'names': ['x', *NAMES]})
    assert original == before
    assert out[0]['features'] == [4.] + [None] * 24
    assert out[0]['label'] is True
    assert out[0]['categorical'] == ['wrist']


@pytest.mark.parametrize('values', [[None] * 23, [True] + [None] * 23, [float('nan')] + [None] * 23])
def test_augment_rejects_bad_vector(values):
    with pytest.raises(ValueError):
        augment([{'game_id': 1, 'event_id': 2}], {(1, 2): values}, {})


def test_guard_requires_both_losses():
    baseline = {'brier': .06, 'log_loss_clipped': .22}
    assert primary_passed({'frozen_monotone_group': baseline, 'movement_monotone_group': baseline})
    for metric in baseline:
        worse = {**baseline, metric: baseline[metric] + .0001}
        assert not primary_passed({'frozen_monotone_group': baseline, 'movement_monotone_group': worse})


def test_flatten_rejects_ambiguous_relation():
    row = record()
    row[CONTEXTS[0]]['prior_owner_relation'] = 'unknown'
    with pytest.raises(ValueError):
        flatten(row)
