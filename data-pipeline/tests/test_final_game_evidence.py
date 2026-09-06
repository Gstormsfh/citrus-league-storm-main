import copy
import pytest
from monitoring.final_game_evidence import verify_final_game
from tests.test_canonical_events import game, shot


def final_game():
    payload = game([shot(details={'eventOwnerTeamId': 1, 'shootingPlayerId': 7})])
    payload.update(gameState='OFF', periodDescriptor={'number': 3, 'periodType': 'REG'})
    payload['homeTeam'].update(score=0, sog=1)
    payload['awayTeam'].update(score=0, sog=0)
    return payload


def test_final_totals_require_exact_attempt_counts_and_final_state():
    payload = final_game()
    assert verify_final_game(payload)['status'] == 'verified'
    live = {**payload, 'gameState': 'LIVE'}
    assert verify_final_game(live)['status'] == 'unavailable'
    partial = {**payload, 'plays': []}
    assert verify_final_game(partial)['reason'] == 'final_attempt_totals_mismatch'


@pytest.mark.parametrize('team,key', [('homeTeam', 'sog'), ('awayTeam', 'score'), ('homeTeam', 'id')])
def test_missing_final_team_totals_are_unavailable_not_zero(team, key):
    payload = final_game()
    del payload[team][key]
    assert verify_final_game(payload)['status'] == 'unavailable'


def test_shootout_adjustment_uses_observed_winner_not_total_shootout_goals():
    payload = final_game()
    payload['periodDescriptor'] = {'number': 5, 'periodType': 'SO'}
    payload['homeTeam']['score'] = 1
    payload['plays'] += [shot(eventId=eid, typeCode=505,
                             periodDescriptor={'number': 5, 'periodType': 'SO'},
                             details={'eventOwnerTeamId': 1, 'scoringPlayerId': 7}) for eid in (2, 3)]
    result = verify_final_game(payload)
    assert result['status'] == 'verified'
    assert result['shootout_score_bonus'] == {1: 1, 2: 0}
    assert result['team_counts'][1] == {'goals': 0, 'sog': 1, 'shootout_goals': 2}
    wrong_winner = copy.deepcopy(payload)
    wrong_winner['homeTeam']['score'], wrong_winner['awayTeam']['score'] = 0, 1
    assert verify_final_game(wrong_winner)['status'] == 'quarantined'
    missing_attempts = copy.deepcopy(payload)
    missing_attempts['plays'] = missing_attempts['plays'][:1]
    assert verify_final_game(missing_attempts)['status'] == 'unavailable'


def test_final_period_and_shootout_evidence_must_agree():
    payload = final_game()
    payload['plays'].append(shot(eventId=2, periodDescriptor={'number': 5, 'periodType': 'SO'}))
    assert verify_final_game(payload)['reason'] == 'shootout_final_period_conflict'
