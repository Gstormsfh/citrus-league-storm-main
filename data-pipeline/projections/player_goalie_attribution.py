"""Offline eligible-event actor accounting; not official actuals or serving metrics.

Roster membership establishes an actor's event team, not an appearance or TOI.
Every selected event stays in both accounting ledgers, including unresolved and
structurally not-applicable (empty-net) goalie attribution. No model fitting.
"""
from collections import defaultdict
from copy import deepcopy
import hashlib
import math
import re

from acquisition.canonical_events import normalize_pbp, player_id
from projections.analytics_publication import fingerprint, timestamp
from projections.verified_export_experiment import strict_json

VERSION = 'citrus-eligible-event-actor-diagnostic-v1'
POSITIONS = frozenset(('C', 'L', 'R', 'D', 'G'))
LINEAGE = frozenset(('raw_model_sha256', 'calibrators_sha256', 'feature_schema_sha256', 'prior_predictions_sha256'))


def _roster(payload):
    rows = payload.get('rosterSpots')
    home, away = payload['homeTeam']['id'], payload['awayTeam']['id']
    result = {}
    if not isinstance(rows, list) or not rows or len(rows) > 100:
        return {}, 'missing_or_invalid_game_roster'
    for row in rows:
        if (not isinstance(row, dict) or player_id(row.get('playerId')) is None
                or row['playerId'] in result or type(row.get('teamId')) is not int
                or row['teamId'] not in (home, away) or not isinstance(row.get('positionCode'), str)
                or row['positionCode'] not in POSITIONS):
            return {}, 'missing_or_invalid_game_roster'
        result[row['playerId']] = {'player_id': row['playerId'], 'team_id': row['teamId'], 'position': row['positionCode']}
    if ({r['team_id'] for r in result.values()} != {home, away}
            or {r['team_id'] for r in result.values() if r['position'] == 'G'} != {home, away}):
        return {}, 'missing_or_invalid_game_roster'
    return result, None


def _actor(raw_id, team, roster, roster_reason, *, goalie=False):
    pid = player_id(raw_id)
    # Bad roster must not be bypassed by a valid actor ID.
    if team is None: reason = 'unknown_event_team'
    elif roster_reason: reason = roster_reason
    elif pid is None: reason = 'missing_or_invalid_actor_id'
    elif pid not in roster: reason = 'actor_absent_from_game_roster'
    elif roster[pid]['team_id'] != team: reason = 'actor_roster_team_conflict'
    elif goalie and roster[pid]['position'] != 'G': reason = 'defending_actor_not_rostered_goalie'
    else: reason = None
    return {'status': 'unavailable' if reason else 'attributed', 'reason': reason,
            'player_id': pid if not reason else None, 'team_id': team, 'source_player_id': pid}


def _goalie_presence(code, owner, home, away):
    if (owner not in (home, away) or not isinstance(code, str)
            or re.fullmatch('[01][3-6][3-6][01]', code) is None):
        return None
    ag, ask, hsk, hg = map(int, code)
    if ag + ask > 6 or hg + hsk > 6: return None
    return bool(ag if owner == home else hg)


