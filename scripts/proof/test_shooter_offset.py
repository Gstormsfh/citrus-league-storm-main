from copy import deepcopy
import pytest
import run_shooter_offset as s


def rows():
    return [{'game_id': 2022020001+i, 'event_id': 1, 'player_id': 8470001, 'game_type': 'regular',
             'is_goal': i < 4, 'neutral_xg': .1, 'game_date': '2022-10-10', 'population': 'original'} for i in range(10)]


def test_fit_shrinks_and_converges():
    f = s.fit_player(rows())
    assert 0 < f['offset'] < s.logit(.4)-s.logit(.1)
    assert abs(f['gradient']) < 1e-10
    assert f == s.fit_player(rows()[::-1])


def test_empty_history_exact_identity_even_above_legacy_cap():
    fit = s.fit_month(rows(), '2022-10'); r = rows()[0]; r['neutral_xg'] = .8
    assert s.apply(r, fit) == (.8, 0)


def test_current_future_and_recovered_labels_cannot_change_fit():
    r = rows(); f = s.fit_month(r, '2022-11')
    extra = deepcopy(r)
    for x in extra: x['game_id'] += 100; x['game_date'] = '2022-11-01'; x['is_goal'] = True
    recovered = deepcopy(extra)
    for x in recovered: x['game_id'] += 100; x['game_date'] = '2022-10-01'; x['population'] = 'recovered'
    assert s.fit_month(r+extra+recovered, '2022-11') == f


def test_team_changes_share_history_but_playoffs_do_not():
    r = rows(); r[0]['team_id'] = 1; r[1]['team_id'] = 2
    fit = s.fit_month(r, '2022-11'); test = {**r[0], 'game_id': 2022020999, 'game_date': '2022-11-01'}
    assert s.apply(test, fit)[1] == 10
    test['game_type'] = 'playoff'
    assert s.apply(test, fit) == (.1, 0)


def test_overlap_and_wrong_month_rejected():
    r = rows(); f = s.fit_month(r, '2022-11')
    with pytest.raises(ValueError): s.apply(r[0], f)
    r[0]['game_date'] = '2022-11-01'
    with pytest.raises(ValueError): s.apply(r[0], f)


def test_duplicates_mixed_player_and_nonfinite_rejected():
    r = rows()
    with pytest.raises(ValueError): s.fit_player(r+[r[0]])
    r[0]['player_id'] += 1
    with pytest.raises(ValueError): s.fit_player(r)
    r = rows(); r[0]['neutral_xg'] = float('nan')
    with pytest.raises(ValueError): s.fit_player(r)
