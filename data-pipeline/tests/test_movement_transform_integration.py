"""Real selector -> pair arithmetic -> fixed JSON transform integration.

Synthetic earlier training events only; no model fit or production operations.
"""
from copy import deepcopy
import json

from projections.fixed_feature_transform import fit, transform
from projections.pre_shot_history import project
from projections.pre_shot_movement import NAMES


def event(eid, *, code=506, point=(70, 10), owner=1):
    details = {'eventOwnerTeamId': owner}
    if point is not None:
        details.update(xCoord=point[0], yCoord=point[1])
    return {'eventId': eid, 'sortOrder': eid, 'typeCode': code,
            'timeInPeriod': f'00:{eid:02d}', 'homeTeamDefendingSide': 'left',
            'periodDescriptor': {'number': 1, 'periodType': 'REG'}, 'details': details}


def rows(events):
    output = project(events, home=1, away=2)
    return {eid: {**pair['values'], 'owner_relation': pair['prior_owner_relation']}
            for eid, record in output.items()
            for pair in [record['immediate_recorded_live_event']]}


def contract():
    # Separate synthetic historical game, fitted once before any evaluated rows.
    training = rows([event(1, point=(65, -15)), event(2, point=(75, 20)),
                     event(3, point=(80, 5))])
    return fit(list(training.values()), numeric=list(NAMES), categorical=['owner_relation'])


def test_real_history_movement_vectors_are_batch_order_and_json_invariant():
    fitted = contract()
    originals = deepcopy(fitted)
    evaluated = rows([event(1), event(2, point=None), event(3, owner=2), event(4)])
    original_rows = deepcopy(evaluated)
    ordered = list(evaluated.values())
    batch = transform(fitted, ordered)
    assert batch == [transform(fitted, [row])[0] for row in ordered]
    assert transform(fitted, list(reversed(ordered))) == list(reversed(batch))
    assert transform(json.loads(json.dumps(fitted)), ordered) == batch
    assert fitted == originals
    assert evaluated == original_rows


def test_current_goal_future_and_unrelated_extremes_cannot_change_vector():
    fitted = contract()
    events = [event(1, point=(60, -20)), event(2, point=(80, 20))]
    base = transform(fitted, [rows(events)[2]])[0]
    goal = deepcopy(events)
    goal[1]['typeCode'] = 505
    assert transform(fitted, [rows(goal)[2]])[0] == base
    future = events + [event(3, owner=2, point=(-100, -42.5))]
    assert transform(fitted, [rows(future)[2]])[0] == base
    unrelated = rows([event(1, point=(-100, -42.5)), event(2, point=(100, 42.5))])[2]
    assert transform(fitted, [unrelated, rows(events)[2]])[1] == base
