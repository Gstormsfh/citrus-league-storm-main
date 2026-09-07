from copy import deepcopy
import math

import numpy as np
import pytest
from scipy.optimize import brentq
from scipy.special import expit

from projections import identity_probability as m
from projections.analytics_publication import fingerprint


def sample(n=80, later=False):
    return [{'game_id': 2022020001 if later else 2021020001, 'event_id': i,
             'game_date': '2022-10-01' if later else '2021-10-01', 'probability': .1,
             'shooter_id': 8470001 + i % 2, 'goalie_id': 8480001 + i // 2 % 2} for i in range(n)]


def targets(n=80):
    return [int(i % 7 == 0) for i in range(n)]


def rehash(model):
    model['model_sha256'] = fingerprint({k:v for k,v in model.items() if k != 'model_sha256'})
    return model


@pytest.mark.parametrize('mode', m.MODES)
def test_fit_and_predict_are_bounded_deterministic_and_preserve_inputs(mode):
    rows, yy = sample(), targets(); before = deepcopy((rows, yy))
    fitted = m.fit(rows, yy, mode=mode)
    assert fitted == m.fit(rows, yy, mode=mode)
    assert (rows, yy) == before
    assert fitted['publishable'] is False
    pp = m.predict(fitted, sample(later=True))
    assert len(pp) == 80 and all(0 < p < 1 for p in pp)
    assert fitted['optimizer']['max_projected_gradient'] <= m.SETTINGS['gradient_tolerance']


def test_global_control_matches_independent_scalar_root():
    fitted = m.fit(sample(), targets(), mode='global_control')
    root = brentq(lambda a: 80 * expit(math.log(.1/.9) + a) - sum(targets()) + 100*a, -1.5, 1.5)
    assert fitted['intercept'] == pytest.approx(root, abs=1e-7)
    assert fitted['effects'] == {}


def test_analytic_gradient_matches_finite_difference():
    rows = sample(20); _, ix, ridge = m._design(rows, 'joint')
    logits = np.repeat(math.log(.1/.9), len(rows)); yy = np.array(targets(len(rows)))
    coef = np.linspace(-.1, .15, len(ridge)); args = (logits, yy, ix, ridge)
    _, gradient = m.objective_gradient(coef, *args)
    for i in range(len(coef)):
        plus = coef.copy(); minus = coef.copy(); plus[i] += 1e-6; minus[i] -= 1e-6
        numerical = (m.objective_gradient(plus, *args)[0] - m.objective_gradient(minus, *args)[0]) / 2e-6
        assert gradient[i] == pytest.approx(numerical, abs=1e-7)


def test_unknown_and_missing_actors_receive_exact_same_zero_identity_effect():
    fitted = m.fit(sample(), targets(), mode='joint')
    rows = sample(2, later=True)
    rows[0].update(shooter_id=None, goalie_id=None)
    rows[1].update(shooter_id=8499998, goalie_id=8499999)
    pp = m.predict(fitted, rows)
    assert pp[0] == pp[1]
    assert pp[0] == pytest.approx(expit(math.log(.1/.9) + fitted['intercept']), abs=1e-15)


def test_missing_fit_actors_do_not_create_a_null_category():
    rows = sample(); rows = [{**r, 'shooter_id': None, 'goalie_id': None} for r in rows]
    fitted = m.fit(rows, targets(), mode='joint')
    assert fitted['effects'] == {'shooter': [], 'goalie': []}


def test_shooter_only_never_uses_goalie_identity():
    fitted = m.fit(sample(), targets(), mode='shooter')
    rr = sample(later=True)
    assert m.predict(fitted, rr) == m.predict(fitted, [{**r, 'goalie_id': None} for r in rr])


def test_same_player_id_is_separate_in_the_two_roles():
    rr = [{**r, 'goalie_id': r['shooter_id']} for r in sample()]
    fitted = m.fit(rr, targets(), mode='joint')
    assert [r['player_id'] for r in fitted['effects']['shooter']] == [r['player_id'] for r in fitted['effects']['goalie']]
    # Different declared regularization, separate coefficients despite matching IDs.
    assert fitted['effects']['shooter'][0]['logit_effect'] != fitted['effects']['goalie'][0]['logit_effect']


@pytest.mark.parametrize('changes', [
    {'probability': 0}, {'probability': 1}, {'probability': float('nan')}, {'probability': True},
    {'shooter_id': True}, {'goalie_id': '8480001'}, {'shooter_id': -1},
    {'event_id': True}, {'game_id': 2021040001}, {'game_date': '20211001'},
    {'game_date': '2025-10-01'}, {'target': 0}, {'future_goals': 1},
])
def test_invalid_or_post_outcome_fields_rejected(changes):
    rr = sample(1); rr[0].update(changes)
    with pytest.raises(ValueError): m.fit(rr, [0], mode='joint')


@pytest.mark.parametrize('targets_bad', [[True]*80, [0.5]*80, [0]*79, [2]*80])
def test_invalid_fit_targets_rejected(targets_bad):
    with pytest.raises(ValueError): m.fit(sample(), targets_bad, mode='joint')


def test_duplicate_out_of_order_empty_and_conflicting_dates_rejected():
    rr = sample(2)
    for wrong in [[], [rr[0], rr[0]], rr[::-1], [rr[0], {**rr[1], 'game_date': '2021-10-02'}]]:
        with pytest.raises(ValueError): m.validate_rows(wrong)


def test_no_same_day_training_game_or_prior_date_inference():
    fitted = m.fit(sample(), targets(), mode='joint')
    for wrong in [sample(), [{**sample(1)[0], 'game_id': 2021020002}],
                  [{**sample(1)[0], 'game_date': '2021-09-01'}],
                  [{**sample(1)[0], 'game_date': '2022-10-01'}]]:
        with pytest.raises(ValueError): m.predict(fitted, wrong)


def test_target_field_is_rejected_at_prediction_not_ignored():
    fitted = m.fit(sample(), targets(), mode='joint')
    wrong = sample(1, later=True); wrong[0]['target'] = 1
    with pytest.raises(ValueError): m.predict(fitted, wrong)


@pytest.mark.parametrize('field,value', [('publishable', True), ('intercept', float('nan')),
                                       ('intercept', 1.6), ('fit_end', '20211001'), ('fit_events', 0),
                                       ('fit_game_ids', [2021020001, 2021020001]), ('fit_rows_sha256', 'fake')])
def test_rehashed_invalid_model_rejected(field, value):
    fitted = m.fit(sample(), targets(), mode='joint'); fitted[field] = value
    if isinstance(value, float) and math.isnan(value):
        with pytest.raises(ValueError): m.validate_model(fitted)
    else:
        with pytest.raises(ValueError): m.validate_model(rehash(fitted))


def test_changed_unhashed_model_and_duplicate_effects_rejected():
    fitted = m.fit(sample(), targets(), mode='joint'); fitted['intercept'] += .01
    with pytest.raises(ValueError): m.validate_model(fitted)
    fitted = m.fit(sample(), targets(), mode='joint')
    fitted['effects']['shooter'].append(fitted['effects']['shooter'][0])
    with pytest.raises(ValueError): m.validate_model(rehash(fitted))


def test_nonconverged_optimizer_is_not_a_model(monkeypatch):
    class Failed:
        success = False
        x = np.zeros(5)
    monkeypatch.setattr(m, 'minimize', lambda *args, **kwargs: Failed())
    with pytest.raises(ValueError, match='convergence'): m.fit(sample(), targets(), mode='joint')


def test_fixed_modes_only():
    with pytest.raises(ValueError): m.fit(sample(), targets(), mode='posthoc_winner')
