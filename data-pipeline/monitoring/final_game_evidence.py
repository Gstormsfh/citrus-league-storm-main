"""Verify final PBP coverage against observed team totals, without changing v1 receipts.

Shootout goals do not enter skater statistics. A final SO scoreboard includes one
winner goal, whose team must be established by the captured shootout attempts.
This gate never supplies missing team identities, scores, or source events.
"""
def verify_final_game(payload):
    if payload.get('gameState') not in ('OFF', 'FINAL'):
        return {'status': 'unavailable', 'reason': 'game_not_final'}
    home, away = payload.get('homeTeam'), payload.get('awayTeam')
    period = payload.get('periodDescriptor')
    if not isinstance(home, dict) or not isinstance(away, dict) or not isinstance(period, dict):
        return {'status': 'unavailable', 'reason': 'missing_final_team_or_period_evidence'}
    teams = [home.get('id'), away.get('id')]
    if (any(type(team) is not int or team <= 0 for team in teams) or teams[0] == teams[1]
            or any(type(team.get(key)) is not int or team[key] < 0 for team in (home, away) for key in ('score', 'sog'))
            or period.get('periodType') not in ('REG', 'OT', 'SO')):
        return {'status': 'unavailable', 'reason': 'missing_final_totals_or_identity'}
    plays = payload.get('plays')
    if not isinstance(plays, list):
        return {'status': 'unavailable', 'reason': 'missing_final_plays'}
    counts = {team: {'goals': 0, 'sog': 0, 'shootout_goals': 0} for team in teams}
    shootout_attempts = 0
    for play in plays:
        if not isinstance(play, dict):
            return {'status': 'quarantined', 'reason': 'malformed_final_play'}
        code = play.get('typeCode')
        if code not in (505, 506, 507):
            continue
        detail, descriptor = play.get('details'), play.get('periodDescriptor')
        if (not isinstance(detail, dict) or not isinstance(descriptor, dict)
                or type(detail.get('eventOwnerTeamId')) is not int or detail['eventOwnerTeamId'] not in counts):
            return {'status': 'unavailable', 'reason': 'missing_attempt_owner_or_period'}
        owner = detail['eventOwnerTeamId']
        if descriptor.get('periodType') == 'SO':
            shootout_attempts += 1
            counts[owner]['shootout_goals'] += code == 505
        elif descriptor.get('periodType') in ('REG', 'OT'):
            counts[owner]['goals'] += code == 505
            counts[owner]['sog'] += code in (505, 506)
        else:
            return {'status': 'unavailable', 'reason': 'missing_attempt_period_type'}
    bonuses = dict.fromkeys(teams, 0)
    if period['periodType'] == 'SO':
        if payload.get('gameType') != 2 or not shootout_attempts:
            return {'status': 'unavailable', 'reason': 'missing_or_invalid_shootout_evidence'}
        home_goals, away_goals = (counts[team]['shootout_goals'] for team in teams)
        if home_goals == away_goals:
            return {'status': 'unavailable', 'reason': 'shootout_winner_unresolved'}
        if counts[teams[0]]['goals'] != counts[teams[1]]['goals']:
            return {'status': 'quarantined', 'reason': 'shootout_requires_tied_play_goals'}
        bonuses[teams[0] if home_goals > away_goals else teams[1]] = 1
    elif shootout_attempts:
        return {'status': 'quarantined', 'reason': 'shootout_final_period_conflict'}
    differences = []
    for team in (home, away):
        tid = team['id']
        if counts[tid]['sog'] != team['sog']:
            differences.append({'team_id': tid, 'field': 'sog', 'observed': counts[tid]['sog'], 'reported': team['sog']})
        expected = counts[tid]['goals'] + bonuses[tid]
        if expected != team['score']:
            differences.append({'team_id': tid, 'field': 'score', 'observed': expected, 'reported': team['score']})
    return {'status': 'quarantined' if differences else 'verified',
            'reason': 'final_attempt_totals_mismatch' if differences else 'verified_final_attempt_totals',
            'differences': differences, 'team_counts': counts, 'shootout_score_bonus': bonuses}
