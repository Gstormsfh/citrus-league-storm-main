"""Offline, revision-guarded review of canonical inputs. Never connects to a database."""
from __future__ import annotations
import argparse
from collections import Counter
from copy import deepcopy
from datetime import date, datetime, timezone
from urllib.parse import urlparse
from hashlib import sha256
import json
import re
from pathlib import Path

from canonical_inputs import VERSION, GOALIE_COLS, SKATER_COLS, number, unique_ids, coverage_blockers, optional_lineup_context, has_evidence
from projection_contract import ContractError, MODEL_GP_CEILING_MARGIN


def digest(document):
    body = {k: v for k, v in document.items() if k != 'revision'}
    return sha256(json.dumps(body, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def strict_number(value, label):
    if type(value) not in (int, float):
        raise ContractError(f'{label}: JSON number required')
    return number(value, label)


def dated_evidence(value, as_of, label):
    if not isinstance(value, list) or not value:
        raise ContractError(f'{label}: dated source evidence required')
    for source in value:
        try:
            if not isinstance(source['date'], str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', source['date']):
                raise ValueError()
            observed = date.fromisoformat(source['date'])
            url = urlparse(source['url'])
            valid = observed <= as_of and url.scheme == 'https' and bool(url.hostname) and not url.username and not url.password
        except (KeyError, TypeError, ValueError):
            valid = False
        if not valid:
            raise ContractError(f'{label}: invalid dated HTTPS evidence')


def validate_opportunity_prior(p, document):
    pid = p['player_id']
    prior = p.get('opportunity_prior')
    required = {'method', 'measured_season', 'cohort_count', 'prior_nhl_gp_min', 'prior_nhl_gp_max',
                'draft_band', 'unscaled_gp', 'cohort_schedule_games', 'pre_cap_gp', 'allocation_factor',
                'final_gp', 'probability_semantics', 'as_of', 'evidence', 'limitations'}
    if not isinstance(prior, dict) or set(prior) != required:
        raise ContractError(f'{pid}: complete opportunity prior required')
    if (p['is_goalie'] or p['status'] != 'projected' or p['rate_policy'] != 'preserve_override'
            or p['exposure']['kind'] != 'model_prior'
            or p['exposure']['probability_semantics'] != 'already_in_exposure'
            or p['exposure'].get('roster_probability') is not None
            or prior['probability_semantics'] != 'already_in_exposure'):
        raise ContractError(f'{pid}: invalid opportunity prior semantics')
    for k in ('method', 'draft_band', 'limitations'):
        if not isinstance(prior[k], str) or not prior[k].strip():
            raise ContractError(f'{pid}: opportunity {k} required')
    for k in ('measured_season', 'cohort_count', 'prior_nhl_gp_min', 'prior_nhl_gp_max'):
        if type(prior[k]) is not int:
            raise ContractError(f'{pid}: opportunity {k} must be integer')
    if not (1900 <= prior['measured_season'] < document['season'] and prior['cohort_count'] >= 20
            and 0 <= prior['prior_nhl_gp_min'] <= prior['prior_nhl_gp_max']):
        raise ContractError(f'{pid}: invalid opportunity cohort')
    try:
        if not isinstance(prior['as_of'], str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', prior['as_of']):
            raise ValueError()
        observed = date.fromisoformat(prior['as_of'])
        if observed > date.today():
            raise ValueError()
    except (TypeError, ValueError):
        raise ContractError(f'{pid}: invalid opportunity review date') from None
    dated_evidence(prior['evidence'], observed, pid)
    values = {k: strict_number(prior[k], k) for k in
              ('unscaled_gp', 'cohort_schedule_games', 'pre_cap_gp', 'allocation_factor', 'final_gp')}
    schedule = document['schedule'][p['team']]
    if not (values['cohort_schedule_games'] > 0 and 0 <= values['unscaled_gp'] <= values['cohort_schedule_games']
            and 0 <= values['allocation_factor'] <= 1 and 0 <= values['final_gp'] <= schedule
            and abs(values['pre_cap_gp'] - values['unscaled_gp'] * schedule / values['cohort_schedule_games']) < 1e-8
            and abs(values['final_gp'] - values['pre_cap_gp'] * values['allocation_factor']) < 1e-8
            and abs(values['final_gp'] - strict_number(p['exposure']['used'], 'exposure.used')) < 1e-8):
        raise ContractError(f'{pid}: opportunity scaling or allocation mismatch')


def validate_rate_basis(p):
    basis = p.get('rate_basis')
    if basis is None:
        return
    if not isinstance(basis, dict) or set(basis) != {'provenance', 'method', 'as_of', 'evidence', 'limitations'}:
        raise ContractError('Complete reviewed rate basis required')
    if basis['provenance'] not in {'DEFAULT', 'MODEL'} or basis['provenance'] != p['provenance']:
        raise ContractError('Reviewed rate provenance mismatch')
    if any(not isinstance(basis[k], str) or not basis[k].strip() for k in ('method', 'limitations')):
        raise ContractError('Reviewed rate method and limitations required')
    try:
        if not isinstance(basis['as_of'], str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', basis['as_of']):
            raise ValueError()
        observed = date.fromisoformat(basis['as_of'])
        if observed > date.today():
            raise ValueError()
    except (TypeError, ValueError):
        raise ContractError('Invalid rate review date') from None
    dated_evidence(basis['evidence'], observed, 'rate basis')


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
        if used is not None and p['team'] not in schedule:
            # Never validate an allocated workload against a literal 84: the
            # schedule is derived per team, and a team that is not in it has
            # no budget to allocate against.
            raise ContractError(f'{pid}: allocated exposure for a team missing from the season schedule')
        if used is not None and not 0 <= strict_number(used, 'exposure') <= schedule[p['team']]:
            raise ContractError(f'{pid}: exposure outside team schedule')
        # The MODEL skater games-played ceiling (projection_contract.MODEL_GP_CEILING_MARGIN):
        # a model skater may use at most one game fewer than its team's schedule.
        # Deliberately 83 of 84 for 2026-27. MANUAL and DEFAULT rows are reviewed
        # by hand and may use the full schedule; goalie starts are bounded by the
        # crease ledger instead.
        if (used is not None and not p['is_goalie'] and p['provenance'] == 'MODEL' and p['status'] == 'projected'
                and strict_number(used, 'exposure') > schedule[p['team']] - MODEL_GP_CEILING_MARGIN + 1e-9):
            raise ContractError(f'{pid}: MODEL exposure exceeds the intentional schedule-{MODEL_GP_CEILING_MARGIN:g} ceiling')
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
        elif p.get('exposure_policy') != 'unallocated':
            raise ContractError(f'{pid}: unavailable forecast requires unallocated policy')
        elif not has_evidence(p.get('sources')):
            raise ContractError(f'{pid}: unavailable forecast requires source evidence')
        elif p['counts'] is not None or used is not None:
            raise ContractError(f'{pid}: unavailable forecasts must not carry exposure or counts')
        if 'issues' in p and (not isinstance(p['issues'], list) or any(not ((isinstance(x, str) and x.strip()) or (isinstance(x, dict) and x)) for x in p['issues'])):
            raise ContractError(f'{pid}: issues must be nonempty evidence records')
        a = p['availability']
        for field in ['as_of', 'reason', 'return_window', 'review_after']:
            if a.get(field) is not None and not isinstance(a[field], str):
                raise ContractError(f'{pid}: availability {field} must be text or null')
        if a.get('source') is not None and not isinstance(a['source'], dict):
            raise ContractError(f'{pid}: availability source must be a structured evidence record')
        if a['status'] not in {'active', 'healthy', 'injured', 'out', 'ir', 'ltir', 'day_to_day', 'suspended', 'unknown'} or a['authority'] not in {'verified', 'reviewed_report', 'imported_scenario', 'unknown'}:
            raise ContractError(f'{pid}: invalid availability')
        if a['authority'] == 'verified' and (not a.get('source') or not a.get('as_of')):
            raise ContractError(f'{pid}: verified availability requires dated evidence')
        if a['authority'] == 'reviewed_report':
            source = a.get('source') or {}
            try:
                observed = date.fromisoformat(a['as_of'])
                deadline = date.fromisoformat(a['review_after'])
                reported = date.fromisoformat(source['source_date'])
                reviewed = date.fromisoformat(source['reviewed_at'])
            except (KeyError, TypeError, ValueError):
                raise ContractError(f'{pid}: reviewed report requires dated evidence and review deadline') from None
            if source.get('kind') == 'manual_confirmation':
                provenance_valid = all(isinstance(source.get(k), str) and source[k].strip()
                                       for k in ('confirmed_by', 'reference', 'file'))
                provenance_valid = provenance_valid and not source.get('url')
                if provenance_valid:
                    provenance_valid = source['file'] == f"Manual confirmation by {source['confirmed_by']}: {source['reference']}"
            else:
                try:
                    url = urlparse(source['url'])
                    provenance_valid = url.scheme == 'https' and bool(url.hostname) and not url.username and not url.password
                except (KeyError, TypeError, ValueError):
                    provenance_valid = False
            if (reported != observed or reviewed < reported or deadline <= observed
                    or (source.get('kind') == 'manual_confirmation' and (deadline <= reviewed or reviewed > datetime.now(timezone.utc).date()))
                    or not provenance_valid
                    or not isinstance(a.get('reason'), str) or not a['reason'].strip()):
                raise ContractError(f'{pid}: invalid reviewed report provenance or freshness boundary')
        if p.get('rate_policy') not in {'refresh_model', 'refresh_cohort', 'preserve_override'} or p.get('exposure_policy') not in {'preserve_season_override', 'model_remaining', 'organization_prior_remaining', 'unallocated'}:
            raise ContractError(f'{pid}: explicit refresh policies required')
        validate_rate_basis(p)
        if p.get('exposure_policy') == 'organization_prior_remaining':
            validate_opportunity_prior(p, document)
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
    document['coverage']['canonical_players'] = len(players)
    if 'scope_player_ids' in document:
        scope = set(document['scope_player_ids'])
        document['coverage']['current_directory_players'] = len(scope)
        document['coverage']['directory_covered'] = len(scope & {p['player_id'] for p in players})
    document['publish_blockers'] = coverage_blockers(players, document['teams']) + [
        {'code': 'OVERLAPPING_SKATER_SCENARIOS', 'teams': [t['team'] for t in ledger if t['skater_capacity_delta'] > 1e-8]},
        {'code': 'GOALIE_BUDGET_MISMATCH', 'teams': [t['team'] for t in ledger if abs(t['starts_delta']) > 1e-8]},
        {'code': 'ROSTER_ROLE_SCENARIOS_NOT_CONFIRMED', 'reason': 'Explicit publication review is required; offline edits cannot activate a run.'},
    ]
    document['publish_blockers'] = [b for b in document['publish_blockers'] if b.get('reason') or b.get('teams') or b.get('player_ids') or b.get('slots')]
    document['contract']['publication_ready'] = False


PLAYER_FIELDS = {'rates', 'exposure', 'availability', 'role', 'status', 'rate_policy', 'exposure_policy', 'team', 'team_assignment', 'opportunity_prior', 'rate_basis', 'issues'}
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
    if set(patch) - {'base_revision', 'reason', 'evidence', 'player_updates', 'team_updates', 'player_additions'}:
        raise ContractError('Unsupported patch field')
    result = deepcopy(document)
    history = []
    known = {p['player_id'] for p in result['players']}
    for addition in patch.get('player_additions', []):
        if not isinstance(addition, dict) or set(addition) != {'player', 'identity_evidence', 'method'}:
            raise ContractError('Player addition requires a player, identity evidence and method')
        player, identity = deepcopy(addition['player']), addition['identity_evidence']
        pid = player.get('player_id') if isinstance(player, dict) else None
        if not isinstance(pid, str) or not pid.isdigit() or int(pid) <= 0 or pid in known:
            raise ContractError(f'Duplicate or invalid added player ID: {pid}')
        required = {'name', 'team', 'position', 'is_goalie', 'status', 'provenance', 'rates', 'counts',
                    'exposure', 'rate_policy', 'exposure_policy', 'availability', 'role', 'sources', 'issues'}
        if required - set(player) or type(player['is_goalie']) is not bool:
            raise ContractError(f'{pid}: complete canonical player record required')
        if not isinstance(identity, dict) or any(identity.get(k) != player.get(k) for k in ('player_id', 'name', 'team')):
            raise ContractError(f'{pid}: identity evidence must match the player and organization')
        try:
            observed = date.fromisoformat(identity['as_of'])
            url = urlparse(identity['url'])
            valid_url = (observed <= date.today() and url.scheme == 'https' and bool(url.hostname)
                         and not url.username and not url.password)
        except (KeyError, TypeError, ValueError):
            valid_url = False
        if not valid_url or not player.get('name') or player.get('team') not in result['schedule']:
            raise ContractError(f'{pid}: dated identity evidence and scheduled organization required')
        if (player.get('provenance') not in {'DEFAULT', 'MANUAL'} or
                player.get('rate_policy') != 'preserve_override' or
                player.get('exposure_policy') != ('preserve_season_override' if player.get('status') == 'projected' else 'unallocated') or
                not isinstance(addition['method'], str) or not addition['method'].strip() or
                not has_evidence(player.get('sources'))):
            raise ContractError(f'{pid}: addition requires preserved, documented non-MODEL estimates')
        result['players'].append(player)
        known.add(pid)
        if 'scope_player_ids' in result and player.get('directory_present') is True:
            result['scope_player_ids'] = sorted(set(result['scope_player_ids']) | {pid})
        history.append({'player_id': pid, 'before': None, 'addition': deepcopy(addition)})
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
                for field, editable in [('lineup_slots', {'player_id', 'notes', 'snapshot_status', 'source_reconciliation'}), ('special_teams', {'snapshot_status'})]:
                    if field not in changes:
                        continue
                    rows, old = changes[field], record[field]
                    if not isinstance(rows, list) or len(rows) != len(old):
                        raise ContractError(f'{field}: retain every original source slot')
                    for row, previous in zip(rows, old):
                        if not isinstance(row, dict) or {k: v for k, v in row.items() if k not in editable} != {k: v for k, v in previous.items() if k not in editable}:
                            raise ContractError(f'{field}: immutable source metadata changed')
                        if 'source_reconciliation' in row and not isinstance(row['source_reconciliation'], dict):
                            raise ContractError('Lineup reconciliation must be structured')
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
                if 'rate_basis' in changes:
                    record['provenance'] = changes['rate_basis'].get('provenance')
                else:
                    record['provenance'] = 'MANUAL'
                    record.pop('rate_basis', None)
            if key == 'player_id' and 'used' in changes.get('exposure', {}):
                record['exposure_policy'] = changes.get('exposure_policy', 'preserve_season_override')
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


PUBLICATION_GATE = 'ROSTER_ROLE_SCENARIOS_NOT_CONFIRMED'


def publication_review(document, *, reason, reviewer, now=None):
    """The explicit publication review, as a recorded step instead of a hand edit.

    apply_patch leaves every edited document behind the publication gate on
    purpose: contract.publication_ready is False and the ROSTER_ROLE gate
    blocker is present, so an offline edit can never activate a run by
    itself. Clearing that gate used to mean editing the JSON by hand, which
    left no record and silently invalidated the revision digest. This
    records who reviewed, why and when in review_history, clears only the
    gate blocker, and re-digests. Any other blocker — coverage, budget,
    overlapping scenarios — still refuses, because those are findings, not
    a gate.
    """
    validate(document)
    if not isinstance(reason, str) or not reason.strip() or not isinstance(reviewer, str) or not reviewer.strip():
        raise ContractError('Publication review needs a reviewer and a reason')
    others = [b for b in document['publish_blockers'] if b.get('code') != PUBLICATION_GATE]
    if others:
        raise ContractError(f'Publication review refused: unresolved blockers {[b.get("code") for b in others]}')
    if document['contract'].get('publication_ready') is True and not any(b.get('code') == PUBLICATION_GATE for b in document['publish_blockers']):
        raise ContractError('Document is already publication-ready')
    result = deepcopy(document)
    result['publish_blockers'] = [b for b in result['publish_blockers'] if b.get('code') != PUBLICATION_GATE]
    result['contract']['publication_ready'] = True
    result['contract']['reason'] = reason.strip()
    result.setdefault('review_history', []).append({
        'base_revision': document['revision'], 'at': now or datetime.now(timezone.utc).isoformat(),
        'publication_review': {'reviewer': reviewer.strip(), 'reason': reason.strip()}, 'updates': []})
    result['revision'] = digest(result)
    validate(result)
    return result


def scope_sync(document, directory_ids, *, reason, reviewer, now=None):
    """Reconcile scope_player_ids with the live player directory.

    The database validator requires scope_player_ids to equal the current
    directory exactly, and the directory refreshes on its own schedule: a
    signing lands between two publications and every later activation fails
    DIRECTORY_COVERAGE_MISMATCH. When the newly listed player already has a
    canonical record (imported before the directory caught up, so
    directory_present was False) this brings him into scope and records it.
    A directory id with no canonical record is refused — that is a
    player_additions review with a full record and identity evidence — and
    so is a scope id the directory no longer carries, because dropping a
    player from scope is a review, not a sync.
    """
    validate(document)
    if not isinstance(reason, str) or not reason.strip() or not isinstance(reviewer, str) or not reviewer.strip():
        raise ContractError('Scope sync needs a reviewer and a reason')
    directory = {str(x) for x in directory_ids}
    if not directory or any(not x.isdigit() for x in directory):
        raise ContractError('Directory ids must be a nonempty list of numeric NHL ids')
    scope = set(document.get('scope_player_ids', []))
    players = {p['player_id']: p for p in document['players']}
    missing_records = sorted(directory - scope - set(players), key=int)
    if missing_records:
        raise ContractError(f'Directory players without a canonical record need a player_additions review: {missing_records}')
    dropped = sorted(scope - directory, key=int)
    if dropped:
        raise ContractError(f'Scope players no longer in the directory need a review, not a sync: {dropped}')
    added = sorted(directory - scope, key=int)
    if not added:
        raise ContractError('Scope already matches the directory')
    result = deepcopy(document)
    history = []
    for pid in added:
        record = next(p for p in result['players'] if p['player_id'] == pid)
        history.append({'player_id': pid, 'before': {'directory_present': record.get('directory_present')}, 'changes': {'directory_present': True}})
        record['directory_present'] = True
    result['scope_player_ids'] = sorted(scope | set(added), key=int)
    result.setdefault('review_history', []).append({'base_revision': document['revision'],
        'at': now or datetime.now(timezone.utc).isoformat(), 'reason': reason.strip(),
        'evidence': [f'player_directory season {document["season"]}: {len(directory)} ids'],
        'scope_sync': {'reviewer': reviewer.strip(), 'added': added}, 'updates': history})
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
    parser.add_argument('command', choices=['validate', 'review', 'apply', 'scope-sync', 'publication-review', 'export', 'history', 'stage-payload'])
    parser.add_argument('--reason')
    parser.add_argument('--reviewer')
    parser.add_argument('--directory', type=Path, help='JSON list of current player_directory ids (scope-sync)')
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
    elif args.command == 'scope-sync':
        if not args.directory or not args.reason or not args.reviewer or not args.output or args.output.resolve() == args.source.resolve():
            parser.error('scope-sync requires --directory, --reason, --reviewer and a new --output path')
        result = scope_sync(document, json.loads(args.directory.read_text()), reason=args.reason, reviewer=args.reviewer)
    elif args.command == 'publication-review':
        if not args.reason or not args.reviewer or not args.output or args.output.resolve() == args.source.resolve():
            parser.error('publication-review requires --reason, --reviewer and a new --output path')
        result = publication_review(document, reason=args.reason, reviewer=args.reviewer)
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
