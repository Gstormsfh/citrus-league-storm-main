from copy import deepcopy
import pytest
import run_timing_shape as s


def rows():
    return [{'game_id': 2022020001+i, 'event_id': 1, 'target': int(i%4 == 0),
             'neutral_xg': .02+(i%5)*.1, 'game_date': '2022-10-10', 'population': 'original',
             'band': 'same_clock'} for i in range(50)]


def test_fit_is_converged_and_monotone():
    b = s.fit_band(rows()); assert b['projected_gradient'] < 1e-5
    assert -.75 <= b['slope_delta'] <= 3
    f = {'month': '2022-11', 'bands': {'same_clock': b}}
    a = {**rows()[0], 'game_date': '2022-11-01'}
    assert s.apply({**a, 'neutral_xg': .1}, f) < s.apply({**a, 'neutral_xg': .8}, f)


def test_sparse_and_non_timing_identity():
    b = s.fit_band(rows()[:29]); f = {'month': '2022-10', 'bands': {'same_clock': b}}
    r = {**rows()[0], 'neutral_xg': .9}
    assert s.apply(r, f) == .9
    assert s.apply({**r, 'band': None}, f) == .9


def test_no_current_future_or_recovered_training():
    r = rows(); fit = s.fit_month(r, '2022-11'); extra = deepcopy(r)
    for x in extra: x['game_id'] += 100; x['game_date'] = '2022-11-01'; x['target'] = 1
    assert fit == s.fit_month(r+extra, '2022-11')
    for x in extra: x['game_date'] = '2022-10-01'; x['population'] = 'recovered'
    assert fit == s.fit_month(r+extra, '2022-11')


def test_bad_input_and_month_rejected():
    r = rows()
    with pytest.raises(ValueError): s.fit_band(r+[r[0]])
    r[0]['neutral_xg'] = float('nan')
    with pytest.raises(ValueError): s.fit_band(r)
    with pytest.raises(ValueError): s.apply(rows()[0], {'month': '2022-11', 'bands': {}})
