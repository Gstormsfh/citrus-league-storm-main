from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
import sys
import pytest
sys.path.insert(0, str(Path(__file__).parent / 'runtime'))
from review_deadlines import review_notice


def fixture():
    r = dict(reviewed_at='2026-09-18', review_after='2026-09-21')
    s = dict(revision='a', source_release_review=dict(r),
             finishing_refresh_policy=dict(r), players=[
                 dict(player_id=1, availability_scenario=dict(r)),
                 dict(player_id=2, availability_scenario={**r, 'review_after': '2026-09-29'})])
    return s, dict(r, source_revision='a')


@pytest.mark.parametrize('day,hour,minute,due,expired', [
    (19,23,59,False,False), (20,0,0,True,False),
    (20,23,59,True,False), (21,0,0,True,True)])
def test_exact_24h_warning_and_expiry_without_mutation(day,hour,minute,due,expired):
    s,p = fixture(); before = deepcopy((s,p))
    result = review_notice(s,p,datetime(2026,9,day,hour,minute,tzinfo=timezone.utc))
    assert result['review_due'] is due
    assert len(result['review_items']) == (4 if due else 0)
    assert all(i['expired'] is expired for i in result['review_items'])
    assert (s,p) == before


@pytest.mark.parametrize('fault', ['source','missing','invalid_date','inverted','future_review','naive'])
def test_bad_review_inputs_fail_closed(fault):
    s,p = fixture(); now = datetime(2026,9,19,tzinfo=timezone.utc)
    if fault == 'source': s['revision'] = 'b'
    if fault == 'missing': del s['finishing_refresh_policy']['review_after']
    if fault == 'invalid_date': p['review_after'] = '2026-02-30'
    if fault == 'inverted': p['review_after'] = '2026-09-17'
    if fault == 'future_review': p['reviewed_at'] = '2026-09-20'
    if fault == 'naive': now = now.replace(tzinfo=None)
    with pytest.raises((ValueError,KeyError)): review_notice(s,p,now)
