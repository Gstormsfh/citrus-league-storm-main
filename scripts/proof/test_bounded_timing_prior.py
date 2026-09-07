import pytest
import run_bounded_timing_prior as m


def rows():return [{'game_id':i//3+1,'event_id':i,'game_date':'2023-01-01','population':'original','target':0,'neutral_xg':.4,'band':'same_clock'} for i in range(30)]


def test_convex_root_and_bounded_prior_gradient():
    r=rows();d=m.fit_offset(r);penalty=2*m.prior.sigmoid(d)-1
    assert -1<penalty<0 and d<m.prior.fit_offset(r)
    assert penalty+sum(m.prior.sigmoid(m.prior.logit(x['neutral_xg'])+d) for x in r)==pytest.approx(0,abs=1e-10)


def test_future_and_recovered_not_fitted():
    r=rows();extra=[dict(x,game_id=x['game_id']+100,population='recovered',target=1) for x in r]
    extra+=[dict(x,game_id=x['game_id']+200,game_date='2023-02-01',target=1) for x in r]
    assert m.fit_month(r,'2023-02')==m.fit_month(r+extra,'2023-02')


def test_sparse_and_first_month_fallback():
    assert m.fit_offset(rows()[:29])==0
    assert all(b['offset']==0 for b in m.fit_month(rows(),'2023-01')['bands'].values())
