"""Deterministic, offline canonical projection inputs; never writes to a database.

Priority: reviewed workbook edits > immutable source workbook > model snapshot.
The legacy override JSON is preserved as evidence, not reapplied over later edits.
Counts are rate * explicit exposure exactly once; roster probability is metadata.
Unallocated goalie model priors never become extra starts in a team's crease.
"""
from __future__ import annotations
import argparse
from collections import Counter
from hashlib import sha256
import json
import re
from copy import deepcopy
from math import isfinite
from pathlib import Path
from typing import Literal, TypedDict

from projection_contract import ContractError

# Optional context is recognized by its source label AND auditable metadata.
# An active or unknown label can never become optional through a false flag.
OPTIONAL_SLOT_LABELS = {'third', 'note', 'notes', 'ltir', 'ir', 'out', 'dtd',
                        'day-to-day', 'no timeline', 'injured', 'suspended'}
OPTIONAL_SLOT_CLASSES = {'identified_depth', 'alternative_depth', 'unknown_depth',
                         'non_roster_note', 'availability_note', 'vacant_after_transfer'}


def has_evidence(value):
    return isinstance(value, list) and bool(value) and all(
        (isinstance(v, dict) and bool(v)) or (isinstance(v, str) and bool(v.strip())) for v in value)


def optional_lineup_context(slot):
    context = slot.get('source_reconciliation')
    return (str(slot.get('slot', '')).strip().lower() in OPTIONAL_SLOT_LABELS
        and isinstance(context, dict) and context.get('classification') in OPTIONAL_SLOT_CLASSES
        and context.get('counts_toward_active_lineup') is False
        and 'selected_player_id' in context and context['selected_player_id'] is None
        and has_evidence(context.get('evidence')))


def lineup_coverage_issues(players, teams):
    by_id = {p['player_id']: p for p in players}
    return [{'team': t['team'], 'row': slot.get('row')} for t in teams for slot in t['lineup_slots']
        if not optional_lineup_context(slot) and (slot.get('snapshot_status') == 'unresolved'
            or slot.get('player_id') not in by_id
            or by_id[slot['player_id']]['team'] != t['team']
            or by_id[slot['player_id']]['status'] != 'projected')]


def unavailable_profile_audited(player, teams):
    # Existing source/issue fields explain why an identity remains visible without numbers.
    return (has_evidence(player.get('sources')) and has_evidence(player.get('issues'))
        and not any(slot.get('player_id') == player['player_id'] and not optional_lineup_context(slot)
                    for team in teams for slot in team['lineup_slots']))


def coverage_blockers(players, teams):
    required = {slot.get('player_id') for team in teams for slot in team['lineup_slots']
                if not optional_lineup_context(slot)}
    entries = [
        {'code': 'UNALLOCATED_GOALIES', 'player_ids': [p['player_id'] for p in players
            if p['is_goalie'] and p['exposure']['used'] is None and p['player_id'] in required]},
        {'code': 'UNRESOLVED_FORECAST', 'player_ids': [p['player_id'] for p in players
            if p['status'] == 'unresolved' and not unavailable_profile_audited(p, teams)]},
        {'code': 'UNREVIEWED_LINEUP_SLOTS', 'slots': lineup_coverage_issues(players, teams)},
    ]
    return [entry for entry in entries if entry.get('player_ids') or entry.get('slots')]


VERSION = 'citrus.canonical-projection-inputs.v1'
SKATER_COLS = {'goals': 11, 'assists': 12, 'shots_on_goal': 14,
               'power_play_points': 15, 'short_handed_points': 16,
               'hits': 17, 'blocks': 18, 'penalty_minutes': 19}
GOALIE_COLS = {'wins': 10, 'saves': 11, 'shutouts': 12, 'goals_against': 13}
MODEL_KEYS = {'goals': 'r_goal', 'assists': 'r_a', 'shots_on_goal': 'r_sog',
              'power_play_points': 'r_ppp', 'short_handed_points': 'r_shp',
              'hits': 'r_hits', 'blocks': 'r_blk', 'penalty_minutes': 'r_pim',
              'plus_minus': 'r_pm', 'wins': 'r_wins', 'saves': 'r_saves',
              'shutouts': 'r_so', 'goals_against': 'r_ga'}
# Exact NHL player profile identities verified 2026-09-12. Profiles establish
# identity only; they do not establish opening roster slots or forecast rates.
IDENTITIES = {
    'Tij Iginla': ('8484795', 'https://www.nhl.com/player/tij-iginla-8484795/stats'),
    'Matt Dumba': ('8476856', 'https://www.nhl.com/player/mathew-dumba-8476856/stats'),
    'Caleb Desnoyers': ('8485387', 'https://www.nhl.com/player/caleb-desnoyers-8485387/stats'),
}

