from copy import deepcopy
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_prequential_calibration as c


def fixture():
    cfg = {**c.prequential_calibration.SETTINGS, 'min_events': 1, 'min_games': 1}
    def row(day, game, target):
        return {'game_id': 2022020000+game, 'event_id': 1, 'game_date': f'2022-10-{day:02d}',
                'probability': .2, 'target': target}
    seed = [row(1, 1, 1), row(2, 2, 0)]
    validation = [row(4, 3, 1), row(5, 4, 0), row(6, 5, 0)]
    result = c.prequential_calibration.simulate(seed, validation, settings=cfg)
    return seed, validation, result


def test_independent_memberships_and_solver_agree():
    audit = c.audit_simulation(*fixture())
    assert audit['states'] == 3 and audit['events'] == 3
    assert audit['max_offset_error_vs_brent'] < 1e-10
    assert audit['max_probability_error'] < 1e-10


@pytest.mark.parametrize('bad', ['history_count', 'history_ids', 'history_hash', 'cutoff', 'start', 'latest',
    'state_hash', 'offset', 'objective', 'gradient', 'status', 'prediction', 'state_attachment',
    'target', 'base', 'missing_row', 'duplicate', 'missing_day', 'publishable', 'as_of'])
def test_independent_audit_rejects_detached_evidence(bad):
    seed, validation, result = fixture(); state = result['states'][0]
    if bad == 'history_count': state['history_events'] += 1
    elif bad == 'history_ids': state['history_game_ids'].pop()
    elif bad == 'history_hash': state['history_rows_sha256'] = '0'*64
    elif bad == 'cutoff': state['history_through_inclusive'] = '2022-10-04'
    elif bad == 'start': state['history_after_exclusive'] = '2022-01-01'
    elif bad == 'latest': state['latest_included_game_date'] = '2022-10-04'
    elif bad == 'state_hash': state['state_sha256'] = '0'*64
    elif bad == 'offset': state['offset'] += .1
    elif bad == 'objective': state['objective'] += .1
    elif bad == 'gradient': state['gradient'] += .1
    elif bad == 'status': state['status'] = 'upper_bound_optimum'
    elif bad == 'prediction': result['rows'][0]['adapted_probability'] = float('nan')
    elif bad == 'state_attachment': result['rows'][0]['state_sha256'] = result['states'][1]['state_sha256']
    elif bad == 'target': result['rows'][0]['target'] = 0
    elif bad == 'base': result['rows'][0]['probability'] = .3
    elif bad == 'missing_row': result['rows'].pop()
    elif bad == 'duplicate': result['rows'].append(deepcopy(result['rows'][0]))
    elif bad == 'missing_day': result['states'].pop()
    elif bad == 'publishable': result['publishable'] = True
    else: result['historical_as_of_verified'] = True
    # Even self-consistently rehashed state tampering must fail independent math.
    if bad not in ('state_hash', 'missing_day'):
        old = state['state_sha256']
        state['state_sha256'] = c.fingerprint({k:v for k,v in state.items() if k != 'state_sha256'})
        for r in result['rows']:
            if r['state_sha256'] == old: r['state_sha256'] = state['state_sha256']
    with pytest.raises(ValueError): c.audit_simulation(seed, validation, result)


def test_sparse_state_independently_verified():
    seed, validation, _ = fixture()
    result = c.prequential_calibration.simulate(seed, validation)
    assert c.audit_simulation(seed, validation, result)['max_offset_error_vs_brent'] == 0


def test_fixed_plan_and_future_declaration_rejected():
    plan = c.strict_json((c.ROOT/c.PLAN).read_bytes())
    c.validate_plan(plan, '2026-09-06T23:00:00+00:00')
    with pytest.raises(ValueError): c.validate_plan(plan, '2026-09-05T23:00:00+00:00')
    plan['settings']['history_days'] = 30
    with pytest.raises(ValueError): c.validate_plan(plan, '2026-09-06T23:00:00+00:00')


def test_monthly_accounting_conserves_events_goals_expected():
    _, _, result = fixture(); report = c.monthly_scores(result['rows'])
    assert sum(r['events'] for r in report) == 3
    assert sum(r['goals'] for r in report) == 1
    assert sum(r['models'][c.BASELINE]['expected_goals'] for r in report) == pytest.approx(.6)


def vectors():
    rows = [{'game_id': 2022020001, 'event_id': 1, 'label': True}]
    previous = {(2022020001, 1): {'target': 1, 'predictions': {'raw': .1}, 'groups': {'strength': '5v5'}}}
    selected = {(2022020001, 1): {'target': 1, 'predictions': {c.SELECTED: .2}, 'groups': {'strength': '5v5'}}}
    return rows, [.1], [.2], [{}], previous, selected, 'validation'


def test_exact_reference_vectors():
    result = c.verify_vectors(*vectors())
    assert result['raw_max_abs_error'] == result['calibrated_max_abs_error'] == 0


@pytest.mark.parametrize('bad', ['duplicate', 'missing', 'raw', 'calibrated', 'target', 'groups', 'nan', 'bool', 'unknown_split'])
def test_vector_drift_and_invalid_reference_fail(bad):
    rows, raw, calibrated, contexts, previous, selected, split = vectors()
    if bad == 'duplicate': rows.append(deepcopy(rows[0]))
    elif bad == 'missing': previous.clear()
    elif bad == 'raw': raw[0] += .1
    elif bad == 'calibrated': calibrated[0] += .1
    elif bad == 'target': rows[0]['label'] = False
    elif bad == 'groups': selected[2022020001, 1]['groups'] = {}
    elif bad == 'nan': previous[2022020001, 1]['predictions']['raw'] = float('nan')
    elif bad == 'bool': selected[2022020001, 1]['predictions'][c.SELECTED] = True
    else: split = 'test'
    with pytest.raises(ValueError): c.verify_vectors(rows, raw, calibrated, contexts, previous, selected, split)


def test_output_scope_fails_before_any_sources(tmp_path):
    target = tmp_path/'not_scoped'
    with pytest.raises(ValueError): c.run(target)
    assert not target.exists()
