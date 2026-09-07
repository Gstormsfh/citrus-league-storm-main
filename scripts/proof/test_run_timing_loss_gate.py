import run_timing_loss_gate as m


def rows():return [{'game_id':i//3+1,'event_id':i,'game_date':'2023-01-01','population':'original',
    'target':0,'neutral_xg':.4,'recent_xg':.2,'band':'same_clock'} for i in range(30)]


def test_prior_improvement_activates_but_same_month_cannot():
    r=rows();assert m.decide(r,'2023-02')['bands']['same_clock']['active']
    assert not m.decide(r,'2023-01')['bands']['same_clock']['active']


def test_recovered_and_future_outcomes_do_not_choose_gate():
    r=rows();extra=[dict(x,game_id=x['game_id']+100,population='recovered',target=1) for x in r]
    extra += [dict(x,game_id=x['game_id']+200,game_date='2023-02-01',target=1) for x in r]
    assert m.decide(r+extra,'2023-02')==m.decide(r,'2023-02')


def test_sparse_tie_and_worse_fall_back():
    for r in (rows()[:29],[dict(x,recent_xg=.4) for x in rows()],[dict(x,recent_xg=.6) for x in rows()]):
        gate=m.decide(r,'2023-02');assert not gate['bands']['same_clock']['active']
        test=dict(rows()[0],game_date='2023-02-01');assert m.apply(test,gate)==test['neutral_xg']
