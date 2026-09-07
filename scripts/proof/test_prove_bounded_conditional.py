"""Proof runner contracts; synthetic rows only, never cohort fitting."""
from copy import deepcopy
import hashlib
import json

import numpy as np
import pytest
import prove_bounded_conditional as r


@pytest.fixture(scope='module')
def model():
    health_body = (r.ROOT/r.SOURCE/'health.json').read_bytes()
    assert hashlib.sha256(health_body).hexdigest() == r.HEALTH_SHA
    body = (r.ROOT/r.SOURCE/r.MODEL).read_bytes()
    assert hashlib.sha256(body).hexdigest() == json.loads(health_body)['files'][r.MODEL]
    return json.loads(body)


def rows(n=12):
    return [{'game_id': 2022020001, 'event_id': i, 'game_date': '2022-10-01',
             'target': i%2, 'raw_probability': .1+i/(n*2),
             'context': {'shot_type': 'wrist', 'strength': '5v5', 'prior_sog_same_team': [None, '0', '1'][i%3]}}
            for i in range(n)]


@pytest.mark.parametrize('a,b', [([.1], [.1,.2]), ([float('nan')], [.1]), ([True],[1]), ([[.1]],[.1]), ([1.1],[1.2])])
def test_parity_rejects_shape_nonfinite_bool_or_excess_error(a,b):
    with pytest.raises(ValueError): r.error(a,b)


@pytest.mark.parametrize('change', ['duplicate','boolean_key','float_target','nan','extra','reversed'])
def test_inputs_fail_closed(change):
    data = rows()
    if change == 'duplicate': data.append(deepcopy(data[0]))
    if change == 'boolean_key': data[0]['event_id'] = False
    if change == 'float_target': data[0]['target'] = 0.
    if change == 'nan': data[0]['raw_probability'] = float('nan')
    if change == 'extra': data[0]['future_outcome'] = 0
    if change == 'reversed': data.reverse()
    with pytest.raises(ValueError): r.validate_inputs(data)


def test_small_synthetic_numerical_parity_without_any_fit(model, monkeypatch):
    monkeypatch.setattr(r.bounded, 'fit', lambda *a, **k: pytest.fail('fit prohibited'))
    monkeypatch.setattr(r.dense, 'fit', lambda *a, **k: pytest.fail('fit prohibited'))
    data = rows(); before = deepcopy((model,data))
    result = r.real_parity(model,data)
    assert result['source_rows'] == 12 and not result['model_fitted']
    assert result['full_prediction_max_abs_error'] <= r.ATOL
    assert (model,data) == before


def source_tree(tmp_path, model, monkeypatch):
    monkeypatch.setattr(r, 'SOURCE', 'source')
    folder = tmp_path/'source'
    for name,value in [(r.MODEL,model),(r.INPUTS,rows())]:
        path = folder/name; path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(r.encode(value))
    files = {n: hashlib.sha256((folder/n).read_bytes()).hexdigest() for n in (r.MODEL,r.INPUTS)}
    health = {'status': 'complete-calibration-stability-development-not-accepted', 'publishable': False,'files':files}
    body=r.encode(health);(folder/'health.json').write_bytes(body)
    monkeypatch.setattr(r,'HEALTH_SHA',hashlib.sha256(body).hexdigest())
    return folder


@pytest.mark.parametrize('change', ['none','bytes','extra','missing','symlink'])
def test_real_filesystem_source_pins_and_inventory(tmp_path,model,monkeypatch,change):
    folder=source_tree(tmp_path,model,monkeypatch)
    if change=='bytes': (folder/r.INPUTS).write_bytes(b'[]')
    if change=='extra': (folder/'extra.json').write_bytes(b'{}')
    if change=='missing': (folder/r.INPUTS).unlink()
    if change=='symlink': (folder/'link').symlink_to(folder/r.MODEL)
    closure=r.Closure(tmp_path)
    if change=='none':
        actual,data=r.source(closure)
        assert actual==model and len(data)==12
        closure.verify()
        (folder/r.MODEL).write_bytes(b'{}')
        with pytest.raises(ValueError): closure.verify()
    else:
        with pytest.raises(ValueError): r.source(closure)


def test_existing_output_does_not_receive_failure_receipt(tmp_path,monkeypatch):
    monkeypatch.setattr(r,'ROOT',tmp_path)
    output=tmp_path/'scripts/proof/results/bounded-conditional-proof-existing'
    output.mkdir(parents=True)
    (output/'owned.txt').write_text('preserve')
    with pytest.raises(FileExistsError): r.run(output)
    assert (output/'owned.txt').read_text()=='preserve'
    assert not (output/'failure.json').exists()


def test_synthetic_stress_population_is_fixed(model):
    with pytest.raises(ValueError): r.synthetic_stress(model,n=10)