def attribute_game(body, expected_events, predictions, *, lineage, observed_at):
    """Require exact source-event/model membership; caller replays the source gate.

    `expected_events` comes from the unchanged first-party feature projector.
    This pure boundary additionally validates raw event identities and hashes;
    it does not claim upstream authentication or historical live availability.
    """
    if (type(body) is not bytes or not isinstance(lineage, dict) or set(lineage) != LINEAGE
            or any(not isinstance(v, str) or re.fullmatch('[0-9a-f]{64}', v) is None for v in lineage.values())):
        raise ValueError('Exact source bytes and model lineage required')
    payload = strict_json(body)
    normalized = normalize_pbp(payload)
    if not normalized['complete']: raise ValueError('Complete canonical event identities required')
    gid = payload['id']; home, away = payload['homeTeam']['id'], payload['awayTeam']['id']
    if (not isinstance(expected_events, list) or not 0 < len(expected_events) <= 2000
            or not isinstance(predictions, list) or len(predictions) != len(expected_events)):
        raise ValueError('Bounded complete selected event population required')
    expected = {}
    for row in expected_events:
        if (set(row) != {'game_id', 'event_id', 'source_event_sha256'} or type(row['game_id']) is not int
                or row['game_id'] != gid or type(row['event_id']) is not int or row['event_id'] < 0
                or row['event_id'] in expected):
            raise ValueError('Exact unique selected event identity required')
        expected[row['event_id']] = row['source_event_sha256']
    probabilities = {}
    for row in predictions:
        if (set(row) != {'game_id', 'event_id', 'probability'} or type(row['game_id']) is not int
                or row['game_id'] != gid or type(row['event_id']) is not int
                or row['event_id'] in probabilities or type(row['probability']) not in (int, float)
                or not math.isfinite(row['probability']) or not 0 <= row['probability'] <= 1):
            raise ValueError('Exact unique finite model probability required')
        probabilities[row['event_id']] = row['probability']
    canonical = {r['event_id']: r for r in normalized['events']}
    if set(expected) != set(probabilities) or not set(expected) <= set(canonical):
        raise ValueError('Selected source/model population mismatch')
    plays = {}
    for play in payload['plays']:
        if not isinstance(play, dict) or type(play.get('eventId')) is not int or play['eventId'] in plays:
            raise ValueError('Complete unique raw event stream required')
        plays[play['eventId']] = play
    roster, roster_reason = _roster(payload)
    events = []
    for eid in sorted(expected):
        play, event = plays[eid], canonical[eid]
        if expected[eid] != event['source_event_sha256'] or fingerprint(play) != expected[eid]:
            raise ValueError('Selected source event hash mismatch')
        details = play['details']
        owner = details.get('eventOwnerTeamId')
        owner = owner if type(owner) is int and owner in (home, away) else None
        defending = away if owner == home else home if owner == away else None
        shooter = _actor(event['shooter_id'], owner, roster, roster_reason)
        presence = _goalie_presence(play.get('situationCode'), owner, home, away)
        goalie = _actor(event['goalie_id'], defending, roster, roster_reason, goalie=True)
        if presence is None:
            goalie.update(status='unavailable', reason='unknown_goalie_presence', player_id=None)
        elif presence is False:
            # Non-null malformed IDs also conflict; never assign the prior goalie.
            conflict = details.get('goalieInNetId') is not None
            goalie.update(status='unavailable' if conflict else 'not_applicable',
                          reason='empty_net_actor_conflict' if conflict else 'verified_empty_net', player_id=None)
        events.append({'game_id': gid, 'event_id': eid, 'source_event_sha256': expected[eid],
            'probability': probabilities[eid], 'is_goal': event['is_goal'],
            'event_type': event['event_type'], 'owner_team_id': owner,
            'shooter': shooter, 'defending_goalie': goalie})
    output = {'contract': VERSION, 'publishable': False, 'model_accepted': False,
        'foundation_accepted': False, 'source_gate_replay_required': True,
        'population': 'eligible_development_validation_events_not_official_actuals',
        'game_id': gid, 'season': gid // 1_000_000, 'game_type': 'regular' if payload['gameType'] == 2 else 'playoff',
        'home_team_id': home, 'away_team_id': away, 'source_body_sha256': hashlib.sha256(body).hexdigest(),
        'source_observed_at': timestamp(observed_at), 'lineage': deepcopy(lineage),
        'roster': sorted(roster.values(), key=lambda r: r['player_id']), 'roster_reason': roster_reason,
        'events': events, 'accounting': {}}
    for role in ('shooter', 'defending_goalie'):
        accounts = {}
        for status in ('attributed', 'unavailable', 'not_applicable'):
            rows = [r for r in events if r[role]['status'] == status]
            accounts[status] = {'events': len(rows), 'xg': math.fsum(r['probability'] for r in rows),
                                'goals': sum(r['is_goal'] for r in rows)}
        if (sum(v['events'] for v in accounts.values()) != len(events)
                or not math.isclose(math.fsum(v['xg'] for v in accounts.values()),
                                    math.fsum(r['probability'] for r in events), rel_tol=0, abs_tol=1e-10)):
            raise ValueError('Event accounting mass lost')
        output['accounting'][role] = accounts
    return {**output, 'receipt_sha256': fingerprint(output)}


