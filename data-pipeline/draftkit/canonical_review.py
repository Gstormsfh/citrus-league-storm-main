"""Offline, revision-guarded review of canonical inputs. Never connects to a database."""
from __future__ import annotations
import argparse
from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

from canonical_inputs import VERSION, GOALIE_COLS, SKATER_COLS, number, unique_ids
from projection_contract import ContractError


def digest(document):
    body = {k: v for k, v in document.items() if k != 'revision'}
    return sha256(json.dumps(body, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def strict_number(value, label):
    if type(value) not in (int, float):
        raise ContractError(f'{label}: JSON number required')
    return number(value, label)


def validate(document):
    if document.get('schema_version') != VERSION:
        raise ContractError('Unsupported canonical schema')
    if document.get('revision') != digest(document):
        raise ContractError('Revision hash mismatch; source was modified outside the review workflow')
    players = unique_ids(document['players'], 'canonical')
    schedule = document['schedule']
    for p in players.values():
        pid = p['player_id']
        if p['status'] not in {'projected', 'rates_only', 'unresolved'}:
            raise ContractError(f'{pid}: invalid forecast status')
        allowed = set(GOALIE_COLS if p['is_goalie'] else SKATER_COLS) | ({'plus_minus'} if not p['is_goalie'] else set())
        if set(p['rates']) - allowed:
            raise ContractError(f'{pid}: unsupported rate statistic')
        for stat, rate in p['rates'].items():
            if strict_number(rate, stat) < 0 and stat != 'plus_minus':
                raise ContractError(f'{pid}: negative {stat}')
        exposure = p['exposure']
        if exposure['kind'] not in {'workbook_override', 'model_prior', 'unallocated'} or exposure['probability_semantics'] not in {'metadata_only', 'already_in_exposure', 'unknown'}:
            raise ContractError(f'{pid}: invalid exposure semantics')
        if exposure['unit'] != ('starts' if p['is_goalie'] else 'games'):
            raise ContractError(f'{pid}: wrong exposure unit')
        used = exposure['used']
        if used is not None and not 0 <= strict_number(used, 'exposure') <= schedule.get(p['team'], 84):
            raise ContractError(f'{pid}: exposure outside team schedule')
        probability = exposure.get('roster_probability')
        if probability is not None and not 0 <= strict_number(probability, 'roster_probability') <= 1:
            raise ContractError(f'{pid}: probability must be between zero and one')
        if p['status'] == 'projected':
            if used is None or p['counts'] is None or (used > 0 and not p['rates']):
                raise ContractError(f'{pid}: projected requires exposure and rates (or explicit zero exposure)')
            for stat, count in p['counts'].items():
                expected = p['rates'].get(stat, 0) * used
                if stat not in allowed or abs(number(count, stat) - expected) > 1e-8 or (stat not in p['rates'] and used != 0):
                    raise ContractError(f'{pid}: counts differ from rate times exposure')
            if set(p['rates']) - set(p['counts']):
                raise ContractError(f'{pid}: missing derived counts')
        elif p['counts'] is not None or used is not None:
            raise ContractError(f'{pid}: unavailable forecasts must not carry exposure or counts')
        a = p['availability']
        for field in ['as_of', 'reason', 'return_window', 'review_after']:
            if a.get(field) is not None and not isinstance(a[field], str):
                raise ContractError(f'{pid}: availability {field} must be text or null')
        if a.get('source') is not None and not isinstance(a['source'], dict):
            raise ContractError(f'{pid}: availability source must be a structured evidence record')
        if a['status'] not in {'active', 'out', 'ir', 'ltir', 'day_to_day', 'suspended', 'unknown'} or a['authority'] not in {'verified', 'imported_scenario', 'unknown'}:
            raise ContractError(f'{pid}: invalid availability')
        if a['authority'] == 'verified' and (not a.get('source') or not a.get('as_of')):
            raise ContractError(f'{pid}: verified availability requires dated evidence')
        if p.get('rate_policy') not in {'refresh_model', 'refresh_cohort', 'preserve_override'} or p.get('exposure_policy') not in {'preserve_season_override', 'model_remaining', 'unallocated'}:
            raise ContractError(f'{pid}: explicit refresh policies required')
    teams = [t['team'] for t in document['teams']]
    if len(set(teams)) != len(teams) or set(teams) != set(schedule):
        raise ContractError('Team records must exactly cover schedule')
    for t in document['teams']:
        for slot in t['lineup_slots']:
            pid = slot.get('player_id')
            if pid is not None and (pid not in players or players[pid]['team'] != t['team']):
                raise ContractError(f"{t['team']}: lineup identity/team mismatch")
    return {'revision': document['revision'], 'players': len(players),
            'publication_ready': document['contract']['publication_ready'],
            'publish_blockers': document['publish_blockers']}


def rebuild(document):
    """Derived fields cannot be patched by an editor or trusted from old exports."""
    players = document['players']
    for p in players:
        used = p['exposure']['used']
        if p['status'] != 'projected' or used is None:
            p['counts'] = None
        elif p['rates']:
            p['counts'] = {stat: number(rate, stat) * number(used, 'exposure') for stat, rate in p['rates'].items()}
        elif used == 0:
            p['counts'] = {stat: 0 for stat in (p.get('counts') or {})}
    ledger = []
    for team, games in sorted(document['schedule'].items()):
        members = [p for p in players if p['team'] == team]
        starts = sum(p['exposure']['used'] or 0 for p in members if p['is_goalie'])
        gp = sum(p['exposure']['used'] or 0 for p in members if not p['is_goalie'])
        ledger.append({'team': team, 'schedule_games': games, 'goalie_starts': starts,
            'starts_delta': starts-games, 'skater_games': gp, 'skater_capacity': games*18,
            'skater_capacity_delta': gp-games*18, 'player_ids': [p['player_id'] for p in members],
            'unallocated_goalie_ids': [p['player_id'] for p in members if p['is_goalie'] and p['exposure']['used'] is None],
            'interpretation': 'Reviewed exposure ledger; publication blockers remain explicit.'})
    document['team_ledger'] = ledger
    document['coverage']['status_counts'] = dict(Counter(p['status'] for p in players))
    document['publish_blockers'] = [
        {'code': 'UNALLOCATED_GOALIES', 'player_ids': [p['player_id'] for p in players if p['is_goalie'] and p['exposure']['used'] is None]},
        {'code': 'UNRESOLVED_FORECAST', 'player_ids': [p['player_id'] for p in players if p['status'] == 'unresolved']},
        {'code': 'UNREVIEWED_LINEUP_SLOTS', 'slots': [{'team': t['team'], 'row': s['row']} for t in document['teams'] for s in t['lineup_slots'] if s['snapshot_status'] == 'unresolved']},
        {'code': 'OVERLAPPING_SKATER_SCENARIOS', 'teams': [t['team'] for t in ledger if t['skater_capacity_delta'] > 1e-8]},
        {'code': 'GOALIE_BUDGET_MISMATCH', 'teams': [t['team'] for t in ledger if abs(t['starts_delta']) > 1e-8]},
        {'code': 'ROSTER_ROLE_SCENARIOS_NOT_CONFIRMED', 'reason': 'Explicit publication review is required; offline edits cannot activate a run.'},
    ]
    document['contract']['publication_ready'] = False


PLAYER_FIELDS = {'rates', 'exposure', 'availability', 'role', 'status', 'rate_policy', 'exposure_policy', 'team', 'team_assignment'}
TEAM_FIELDS = {'notes', 'lineup_slots', 'special_teams', 'snapshot_status'}
NESTED_FIELDS = {
    'exposure': {'used', 'roster_probability', 'probability_semantics', 'kind'},
    'availability': {'status', 'as_of', 'reason', 'source', 'return_window', 'review_after', 'authority'},
    'role': {'line', 'pp', 'notes', 'evidence'},
}


def apply_patch(document, patch, *, now=None):
    validate(document)
    if patch.get('base_revision') != document['revision']:
        raise ContractError('Stale patch: reload the current canonical revision before editing')
    if not isinstance(patch.get('reason'), str) or not patch['reason'].strip() or not isinstance(patch.get('evidence'), list) or not patch['evidence'] or any(not isinstance(e, str) or not e.strip() for e in patch['evidence']):
        raise ContractError('Every review needs a reason and evidence')
    if set(patch) - {'base_revision', 'reason', 'evidence', 'player_updates', 'team_updates'}:
        raise ContractError('Unsupported patch field')
    result = deepcopy(document)
    history = []
    for field, key, allowed in [('player_updates', 'player_id', PLAYER_FIELDS), ('team_updates', 'team', TEAM_FIELDS)]:
        records = {r[key]: r for r in result['players' if key == 'player_id' else 'teams']}
        seen = set()
        for update in patch.get(field, []):
            identity = update[key]
            if identity in seen or identity not in records:
                raise ContractError(f'Duplicate or unknown {key}: {identity}')
            seen.add(identity)
            changes = update['changes']
            if not isinstance(changes, dict) or not changes or set(changes) - allowed:
                raise ContractError(f'{identity}: unsupported or empty changes')
            record = records[identity]
            before = deepcopy(record)
            if key == 'player_id' and ('team' in changes or 'team_assignment' in changes):
                assignment = changes.get('team_assignment')
                if not isinstance(assignment, dict) or assignment.get('reviewed') is not True or not isinstance(assignment.get('evidence'), str) or not assignment['evidence'].strip():
                    raise ContractError('Team assignment requires explicit reviewed evidence')
                if changes.get('team', record['team']) not in result['schedule']:
                    raise ContractError('Reviewed team must exist in the season schedule')
            if key == 'team' and 'notes' in changes:
                notes = changes['notes']
                old = record['notes']
                if not isinstance(notes, list) or len(notes) < len(old):
                    raise ContractError('Team notes must retain existing source records')
                for index, note in enumerate(notes):
                    if not isinstance(note, dict) or not isinstance(note.get('text'), str):
                        raise ContractError('Team notes require structured records')
                    if index < len(old) and {k: v for k, v in note.items() if k != 'text'} != {k: v for k, v in old[index].items() if k != 'text'}:
                        raise ContractError('Team note coordinates and source evidence are immutable')
                    if index >= len(old) and note.get('authority') != 'manual_review':
                        raise ContractError('New team notes require manual_review authority')
            if key == 'team':
                for field, editable in [('lineup_slots', {'player_id', 'notes', 'snapshot_status'}), ('special_teams', {'snapshot_status'})]:
                    if field not in changes:
                        continue
                    rows, old = changes[field], record[field]
                    if not isinstance(rows, list) or len(rows) != len(old):
                        raise ContractError(f'{field}: retain every original source slot')
                    for row, previous in zip(rows, old):
                        if not isinstance(row, dict) or {k: v for k, v in row.items() if k not in editable} != {k: v for k, v in previous.items() if k not in editable}:
                            raise ContractError(f'{field}: immutable source metadata changed')
                        if row.get('snapshot_status') not in {'assumed', 'unresolved', 'reviewed', 'verified'}:
                            raise ContractError(f'{field}: invalid review status')
            for name, value in changes.items():
                if name in NESTED_FIELDS:
                    if not isinstance(value, dict) or set(value) - NESTED_FIELDS[name]:
                        raise ContractError(f'{identity}: unsupported {name} fields')
                    record[name].update(deepcopy(value))
                else:
                    record[name] = deepcopy(value)
            if key == 'player_id' and 'rates' in changes:
                record['rate_policy'] = 'preserve_override'
                record['provenance'] = 'MANUAL'
            if key == 'player_id' and 'used' in changes.get('exposure', {}):
                record['exposure_policy'] = 'preserve_season_override'
                if record['exposure']['used'] is not None:
                    strict_number(record['exposure']['used'], 'exposure.used')
            history.append({key: identity, 'before': before, 'changes': deepcopy(changes)})
    if not history:
        raise ContractError('Patch contains no changes')
    result.setdefault('review_history', []).append({'base_revision': document['revision'],
        'at': now or datetime.now(timezone.utc).isoformat(), 'reason': patch['reason'],
        'evidence': deepcopy(patch['evidence']), 'updates': history})
    rebuild(result)
    result['revision'] = digest(result)
    validate(result)
    return result


def write_json(path, document):
    # Exclusive creation keeps previous revisions and source snapshots intact.
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x') as handle:
        handle.write(json.dumps(document, indent=2, sort_keys=True, allow_nan=False) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['validate', 'review', 'apply', 'export', 'history', 'stage-payload'])
    parser.add_argument('source', type=Path)
    parser.add_argument('--patch', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--team')
    parser.add_argument('--player-id')
    args = parser.parse_args()
    document = json.loads(args.source.read_text())
    report = validate(document)
    if args.command == 'apply':
        if not args.patch or not args.output or args.output.resolve() == args.source.resolve():
            parser.error('apply requires --patch and a new --output path')
        result = apply_patch(document, json.loads(args.patch.read_text()))
    elif args.command == 'review':
        result = {'revision': document['revision'], 'players': [p for p in document['players']
            if (not args.team or p['team'] == args.team) and (not args.player_id or p['player_id'] == args.player_id)],
            'teams': [t for t in document['teams'] if not args.team or t['team'] == args.team],
            'publish_blockers': document['publish_blockers']}
    elif args.command == 'history':
        result = {'revision': document['revision'], 'history': document.get('review_history', [])}
    elif args.command == 'export':
        result = document
    elif args.command == 'stage-payload':
        result = {'p_payload': document}
    else:
        result = report
    if args.output:
        write_json(args.output, result)
        print(json.dumps({'output': str(args.output.resolve()), 'revision': result.get('revision')}))
    else:
        print(json.dumps(result, indent=2, sort_keys=True, allow_nan=False))


if __name__ == '__main__':
    main()
