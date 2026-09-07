import math
import pytest
from targeted_xg_inference import adjust

NAMES=['immediate_previous_sog_same_team','seconds_since_immediate_event','shooting_skaters','defending_skaters']
PARAMS={'same_timestamp':{'offset':-1.},'five_on_four':{'offset':-.05}}


def test_unaffected_shots_exactly_unchanged():
    assert adjust(.123456789,[0,0,5,5],NAMES,PARAMS)==.123456789
    assert adjust(.123456789,[1,1,5,5],NAMES,PARAMS)==.123456789


def test_same_timestamp_not_any_zero_gap():
    assert adjust(.2,[1,0,5,5],NAMES,PARAMS)<.2
    assert adjust(.2,[0,0,5,5],NAMES,PARAMS)==.2


def test_overlap_adds_offsets_once():
    q=adjust(.2,[1,0,5,4],NAMES,PARAMS)
    assert q==pytest.approx(1/(1+math.exp(-(math.log(.2/.8)-1.05))))


def test_invalid_probability_rejected():
    for p in (float('nan'),float('inf'),-1,2):
        with pytest.raises(ValueError):adjust(p,[1,0,5,4],NAMES,PARAMS)
