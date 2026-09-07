from copy import deepcopy
import pytest
from review_development_sog_v2 import goal_rows,add_reviewed_award
from collect_development_sog_reports import module


def test_accent_identity_is_exact_and_raw_hash_preserved():
    r=module('review_goal_sog_evidence');b=b'<tr id="PL-4"><td>4</td><td>2</td><td>EV</td><td>11:04<br>8:56</td><td>GOAL</td><td>ARI #4 VALIMAKI(1), Wrist, 10 ft.</td>'
    e={'team_id':1,'period':{'number':2},'clock':'11:04','roster_identity':{'sweaterNumber':4,'lastName':{'default':'Välimäki'}}}
    teams={'homeTeam':{'id':1,'abbrev':'ARI'}}
    assert r.report_goal_rows(b,e,teams)==[]
    out=goal_rows(b,e,teams,r);assert len(out)==1 and out[0]['row_prefix_utf8_sha256']==r.digest(b)
    assert out[0]['explicit_own_goal_label'] is False
    assert goal_rows(b+b,e,teams,r)==[]
    e['roster_identity']['sweaterNumber']=5;assert goal_rows(b,e,teams,r)==[]


def test_narrative_adjustment_preserves_goals_requires_all_players():
    out={'own_goal_events':[],'players':[{'team_id':1,'player_id':2,'before':{'goals':1,'sog':3},'official':{'goals':1,'sog':2}}],
        'gs_teams':[{'matches':True},{'matches':True}]}
    event={'event_id':5,'team_id':1,'player_id':2,'source_event_sha256':'a'*64}
    actual=add_reviewed_award(deepcopy(out),event,{'explicit_test_only':True})
    assert actual['statistical_treatment_supported'] and actual['event_overlays'][0]['goal_credit']==1
    assert actual['event_overlays'][0]['model_probability'] is None
    out['gs_teams'][0]['matches']=False
    assert add_reviewed_award(out,event,{})['event_overlays']==[]


def test_duplicate_statistical_adjustment_rejected():
    e={'event_id':5,'team_id':1,'player_id':2}
    with pytest.raises(ValueError):add_reviewed_award({'own_goal_events':[e]},e,{})
