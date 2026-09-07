import pytest
import diagnose_expanded_timing as m


@pytest.mark.parametrize('gap,expected', [(0,'same_clock'),(1,'up_to_1s'),(2,'over_1_under_3s'),(3,'from_3_to_10s'),(10,'from_3_to_10s'),(11,'over_10s')])
def test_gap_boundaries(gap, expected):
    assert m.timing({'prior_sog_same_team':'1'}, gap) == expected


@pytest.mark.parametrize('gap', [None, True, -1, float('nan')])
def test_missing_or_invalid_prior_sog_time_not_invented(gap):
    with pytest.raises(ValueError): m.timing({'prior_sog_same_team':'1'}, gap)


def test_non_prior_sog_not_mislabeled_from_clock():
    assert m.timing({'prior_sog_same_team':'0'}, 0) == 'no_prior_sog'


def test_game_weighted_bias_and_months():
    rows = [{'game_id':i,'target':0,'neutral_xg':.2,'game_date':day} for i,day in [(1,'2022-10-01'),(2,'2022-11-01')]]
    out = m.summarize(rows)
    assert out['bias'] == pytest.approx(.2)
    assert out['game_bootstrap_bias_percentile_95'] == pytest.approx([.2,.2])
    assert out['months_positive_bias'] == 2
