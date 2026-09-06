"""Exercise the actual saver without importing/deserializing legacy models."""
import ast
from collections import defaultdict
from pathlib import Path
import json
import logging
import math
from types import SimpleNamespace

import pandas as pd
import numpy as np
import pytest


FIELDS = ('expected_rebound_probability', 'expected_goals_of_expected_rebounds',
          'created_expected_goals')


def save_payload(overrides):
    path = Path(__file__).parents[1] / 'acquisition/data_acquisition.py'
    tree = ast.parse(path.read_text())
    saver = next(n for n in tree.body if isinstance(n, ast.FunctionDef)
                 and n.name == '_save_shots_to_database')
    writes = []
    preflight = []
    namespace = {'pd': pd, 'math': math, 'logger': logging.getLogger('test'),
                 'preflight_raw_shot_replay': lambda db, rows: preflight.extend(rows)}
    exec(compile(ast.Module(body=[saver], type_ignores=[]), str(path), 'exec'), namespace)
    # Defaults supply unrelated mandatory fields without importing extraction.
    row = defaultdict(int, game_id=2025020001, playerId=7, xG_Value=0.25,
                      flurry_adjusted_xg=0.2, event_id=1, **overrides)
    frame = SimpleNamespace(empty=False, iterrows=lambda: iter([(0, row)]))

    def upsert(table, rows, on_conflict):
        assert table == 'raw_shots'
        assert on_conflict == 'game_id,player_id,shot_x,shot_y,shot_type_code'
        writes.extend(json.loads(json.dumps(rows, allow_nan=False)))

    namespace['_save_shots_to_database'](frame, SimpleNamespace(upsert=upsert), 2025020001)
    assert len(writes) == len(preflight) == 1
    assert writes[0]['xg_value'] == 0.25
    assert writes[0]['flurry_adjusted_xg'] == 0.2
    assert writes[0]['shooting_talent_adjusted_xg'] == 0.2
    return writes[0]


def test_absent_auxiliaries_are_explicit_null_not_defaults_or_base_xg():
    payload = save_payload({})
    for field in FIELDS:
        assert field in payload
        assert payload[field] is None


@pytest.mark.parametrize('value', [None, float('nan'), float('inf'), -float('inf'),
                                  True, False, np.bool_(True), pd.NA, -0.1, '0', 'invalid'])
def test_invalid_auxiliaries_reach_actual_upsert_as_null(value):
    payload = save_payload(dict.fromkeys(FIELDS, value))
    assert all(payload[field] is None for field in FIELDS)


@pytest.mark.parametrize('value', [0, 0.125, 1, np.float64(0), np.int64(0)])
def test_legitimate_values_including_zero_are_preserved(value):
    payload = save_payload(dict.fromkeys(FIELDS, value))
    assert all(payload[field] == value for field in FIELDS)


def test_probability_bounds_do_not_misclassify_additive_created_credit():
    payload = save_payload(dict.fromkeys(FIELDS, 1.2))
    assert payload['expected_rebound_probability'] is None
    assert payload['expected_goals_of_expected_rebounds'] is None
    assert payload['created_expected_goals'] == 1.2


def test_missing_replay_payload_explicitly_clears_previous_auxiliary_values():
    stored = save_payload(dict.fromkeys(FIELDS, 0.1))
    stored.update(save_payload({}))
    assert all(field in stored and stored[field] is None for field in FIELDS)
