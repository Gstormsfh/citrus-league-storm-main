import pytest
import run_recent_timing as m


def rows():return [{'game_id':i//3+1,'event_id':i,'game_date':'2023-01-01','target':0,'neutral_xg':.4,'band':'up_to_1s'} for i in range(30)]


def test_offset_reduces_overprediction_and_satisfies_gradient():
    r=rows();v=m.fit_offset(r)
    assert v<0 and abs(10*v+sum(m.sigmoid(m.logit(x['neutral_xg'])+v)-x['target'] for x in r))<1e-10


def test_minimum_support_falls_back_exactly():
    assert m.fit_offset(rows()[:29])==0
    assert m.fit_offset([dict(r,game_id=1) for r in rows()])==0


def test_month_cutoff_and_first_month_no_history():
    r=rows();fit=m.fit_month(r,'2023-01')
    assert all(b['events']==0 and b['offset']==0 for b in fit['bands'].values())
    assert m.apply(r[0],fit)==r[0]['neutral_xg']
    fit=m.fit_month(r,'2023-02');assert fit['bands']['up_to_1s']['events']==30
    with pytest.raises(ValueError):m.apply(r[0],fit)


def test_future_outcomes_do_not_change_fit():
    r=rows();future=[dict(x,game_id=x['game_id']+100,game_date='2023-02-01') for x in r]
    assert m.fit_month(r+future,'2023-02')==m.fit_month(r,'2023-02')
