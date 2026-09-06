from copy import deepcopy
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_actor_attribution as c


def fixture():
    rows = [{'game_id': 2022020001, 'event_id': 1, 'label': True}]
    raw, calibrated, contexts = [.1], [.2], [{'strength': '5v5'}]
    previous = {(2022020001, 1): {'target': 1, 'predictions': {c.SELECTED: .2}}}
    inputs = {(2022020001, 1): {'raw_probability': .1, 'context': {'strength': '5v5'}}}
    return rows, raw, calibrated, contexts, previous, inputs


def test_full_inference_equality():
    result = c.verify_inference(*fixture())
    assert result['raw_max_abs_error'] == result['calibrated_max_abs_error'] == 0
    assert result['contexts_and_labels_exact'] is True and result['rows'] == 1


@pytest.mark.parametrize('bad', ['raw', 'calibrated', 'missing', 'duplicate', 'wrong_identity', 'context', 'target'])
def test_incomplete_or_detached_inference_rejected(bad):
    rows, raw, calibrated, contexts, previous, inputs = fixture()
    if bad == 'raw': raw[0] += .001
    elif bad == 'calibrated': calibrated[0] += .001
    elif bad == 'missing': raw.clear()
    elif bad == 'duplicate': rows.append(deepcopy(rows[0]))
    elif bad == 'wrong_identity': rows[0]['event_id'] = 2
    elif bad == 'context': contexts[0]['strength'] = '3v3'
    else: rows[0]['label'] = False
    with pytest.raises(ValueError): c.verify_inference(rows, raw, calibrated, contexts, previous, inputs)


@pytest.mark.parametrize('bad', [float('nan'), float('inf'), -.1, 1.1, True, '.1'])
@pytest.mark.parametrize('side', ['fresh', 'retained'])
def test_nonprobabilities_never_hide_in_max_error(bad, side):
    rows, raw, calibrated, contexts, previous, inputs = fixture()
    if side == 'fresh': raw[0] = bad
    else: inputs[2022020001, 1]['raw_probability'] = bad
    with pytest.raises(ValueError): c.verify_inference(rows, raw, calibrated, contexts, previous, inputs)


def test_runner_refuses_unscoped_output_before_reading_sources(tmp_path):
    target = tmp_path / 'unscoped'
    with pytest.raises(ValueError): c.run(target)
    assert not target.exists()