def aggregate_diagnostics(games):
    """Separate season/type/role, preserve team stints; unavailable totals stay NULL.

    One unresolved actor conservatively withholds all applicable roster actors on
    that event team for the game, not merely the known partial contributor. All
    attributed subtotals remain explicitly labeled; roster listing is never GP.
    """
    if not isinstance(games, list) or not games or len(games) > 4000:
        raise ValueError('Bounded explicit game receipt list required')
    seen = set(); actors = {}; lineages = set(); bad_rosters = []
    for game in games:
        if (game['contract'] != VERSION or game['publishable'] is not False
                or game['model_accepted'] is not False or game['foundation_accepted'] is not False
                or game['receipt_sha256'] != fingerprint({k: v for k, v in game.items() if k != 'receipt_sha256'})
                or game['game_id'] in seen):
            raise ValueError('Unique unchanged nonpromoting game receipts required')
        seen.add(game['game_id']); lineages.add(fingerprint(game['lineage']))
        if game['roster_reason']: bad_rosters.append(game['game_id'])
        # Missing roster means actor membership itself is unknown; do not fabricate it.
        for role in ('shooter', 'defending_goalie'):
            unresolved = {r[role]['team_id'] for r in game['events'] if r[role]['status'] == 'unavailable'}
            contributions = defaultdict(list)
            for event in game['events']:
                if event[role]['status'] == 'attributed': contributions[event[role]['player_id']].append(event)
            for roster in game['roster']:
                if role == 'defending_goalie' and roster['position'] != 'G': continue
                key = game['season'], game['game_type'], role, roster['player_id']
                actor = actors.setdefault(key, {'stints': {}, 'game_ids': [], 'incomplete_game_ids': [], 'values': [], 'goals': 0, 'events': 0})
                team = roster['team_id']
                stint = actor['stints'].setdefault(team, {'game_ids': [], 'incomplete_game_ids': [], 'values': [], 'goals': 0, 'events': 0})
                rows = contributions[roster['player_id']]
                for target in (actor, stint):
                    target['game_ids'].append(game['game_id'])
                    if None in unresolved or team in unresolved: target['incomplete_game_ids'].append(game['game_id'])
                    target['values'].extend(r['probability'] for r in rows)
                    target['events'] += len(rows); target['goals'] += sum(r['is_goal'] for r in rows)
    if len(lineages) != 1: raise ValueError('Aggregate cannot mix model/feature lineage')
    def finish(actor):
        complete = not actor['incomplete_game_ids'] and not bad_rosters
        subtotal = math.fsum(actor['values'])
        return {'availability': 'available' if complete else 'unavailable',
            'reason': 'complete_eligible_event_attribution' if complete else 'incomplete_actor_attribution_or_roster',
            'eligible_event_xg': subtotal if complete else None,
            'eligible_event_count': actor['events'] if complete else None,
            'eligible_event_goals': actor['goals'] if complete else None,
            'attributed_xg_subtotal': subtotal, 'attributed_event_subtotal': actor['events'],
            'attributed_goal_subtotal': actor['goals'], 'roster_listed_game_ids': sorted(actor['game_ids']),
            'incomplete_game_ids': sorted(actor['incomplete_game_ids']),
            'appearance_games': None, 'toi_seconds': None, 'xg_per60': None,
            'exposure_reason': 'roster_listing_and_attempts_are_not_appearance_or_toi'}
    rows = [{'season': season, 'game_type': kind, 'role': role, 'player_id': pid, **finish(actor),
             'team_stints': [{'team_id': team, **finish(stint)} for team, stint in sorted(actor['stints'].items())]}
            for (season, kind, role, pid), actor in sorted(actors.items())]
    body = {'contract': VERSION + ':aggregate', 'publishable': False, 'model_accepted': False,
        'foundation_accepted': False, 'game_ids': sorted(seen), 'unknown_roster_game_ids': sorted(bad_rosters),
        'lineage_sha256': next(iter(lineages)), 'rows': rows,
        'complete_roster_population': not bad_rosters,
        'population': 'listed_actors_in_selected_games_not_full_season_appearances'}
    return {**body, 'aggregate_sha256': fingerprint(body)}
