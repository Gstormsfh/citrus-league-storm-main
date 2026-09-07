from copy import deepcopy
import pytest
from test_composed_xg import fixture
import recent_timing_inference as m


def sidecar(base):
    return {'contract':m.VERSION,'publishable':False,'usage':'offline_replay_only',
        'base_fingerprint':m.fingerprint(base),'source_health_sha256':'b'*64,
        'fit':{'month':'2023-01','start_inclusive':'2022-10-03','end_exclusive':'2023-01-01',
            'bands':{b:{'offset':0.,'events':0,'games':0,'training_keys':[],'training_end':None} for b in m.BANDS}}}


def test_exact_zero_and_caller_band_ignored(fixture):
    b,r=fixture;s=sidecar(b);c=m.RecentCandidate(b,s)
    result=c.predict([r])[0];assert result['neutral_xg']==m.XGCandidate(b).predict([r])[0]['neutral_xg']
    assert c.predict([dict(r,band='same_clock',target=999)])==[result]
    s['fit']['bands']['up_to_1s']['offset']=9
    assert c.predict([r])==[result]


@pytest.mark.parametrize('change',[{'publishable':True},{'usage':'production'},{'base_fingerprint':'0'*64}])
def test_binding_and_publication_fail_closed(fixture,change):
    b,_=fixture;s=sidecar(b);s.update(change)
    with pytest.raises(ValueError):m.RecentCandidate(b,s)


def test_sparse_and_future_training_rejected(fixture):
    b,_=fixture;s=sidecar(b);s['fit']['bands']['same_clock']['offset']=-1
    with pytest.raises(ValueError):m.RecentCandidate(b,s)
    s=sidecar(b);s['fit']['end_exclusive']='2023-01-02'
    with pytest.raises(ValueError):m.RecentCandidate(b,s)


def test_supported_offset_applied_once_and_duplicate_rows_rejected(fixture):
    b,r=fixture;s=sidecar(b);s['fit']['bands']['up_to_1s']={'offset':-1.,'events':30,'games':10,
        'training_keys':[[i//3+100,i] for i in range(30)],'training_end':'2022-12-31'}
    c=m.RecentCandidate(b,s);result=c.predict([r])[0]
    assert result['neutral_xg']<result['baseline_neutral_xg']
    with pytest.raises(ValueError):c.predict([r,r])
    with pytest.raises((KeyError,ValueError)):c.predict([result])
