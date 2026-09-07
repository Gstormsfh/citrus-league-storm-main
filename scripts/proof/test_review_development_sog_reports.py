import pytest
from review_development_sog_reports import reconcile_counts,report_identity
from collect_development_sog_reports import module


def test_goal_credit_preserved_with_multiple_explicit_nonshot_goals():
    key=(1,8470001);raw={key:{'goals':3,'sog':6}};official={key:{'goals':3,'sog':4}}
    out=reconcile_counts(raw,official,{123:key,456:key})
    assert out[0]['matches'] and out[0]['after']['goals']==3
    assert raw[key]['sog']==6


def test_counts_alone_cannot_create_adjustment():
    key=(1,8470001);out=reconcile_counts({key:{'goals':1,'sog':2}},{key:{'goals':1,'sog':1}},{})
    assert out[0]['matches'] is False


def test_population_and_unknown_actor_rejected():
    with pytest.raises(ValueError):reconcile_counts({(1,1):{'goals':1,'sog':1}},{},{})
    with pytest.raises(ValueError):reconcile_counts({},{},{123:(1,1)})


def test_header_exact_date_game_required():
    reviewer=module('review_goal_sog_evidence');p={'id':2022020158,'gameDate':'2022-11-01'}
    report_identity(b'<td>Tuesday, November 1, 2022</td><td>Game 0158</td>',p,reviewer)
    for b in (b'Tuesday, November 1, 2022 Game 0159',b'Wednesday, November 2, 2022 Game 0158'):
        with pytest.raises(ValueError):report_identity(b,p,reviewer)
