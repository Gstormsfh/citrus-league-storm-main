from dataclasses import replace
import pytest
import finishing_quantity_contract as m


def fixture():
    scope = m.Scope(8478402, 'regular_season_shots_on_goal', 'a'*64)
    forecast = m.GoalForecast(scope, '2026-01-02T00:00:00Z', .4, '2025-12-31T00:00:00Z')
    talent = m.TalentEstimate(scope, 1.25, '2026-01-01T23:59:59Z', 'b'*64)
    return forecast, talent


def test_percent_ratio_and_skill_are_not_interchangeable():
    f, _ = fixture()
    r = m.observed_rates(scope=f.scope, goals=15, shots_on_goal=100, xg_attempts=100, neutral_xg=10)
    assert r == {'shooting_percentage': 15, 'goals_over_neutral_xg_ratio': 1.5,
                 'finishing_above_expected_percentage': 50, 'goals_minus_neutral_xg': 5,
                 'estimated_talent': None, 'publishable': False}


def test_zero_denominators_are_unknown_not_zero_talent():
    f, _ = fixture()
    r = m.observed_rates(scope=f.scope, goals=0, shots_on_goal=0, xg_attempts=0, neutral_xg=0)
    assert r['shooting_percentage'] is None
    assert r['goals_over_neutral_xg_ratio'] is None
    assert r['estimated_talent'] is None


def test_apply_once_preserves_inputs_and_count_can_exceed_one():
    f, t = fixture()
    out = m.apply_once(replace(f, expected_goals=2), t)
    assert out.expected_goals == 2.5
    assert out.finishing_artifact_sha256 == t.artifact_sha256
    assert f.expected_goals == .4 and f.finishing_artifact_sha256 is None
    with pytest.raises(ValueError): m.apply_once(out, t)


@pytest.mark.parametrize('quantity', ['shot_probability', 'flurry_credit', 'talent_adjusted_xg'])
def test_incompatible_quantity_rejected(quantity):
    f, t = fixture()
    with pytest.raises(ValueError): m.apply_once(replace(f, quantity=quantity), t)


@pytest.mark.parametrize('field,value', [('player_id', 8478403), ('population', 'playoff_shots_on_goal'),
                                      ('neutral_baseline_sha256', 'c'*64)])
def test_identity_and_denominator_mismatch_rejected(field, value):
    f, t = fixture()
    with pytest.raises(ValueError): m.apply_once(f, replace(t, scope=replace(t.scope, **{field: value})))


@pytest.mark.parametrize('stamp', ['2026-01-02T00:00:00Z', '2026-01-03T00:00:00Z', '2026-01-01'])
def test_concurrent_future_or_ambiguous_evidence_rejected(stamp):
    f, t = fixture()
    with pytest.raises(ValueError): m.apply_once(f, replace(t, evidence_available_before=stamp))


@pytest.mark.parametrize('value', [True, -1, float('nan'), float('inf'), '1.2', 0])
def test_invalid_talent_rejected(value):
    f, t = fixture()
    with pytest.raises(ValueError): m.apply_once(f, replace(t, multiplier=value))


def test_overflow_rejected():
    f, t = fixture()
    with pytest.raises(ValueError): m.apply_once(replace(f, expected_goals=1e308), replace(t, multiplier=1e308))


@pytest.mark.parametrize('goals,shots,xg', [(2,1,.5), (True,1,.5), (0,0,1), (0,1,2)])
def test_incoherent_actuals_rejected(goals, shots, xg):
    f, _ = fixture()
    with pytest.raises(ValueError): m.observed_rates(scope=f.scope, goals=goals, shots_on_goal=shots, xg_attempts=shots, neutral_xg=xg)


def test_unblocked_xg_exposure_is_not_sog_exposure():
    f, _ = fixture()
    scope = replace(f.scope, population='regular_season_unblocked_attempts')
    r = m.observed_rates(scope=scope, goals=1, shots_on_goal=2, xg_attempts=5, neutral_xg=3)
    assert r['shooting_percentage'] == 50
    assert r['goals_over_neutral_xg_ratio'] == pytest.approx(1/3)
    with pytest.raises(ValueError):
        m.observed_rates(scope=f.scope, goals=1, shots_on_goal=2, xg_attempts=5, neutral_xg=3)


@pytest.mark.parametrize('quantity', ['odds_ratio', 'observed_goals_xg_ratio'])
def test_incompatible_talent_estimate_rejected(quantity):
    f, t = fixture()
    with pytest.raises(ValueError): m.apply_once(f, replace(t, quantity=quantity))


def test_baseline_leakage_and_publication_rejected():
    f, t = fixture()
    with pytest.raises(ValueError): m.apply_once(replace(f, baseline_evidence_before=f.prediction_at), t)
    with pytest.raises(ValueError): m.apply_once(replace(f, publishable=True), t)
