import pytest
import evaluate_recovered_xg as m


def rows():
    return [{'game_id': i+1, 'event_id': 1, 'target': y, 'raw_xg': p, 'neutral_xg': q}
            for i, (y,p,q) in enumerate([(0,.4,.2), (1,.6,.8)])]


def test_hand_calculated_losses_and_bias():
    r = m.score(rows(), 'neutral_xg')
    assert r['events'] == 2 and r['goals'] == 1 and r['brier'] == pytest.approx(.04)
    assert r['bias'] == pytest.approx(0) and sum(b['events'] for b in r['calibration_bins']) == 2
    ci = m.cluster_interval(rows())
    assert ci['point'] == pytest.approx(-.12)
    assert ci['percentile_95'] == pytest.approx([-.12, -.12])


def test_endpoint_bins_and_clipped_log_loss():
    r = rows(); r[0]['neutral_xg'] = 0.; r[1]['neutral_xg'] = 1.
    assert m.score(r, 'neutral_xg')['brier'] == 0
    assert m.score(r, 'neutral_xg')['calibration_bins'][-1]['events'] == 1


@pytest.mark.parametrize('value', [True, -1., float('nan'), 1.1])
def test_invalid_probability_rejected(value):
    r = rows(); r[0]['neutral_xg'] = value
    with pytest.raises(ValueError): m.score(r, 'neutral_xg')


def test_duplicates_and_ambiguous_dates_rejected():
    with pytest.raises(ValueError): m.score(rows()*2, 'raw_xg')
    e = {'valid_from': '2022-10-01', 'valid_to': '2022-10-31'}
    assert m.select_bundle({'game_date': '2022-10-01'}, [e]) == e
    for entries in ([], [e,e]):
        with pytest.raises(ValueError): m.select_bundle({'game_date': '2022-10-01'}, entries)