class Exposure(TypedDict):
    kind: Literal['workbook_override', 'model_prior', 'unallocated']
    unit: Literal['games', 'starts']
    baseline: float | None
    used: float | None
    roster_probability: float | None
    probability_semantics: Literal['metadata_only', 'already_in_exposure', 'unknown']

class Availability(TypedDict):
    status: Literal['active', 'healthy', 'injured', 'out', 'ir', 'ltir', 'day_to_day', 'suspended', 'unknown']
    as_of: str
    reason: str | None
    source: dict | None
    return_window: str | None
    review_after: str | None
    authority: Literal['verified', 'reviewed_report', 'imported_scenario', 'unknown']


class CanonicalPlayer(TypedDict):
    player_id: str
    name: str
    team: str | None
    position: str
    is_goalie: bool
    status: Literal['projected', 'rates_only', 'unresolved']
    provenance: Literal['MODEL', 'MANUAL', 'DEFAULT']
    rates: dict[str, float]
    counts: dict[str, float] | None
    exposure: Exposure
    role: dict
    sources: list[dict]
    issues: list[str]
    availability: Availability
    rate_policy: Literal['refresh_model', 'refresh_cohort', 'preserve_override']
    exposure_policy: Literal['preserve_season_override', 'model_remaining', 'unallocated']


def number(value, label):
    if isinstance(value, bool):
        raise ContractError(f'{label}: boolean is not a number')
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise ContractError(f'{label}: finite number required') from exc
    if not isfinite(result):
        raise ContractError(f'{label}: finite number required')
    return result


def unique_ids(rows, label):
    result = {}
    for row in rows:
        pid = str(row['player_id'])
        if not pid.isdigit() or int(pid) <= 0 or pid in result:
            raise ContractError(f'{label}: invalid or duplicate ID {pid}')
        result[pid] = row
    return result


def normalize_counts(counts, baseline, used):
    """No schedule rebasing or roster-probability multiplication is allowed."""
    baseline, used = number(baseline, 'baseline'), number(used, 'used')
    if baseline < 0 or used < 0:
        raise ContractError('Exposure cannot be negative')
    values = {k: number(v, k) for k, v in counts.items() if v is not None}
    if baseline == 0:
        if used != 0 or any(values.values()):
            raise ContractError('Zero baseline requires zero exposure and zero counts')
        # Zero exposure is supported; a per-game rate cannot be inferred.
        return {}, values
    rates = {k: v / baseline for k, v in values.items()}
    return rates, {k: v * used for k, v in rates.items()}


