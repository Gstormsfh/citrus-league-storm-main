from copy import deepcopy
import json
from pathlib import Path
import sys

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / 'data-pipeline/tests'))
import review_actor_attribution as c
import test_player_goalie_attribution as fixture


def test_independent_roster_stint_ledger():
    games = [fixture.build(), fixture.build(fixture.payload(2022020002, 3)), fixture.build(fixture.payload(2022030001))]
    aggregate = fixture.c.aggregate_diagnostics(games)
    out = c.check_actor_totals(games, aggregate)
    assert out['shooter']['attributed']['events'] == 9
    assert out['defending_goalie']['attributed']['goals'] == 3


@pytest.mark.parametrize('bad', ['value', 'events', 'goals', 'subtotal', 'missing_actor', 'duplicate_actor',
    'stint_missing', 'stint_duplicate', 'roster_games', 'appearance', 'toi', 'rate', 'promoted'])
def test_changed_actor_or_exposure_ledger_rejected(bad):
    games = [fixture.build()]; aggregate = fixture.c.aggregate_diagnostics(games)
    row = fixture.actor(aggregate)
    if bad == 'value': row['eligible_event_xg'] = 0
    elif bad == 'events': row['eligible_event_count'] -= 1
    elif bad == 'goals': row['eligible_event_goals'] = 0
    elif bad == 'subtotal': row['attributed_xg_subtotal'] = 0
    elif bad == 'missing_actor': aggregate['rows'].pop()
    elif bad == 'duplicate_actor': aggregate['rows'].append(deepcopy(row))
    elif bad == 'stint_missing': row['team_stints'].clear()
    elif bad == 'stint_duplicate': row['team_stints'].append(deepcopy(row['team_stints'][0]))
    elif bad == 'roster_games': row['roster_listed_game_ids'].clear()
    elif bad == 'appearance': row['appearance_games'] = 1
    elif bad == 'toi': row['toi_seconds'] = 0
    elif bad == 'rate': row['xg_per60'] = 0
    else: aggregate['foundation_accepted'] = True
    with pytest.raises(ValueError): c.check_actor_totals(games, aggregate)


def test_unavailable_total_cannot_be_promoted_from_subtotal():
    p = fixture.payload(); p['plays'][1]['situationCode'] = None
    game = fixture.build(p); aggregate = fixture.c.aggregate_diagnostics([game])
    c.check_actor_totals([game], aggregate)
    row = fixture.actor(aggregate, 21, 'defending_goalie')
    row['eligible_event_xg'] = row['attributed_xg_subtotal']
    with pytest.raises(ValueError): c.check_actor_totals([game], aggregate)


@pytest.mark.parametrize('state', ['present', 'empty', 'unknown'])
def test_raw_source_actor_state_checked(state):
    p = fixture.payload()
    if state == 'empty':
        p['plays'][1]['situationCode'] = '0651'; p['plays'][1]['details'].pop('goalieInNetId')
    elif state == 'unknown': p['plays'][1]['situationCode'] = None
    game = fixture.build(p)
    c.verify_raw_actors(game, json.dumps(p).encode())


@pytest.mark.parametrize('bad', ['source', 'roster', 'shooter', 'goalie', 'goal', 'event_hash', 'promoted'])
def test_semantically_rehashed_wrong_raw_actor_rejected(bad):
    p = fixture.payload(); game = fixture.build(p)
    if bad == 'source': game['source_body_sha256'] = 'a' * 64
    elif bad == 'roster': game['roster'][0]['team_id'] = 99
    elif bad == 'shooter': game['events'][0]['shooter']['player_id'] = 12
    elif bad == 'goalie': game['events'][0]['defending_goalie']['player_id'] = 12
    elif bad == 'goal': game['events'][0]['is_goal'] = False
    elif bad == 'event_hash': game['events'][0]['source_event_sha256'] = 'b' * 64
    else: game['publishable'] = True
    game['receipt_sha256'] = fixture.fingerprint({k: v for k, v in game.items() if k != 'receipt_sha256'})
    with pytest.raises(ValueError): c.verify_raw_actors(game, json.dumps(p).encode())


def test_explicit_review_pin_required():
    with pytest.raises(ValueError): c.review('not-a-pin')


def test_broad_archive_rejected_before_creation(tmp_path, monkeypatch):
    monkeypatch.setattr(c, 'REPO', tmp_path)
    with pytest.raises(ValueError): c.archive(tmp_path / 'unscoped', 'a' * 64)
    assert not (tmp_path / 'unscoped').exists()
