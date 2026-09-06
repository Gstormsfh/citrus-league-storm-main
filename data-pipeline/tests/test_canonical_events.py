from acquisition.canonical_events import normalize_pbp


def game(play):
    return {'id':2025020001,'season':20252026,'gameType':2,'homeTeam':{'id':1},'awayTeam':{'id':2},'plays':play}


def shot(**overrides):
    return {'eventId':1,'typeCode':506,'periodDescriptor':{'number':1,'periodType':'REG'},
            'timeInPeriod':'01:00','situationCode':'0551','details':{'eventOwnerTeamId':1,'shootingPlayerId':7},**overrides}


def test_empty_net_uses_shooting_perspective_and_missing_features_stay_null():
    result=normalize_pbp(game([shot()]))
    assert result['complete']
    event=result['events'][0]
    assert event['is_empty_net'] is True
    assert event['x_raw'] is None and event['shot_type'] is None
    away=normalize_pbp(game([shot(details={'eventOwnerTeamId':2,'shootingPlayerId':7})]))
    assert away['events'][0]['is_empty_net'] is False


def test_revisions_change_hash_not_identity_and_no_actor_is_invented():
    a=normalize_pbp(game([shot()]))['events'][0]
    b=normalize_pbp(game([shot(typeCode=505,details={'eventOwnerTeamId':1})]))['events'][0]
    assert (a['game_id'],a['event_id'])==(b['game_id'],b['event_id'])
    assert a['source_event_sha256']!=b['source_event_sha256']
    assert b['shooter_id'] is None and b['is_goal']


def test_shootouts_excluded_duplicates_quarantined_and_bad_ot_clock_refused():
    plays=[shot(),shot(),shot(periodDescriptor={'number':5,'periodType':'SO'}),
           shot(eventId=2,periodDescriptor={'number':4,'periodType':'OT'},timeInPeriod='06:00')]
    result=normalize_pbp(game(plays))
    assert not result['complete'] and len(result['quarantine'])==2
    assert result['excluded']['shootout']==1


def test_regular_season_has_one_overtime_but_playoffs_can_have_more():
    overtime = shot(periodDescriptor={'number': 5, 'periodType': 'OT'})
    regular = normalize_pbp(game([overtime]))
    assert regular['quarantine'][0]['reason'] == 'invalid_period'
    assert not regular['complete']
    playoff = game([overtime])
    playoff.update(id=2025030001, gameType=3)
    assert normalize_pbp(playoff)['complete']