def build(input_dir: Path):
    files = ['edits.json', 'workbook-full.json', 'model.json', 'directory.json',
             'roster-findings.json', 'overrides.json']
    raw = {f: (input_dir / f).read_bytes() for f in files}
    inputs = {f: json.loads(data) for f, data in raw.items()}
    hashes = {f: sha256(data).hexdigest() for f, data in raw.items()}
    edits, workbook, facts = inputs['edits.json'], inputs['workbook-full.json'], inputs['roster-findings.json']
    directory = unique_ids(inputs['directory.json'], 'directory')
    models = unique_ids(inputs['model.json'], 'model')
    default_ids = {str(pid) for pid in edits['defaults']}
    schedule = {r['team']: number(r['games'], 'schedule') for r in edits['schedule']}
    if len(schedule) != len(edits['schedule']) or any(g <= 0 for g in schedule.values()):
        raise ContractError('Invalid schedule')
    by_id, unresolved = {}, []
    overrides = {}
    for kind in ['skater_overrides', 'goalie_overrides']:
        for override in inputs['overrides.json'][kind]:
            overrides.setdefault(override['player'], []).append(override)
    def source(file, locator):
        return {'file': file, 'sha256': hashes[file], 'locator': locator}
    for index, p in enumerate(edits['players']):
        primary = IDENTITIES.get(p['name'])
        pid = str(p['id']) if p['id'] is not None else primary[0] if primary else None
        if pid is None:
            unresolved.append({'name': p['name'], 'reason': 'No verified stable identity', 'input': p})
            continue
        if pid in by_id:
            raise ContractError(f'Duplicate workbook player ID {pid}')
        if p['source'] not in {'MODEL', 'MANUAL', 'DEFAULT'}:
            raise ContractError(f'Unknown provenance for {pid}')
        goalie = p['sheet'] == 'Goalies'
        cols = GOALIE_COLS if goalie else SKATER_COLS
        values = p['values'] if p['added'] else workbook[p['sheet']]['values'][p['row'] - 1]
        if values[2] != p['name']:
            raise ContractError(f'Workbook row/name mismatch for {pid}')
        base, used = number(p['base'], 'baseline'), number(p['volume'], 'volume')
        if used > schedule.get(p['team'], 84):
            raise ContractError(f'Exposure exceeds schedule: {pid}')
        probability = p['roster']
        if probability is not None and not 0 <= number(probability, 'roster probability') <= 1:
            raise ContractError(f'Roster probability must use [0,1]: {pid}')
        rates, counts = normalize_counts({stat: values[col] for stat, col in cols.items()}, base, used)
        issues = ['Projected roles are scenarios; camp directory membership does not confirm an opening slot.']
        if base == 0:
            issues.append('Zero-exposure scenario retained; conditional performance rates unavailable.')
        if len(counts) != len(cols):
            issues.append('One or more component counts unavailable; missing does not mean zero.')
        evidence = [x for x in facts['findings'] if x['name'] == p['name']]
        for finding in evidence:
            if finding.get('status') != 'verified':
                issues.append('Affiliation unresolved: ' + finding.get('rationale', ''))
        sources = [source('edits.json', f'players[{index}]'),
                   source('workbook-full.json', f"{p['sheet']}!row{p['row']}")]
        if p['added']:
            sources[1] = source('model.json', f'player_id={pid}; per-game/start rates')
        if primary:
            sources.append({'evidence_url': primary[1], 'purpose': 'identity only'})
        if p.get('source_url'):
            sources.append({'evidence_url': p['source_url'], 'purpose': 'affiliation evidence; not role confirmation'})
        legacy = overrides.get(p['name'], [])
        if legacy:
            sources.append(source('overrides.json', p['name']))
        record = CanonicalPlayer(player_id=pid, name=p['name'], team=p['team'], position=p['pos'],
            is_goalie=goalie, status='projected', provenance=p['source'], rates=rates, counts=counts,
            exposure=Exposure(kind='workbook_override', unit='starts' if goalie else 'games',
                baseline=base, used=used, roster_probability=probability,
                probability_semantics='already_in_exposure' if p['added'] and p['source'] == 'DEFAULT' else 'metadata_only'),
            role={'line': p['line'], 'pp': p['pp'], 'conditioned': False,
                  'notes': p['note'], 'evidence': evidence + [x for x in facts.get('injury_checks', []) if x['name'] == p['name']],
                  'not_conditioned_reason': 'No measured role conditioning; inherited manual judgment preserved.'},
            sources=sources, issues=issues)
        record['legacy_overrides'] = legacy
        record['workbook_input'] = p  # Retain every manual field and exact numerical basis for audit.
        record['directory_present'] = pid in directory
        by_id[pid] = record
    for pid, d in directory.items():
        if pid in by_id:
            continue
        m = models.get(pid)
        goalie = bool(d['is_goalie'])
        cols = list(GOALIE_COLS) if goalie else [*SKATER_COLS, 'plus_minus']
        rates = {stat: number(m[MODEL_KEYS[stat]], stat) for stat in cols
                 if m and m.get(MODEL_KEYS[stat]) is not None}
        # exp_starts is an individual historical/cohort prior, NOT a reconciled
        # crease allocation. Leave it explicit but never grant it season starts.
        used = number(m['exp_gp'], 'model exp_gp') if m and not goalie else None
        if used is not None and not 0 <= used <= schedule.get(d['team_abbrev'], 84):
            raise ContractError(f'Model GP outside schedule: {pid}')
        counts = {stat: rate * used for stat, rate in rates.items()} if rates and used is not None else None
        record = CanonicalPlayer(player_id=pid, name=d['full_name'], team=d['team_abbrev'],
            position=d['position_code'], is_goalie=goalie,
            status='projected' if counts is not None else 'rates_only' if rates else 'unresolved',
            provenance='DEFAULT' if pid in default_ids else 'MODEL', rates=rates, counts=counts,
            exposure=Exposure(kind='unallocated' if goalie else 'model_prior',
                unit='starts' if goalie else 'games', baseline=1 if rates else None, used=used,
                roster_probability=None, probability_semantics='already_in_exposure' if pid in default_ids else 'unknown'),
            role={'line': None, 'pp': None, 'conditioned': False, 'notes': None, 'evidence': [],
                  'not_conditioned_reason': 'Historical/cohort rates; no opening roster or role conditioning.'},
            sources=[source('directory.json', f'player_id={pid}'), source('model.json', f'player_id={pid}')],
            issues=['Outside curated workbook; camp candidates overlap and are not confirmed opening roster slots.'])
        record['directory_present'] = True
        record['model_exposure_prior'] = {'games': m.get('exp_gp'), 'starts': m.get('exp_starts')} if m else None
        if goalie:
            record['issues'].append('No canonical crease allocation; source starts prior not applied.')
        by_id[pid] = record
    # Required rookie profile is outside both source populations. Identity is
    # established, but no defensible projection is created from junior totals.
    if 'Caleb Desnoyers' in str(edits['issues']):
        name = 'Caleb Desnoyers'; pid, url = IDENTITIES[name]
        by_id.setdefault(pid, CanonicalPlayer(player_id=pid, name=name, team='UTA', position='C',
            is_goalie=False, status='unresolved', provenance='DEFAULT', rates={}, counts=None,
            exposure=Exposure(kind='unallocated', unit='games', baseline=None, used=None,
                              roster_probability=None, probability_semantics='unknown'),
            role={'line': None, 'pp': None, 'conditioned': False, 'notes': None,
                  'evidence': [facts.get('caleb_desnoyers_support')],
                  'not_conditioned_reason': 'No supported forecast or opening roster allocation.'},
            sources=[{'evidence_url': url, 'purpose': 'identity only'}],
            issues=['Verified identity; no model, directory, or manual numerical forecast available.']))
    players = sorted(by_id.values(), key=lambda r: int(r['player_id']))
    for record in players:
        record['rate_policy'] = {'MODEL': 'refresh_model', 'DEFAULT': 'refresh_cohort',
                                 'MANUAL': 'preserve_override'}[record['provenance']]
        record['exposure_policy'] = ('preserve_season_override' if 'workbook_input' in record
            else 'model_remaining' if record['status'] == 'projected' else 'unallocated')
    # Team cells are a reviewable snapshot, never automatic medical diagnosis.
    teams = []
    status_map = {'active': 'active', 'out': 'out', 'ir': 'ir', 'ltir': 'ltir',
                  'day to day': 'day_to_day', 'day-to-day': 'day_to_day',
                  'dtd': 'day_to_day', 'suspended': 'suspended'}
    teamrows = {(r['sheet'], r['row']): r for r in edits['teamrows']}
    name_ids = {}
    for r in players:
        name_ids.setdefault(r['name'], []).append(r['player_id'])
        r['availability'] = {'status': 'unknown', 'as_of': facts['as_of'], 'reason': None,
            'source': None, 'return_window': None, 'review_after': None, 'authority': 'unknown'}
    patched = deepcopy(workbook)
    for patch in edits['patches']:
        if patch['sheet'] not in schedule:
            continue
        match = re.fullmatch(r'([A-Z]+)([0-9]+)', patch['cell'])
        if not match:
            raise ContractError('Invalid workbook patch cell')
        column = 0
        for char in match[1]:
            column = column * 26 + ord(char) - 64
        rows = patched[patch['sheet']]['values']
        while len(rows) < int(match[2]):
            rows.append([])
        row = rows[int(match[2]) - 1]
        while len(row) < column:
            row.append(None)
        row[column - 1] = patch['value']
    for team in sorted(schedule):
        rows = patched[team]['values']
        slots, notes = [], []
        line = None
        for row_number, row in enumerate(rows, 1):
            row = row + [None] * max(0, 18 - len(row))
            context = source('workbook-full.json', f'{team}!row{row_number}')
            # Every original qualitative cell survives without shortening or
            # transforming inherited current-tense assertions into verification.
            for col, value in enumerate(row):
                if isinstance(value, str) and value:
                    notes.append({'row': row_number, 'column': col + 1, 'text': value,
                                  'authority': 'imported_scenario'})
            if row[1] not in {'C', 'LW', 'RW', 'LD', 'RD', 'D', 'G'} or not row[2]:
                continue
            if row[0]:
                line = row[0]
            review = teamrows.get((team, row_number))
            candidate = review.get('player') if review else None
            pid = str(candidate['id']) if candidate and candidate.get('id') is not None else None
            if pid is None and len(name_ids.get(row[2], [])) == 1:
                pid = name_ids[row[2]][0]
            valid = pid in by_id and by_id[pid]['team'] == team and (review is None or review['valid'])
            slot = {'row': row_number, 'slot': line, 'position': row[1],
                'player_id': pid if valid else None, 'imported_name': row[2],
                'snapshot_status': 'assumed' if valid else 'unresolved',
                'notes': row[17], 'source': context}
            slots.append(slot)
            status = status_map.get(str(row[0] or '').strip().lower())
            if valid and status:
                by_id[pid]['availability'] = {'status': status, 'as_of': facts['as_of'],
                    'reason': row[17] if isinstance(row[17], str) else None,
                    'source': context, 'return_window': None, 'review_after': None,
                    'authority': 'imported_scenario'}
                by_id[pid]['issues'].append('Availability is imported table status; exposure already reflects the retained absence scenario.')
        teams.append({'team': team, 'notes': notes, 'lineup_slots': slots,
            'sources': [source('workbook-full.json', team), source('edits.json', f'patches for {team}')],
            'snapshot_status': 'assumed',
            'special_teams': [{'unit': row[0], 'imported_text': row[2], 'snapshot_status': 'unresolved'}
                for row in rows if row and row[0] in {'PP1', 'PP2', 'PK1', 'PK2'}]})
    ledger = []
    for team, games in sorted(schedule.items()):
        members = [r for r in players if r['team'] == team]
        starts = sum(r['exposure']['used'] or 0 for r in members if r['is_goalie'])
        skater_gp = sum(r['exposure']['used'] or 0 for r in members if not r['is_goalie'])
        ledger.append({'team': team, 'schedule_games': games, 'goalie_starts': starts,
            'starts_delta': starts - games, 'skater_games': skater_gp, 'skater_capacity': games * 18,
            'skater_capacity_delta': skater_gp - games * 18,
            'player_ids': [r['player_id'] for r in members],
            'unallocated_goalie_ids': [r['player_id'] for r in members if r['is_goalie'] and r['exposure']['used'] is None],
            'interpretation': 'Goalie starts conserved. Skater totals are overlapping scenarios, not a calibrated team forecast.'})
    coverage = {'current_directory_players': len(directory), 'workbook_players': len(edits['players']),
        'canonical_players': len(players), 'directory_covered': sum(pid in by_id for pid in directory),
        'workbook_stable_ids': sum('workbook_input' in r for r in players),
        'status_counts': dict(Counter(r['status'] for r in players)),
        'unresolved_identities': unresolved, 'model_only_outside_scope': sorted(set(models) - set(by_id)),
        'lineup_issues': edits['issues']}
    document = {'schema_version': VERSION, 'season': 2026, 'as_of': facts['as_of'],
        'input_sha256': hashes, 'schedule': schedule,
        'scope_player_ids': sorted(directory, key=int), 'players': players, 'teams': teams, 'coverage': coverage, 'team_ledger': ledger,
        'contract': {'count_formula': 'rate * exposure.used; applied exactly once',
            'roster_probability': 'metadata only; never multiply counts implicitly',
            'precedence': 'reviewed edits > source workbook; legacy override records retained, not reapplied',
            'nonworkbook_goalies': 'rates only until explicit crease allocation',
            'publication_ready': False, 'availability': 'Imported status never applies another absence multiplier; GP already incorporates absences',
            'reason': 'Unresolved roster/role scenarios and overlapping skater exposure require review.'}}
    document['publish_blockers'] = coverage_blockers(players, teams) + [
        {'code': 'OVERLAPPING_SKATER_SCENARIOS', 'teams': [t['team'] for t in ledger if t['skater_capacity_delta'] > 0]},
        {'code': 'ROSTER_ROLE_SCENARIOS_NOT_CONFIRMED', 'reason': 'Imported projected lineups require explicit review before publication.'},
    ]
    document['publish_blockers'] = [b for b in document['publish_blockers'] if b.get('reason') or b.get('teams') or b.get('player_ids') or b.get('slots')]
    document['revision'] = sha256(json.dumps(document, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()
    return document


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-dir', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    document = build(args.input_dir)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / 'canonical.json').write_text(json.dumps(document, indent=2, sort_keys=True, allow_nan=False) + '\n')
    for name, rows in [('players', document['players']), ('team-ledger', document['team_ledger'])]:
        (args.output_dir / f'{name}.jsonl').write_text(''.join(json.dumps(r, sort_keys=True, allow_nan=False) + '\n' for r in rows))
    (args.output_dir / 'coverage.json').write_text(json.dumps(document['coverage'], indent=2, sort_keys=True) + '\n')
    print(json.dumps({k: v for k, v in document['coverage'].items() if k not in {'lineup_issues', 'model_only_outside_scope'}}, indent=2))
    print('revision', document['revision'])

if __name__ == '__main__':
    main()
