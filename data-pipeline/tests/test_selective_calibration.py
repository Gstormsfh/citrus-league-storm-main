from copy import deepcopy
import math

import pytest
from projections import selective_calibration as c


def cfg(**changes):
    return {**c.SETTINGS, 'min_events': 2, 'min_games': 2, **changes}


def rows(n=20, y=0, p=.2, day=1, game_offset=0):
    return [{'game_id':2022020001+i+game_offset,'event_id':1,'game_date':f'2022-10-{day:02d}',
             'probability':p,'target':y} for i in range(n)]


def test_small_signal_is_exact_zero():
    result = c.fit(rows(10), cfg())
    assert result['status'] == 'zero_selected_by_penalty'
    assert result['offset'] == 0 and result['kkt_violation'] == 0
    assert abs(result['gradient_at_zero']) <= result['penalty']


def test_variance_floor_prevents_false_certainty_from_identical_games():
    result = c.fit(rows(20), cfg())
    assert result['cluster_variance'] < 1e-20
    assert result['bernoulli_variance_floor'] == pytest.approx(3.2)
    assert result['penalty'] == pytest.approx(2*math.sqrt(3.2))


def test_large_signal_moves_but_less_than_unpenalized_intercept():
    rr = rows(100)
    result = c.fit(rr, cfg())
    previous = c.prior.fit_offset([r['probability'] for r in rr], [r['target'] for r in rr], c.base_settings(cfg()))
    assert previous['offset'] < result['offset'] < 0
    assert result['status'] == 'interior_optimum' and result['kkt_violation'] < 1e-10


@pytest.mark.parametrize('y,sign', [(0,-1),(1,1)])
def test_bounded_one_class_optimum_has_valid_kkt(y, sign):
    result = c.fit(rows(1000, y=y), cfg(ridge=.01))
    assert result['offset'] == sign*c.SETTINGS['max_abs_offset']
    assert result['kkt_violation'] == 0 and math.isfinite(result['objective'])


def test_game_variation_can_exceed_bernoulli_floor():
    rr = rows(100, y=0, p=.5)+rows(100, y=1, p=.5, game_offset=100)
    for r in rr[:100]: r['game_id']=2022020001
    for r in rr[100:]: r['game_id']=2022020002
    for i,r in enumerate(rr): r['event_id']=i
    result = c.fit(rr, cfg())
    assert result['cluster_variance'] > result['bernoulli_variance_floor']
    assert result['offset'] == 0


def test_sparse_history_preserves_baseline_without_numeric_zero_claim():
    result = c.simulate([], rows(2, day=4), settings=cfg())
    assert all(r['adapted_probability']==r['probability'] for r in result['rows'])
    assert result['states'][0]['penalty'] is None


def test_future_label_changes_cannot_change_earlier_predictions():
    seed = rows(100); validation = rows(2, day=4, game_offset=100)+rows(2, day=7, game_offset=102)
    before = c.simulate(seed, validation, settings=cfg())
    altered = deepcopy(validation)
    for r in altered: r['target']=1
    after = c.simulate(seed, altered, settings=cfg())
    assert before['states'][0] == after['states'][0]
    assert [r['adapted_probability'] for r in before['rows'][:2]] == [r['adapted_probability'] for r in after['rows'][:2]]


def test_exact_lag_and_window_and_order_invariance():
    seed = rows(2, day=1)+rows(2, day=2, game_offset=2)+rows(2, day=6, game_offset=4)+rows(2, day=7, game_offset=6)
    validation = rows(2, day=8, game_offset=8)
    settings = cfg(history_days=5); a = c.simulate(seed, validation, settings=settings)
    assert a == c.simulate(seed[::-1], validation[::-1], settings=settings)
    assert a['states'][0]['history_game_ids'] == [2022020003,2022020004,2022020005,2022020006]


@pytest.mark.parametrize('change', ['overlap','same_game','late_seed','nan','boolean_target','date','extra','resource'])
def test_invalid_cohort_rejected(change):
    seed=rows(2); validation=rows(2,day=4,game_offset=2); settings=cfg()
    if change=='overlap':validation.append(deepcopy(seed[0]))
    elif change=='same_game':validation[0]['game_id']=seed[0]['game_id']
    elif change=='late_seed':seed[0]['game_date']='2022-10-05'
    elif change=='nan':validation[0]['probability']=float('nan')
    elif change=='boolean_target':validation[0]['target']=False
    elif change=='date':validation[0]['game_date']='20220101'
    elif change=='extra':validation[0]['later_outcome']=0
    else:settings['max_rows']=2
    with pytest.raises(ValueError):c.simulate(seed,validation,settings=settings)


@pytest.mark.parametrize('factor',[0,-1,True,float('nan'),float('inf'),'2'])
def test_invalid_penalty_rejected(factor):
    with pytest.raises(ValueError):c.fit(rows(),cfg(cluster_penalty_multiplier=factor))


def test_one_game_uncertainty_configuration_rejected():
    with pytest.raises(ValueError):c.fit(rows(),cfg(min_games=1))
