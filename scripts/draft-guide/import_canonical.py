"""Convert an explicit canonical revision to a separate, DRAFT guide snapshot.

python import_canonical.py canonical.json --revision HASH --output draft-data.json
Editorial text/weights default to the existing workbook snapshot (read only).
This offline adapter never establishes publication approval or writes production.
"""
import argparse
from copy import deepcopy
from hashlib import sha256
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VERSION = 'citrus.canonical-projection-inputs.v1'
SKATER = {'goals', 'assists', 'power_play_points', 'short_handed_points',
          'shots_on_goal', 'blocks', 'hits', 'penalty_minutes'}
GOALIE = {'wins', 'saves', 'shutouts', 'goals_against'}


def digest(document):
    return sha256(json.dumps({k: v for k, v in document.items() if k != 'revision'},
                            sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def finite(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f'{label}: finite numeric value required')
    return value


def effective_exposure(player):
    """A derived runtime owns remaining exposure; the original stays provenance."""
    if 'remaining' in player:
        return player['remaining']['used']
    return player['exposure']['used']


def validate(document, revision, *, revision_preimage=None):
    if document.get('schema_version') != VERSION:
        raise ValueError('Unsupported canonical schema')
    algorithm = document.get('revision_algorithm')
    if algorithm == 'sha256_postgres_jsonb_v1':
        # PostgreSQL's numeric/text serialization is not Python's JSON serializer.
        # Verify the exact exported preimage AND its parsed payload, never a flag.
        valid = (isinstance(revision_preimage, str)
                 and sha256(revision_preimage.encode()).hexdigest() == revision
                 and json.loads(revision_preimage) == {k: v for k, v in document.items() if k != 'revision'})
    elif algorithm is None:
        valid = digest(document) == revision
    else:
        raise ValueError('Unsupported canonical revision algorithm')
    if not revision or document.get('revision') != revision or not valid:
        raise ValueError('Canonical revision mismatch')
    players = {}
    for p in document['players']:
        pid = p['player_id']
        if not isinstance(pid, str) or not pid or pid in players:
            raise ValueError('Missing or duplicate canonical player ID')
        players[pid] = p
        if type(p['is_goalie']) is not bool or p['status'] not in {'projected', 'rates_only', 'unresolved'}:
            raise ValueError(f'{pid}: invalid player status')
        allowed = GOALIE if p['is_goalie'] else SKATER | {'plus_minus'}
        if set(p['rates']) - allowed:
            raise ValueError(f'{pid}: unknown rate fields')
        for key, value in p['rates'].items():
            if finite(value, key) < 0 and key != 'plus_minus':
                raise ValueError(f'{pid}: negative category rate')
        exposure = p['exposure']
        used = effective_exposure(p)
        if exposure['unit'] != ('starts' if p['is_goalie'] else 'games'):
            raise ValueError(f'{pid}: wrong exposure unit')
        if exposure['probability_semantics'] not in {'metadata_only', 'already_in_exposure', 'unknown'}:
            raise ValueError(f'{pid}: unknown probability semantics')
        if used is not None and not 0 <= finite(used, 'exposure') <= document['schedule'].get(p['team'], 84):
            raise ValueError(f'{pid}: invalid exposure')
        if 'remaining' in p:
            remaining = p['remaining']
            if not 0 <= finite(remaining['team_games'], 'remaining team games') <= document['schedule'][p['team']]:
                raise ValueError(f'{pid}: invalid remaining schedule')
            if used is not None and used > remaining['team_games']:
                raise ValueError(f'{pid}: exposure exceeds remaining schedule')
        elif algorithm == 'sha256_postgres_jsonb_v1' and p['status'] == 'projected':
            raise ValueError(f'{pid}: runtime projected player lacks remaining horizon')
        probability = exposure.get('roster_probability')
        if probability is not None and not 0 <= finite(probability, 'probability') <= 1:
            raise ValueError(f'{pid}: invalid probability')
        if p['status'] == 'projected':
            if used is None or p['counts'] is None or (used > 0 and not p['rates']):
                raise ValueError(f'{pid}: projected requires supported exposure/counts')
            if set(p['rates']) - set(p['counts']):
                raise ValueError(f'{pid}: missing derived counts')
            for key, count in p['counts'].items():
                if key not in allowed or (key not in p['rates'] and used != 0):
                    raise ValueError(f'{pid}: unsupported derived count')
                if abs(finite(count, key) - p['rates'].get(key, 0) * used) > 1e-8:
                    raise ValueError(f'{pid}: count differs from rate times exposure')
        elif p['counts'] is not None:
            raise ValueError(f'{pid}: unavailable forecast carries counts')
    teams = document['teams']
    if len({t['team'] for t in teams}) != len(teams) or {t['team'] for t in teams} != set(document['schedule']):
        raise ValueError('Canonical team/schedule coverage mismatch')
    for team in teams:
        for slot in team['lineup_slots']:
            pid = slot.get('player_id')
            if pid is not None and (pid not in players or players[pid]['team'] != team['team']):
                raise ValueError('Canonical lineup identity/team mismatch')
    return players


def convert(document, editorial, revision, *, source_name='canonical.json', revision_preimage=None, runtime_run_id=None):
    """No fuzzy identities, exposure guessing, probability scaling, or publication."""
    canonical = validate(document, revision, revision_preimage=revision_preimage)
    result = deepcopy(editorial)
    # Previous rank/score caches and editorial lineups are not canonical forecasts.
    previous = {p['name']: p for p in editorial['players']}
    result['players'] = []
    for p in document['players']:
        old = previous.get(p['name'], {})
        exposure = p['exposure']
        rates = {k: v for k, v in p['rates'].items() if k in (GOALIE if p['is_goalie'] else SKATER | {'plus_minus'})}
        source = p.get('workbook_input') or {}
        result['players'].append({
            'key': 'canonical:' + p['player_id'], 'playerId': p['player_id'],
            'name': p['name'], 'team': p['team'], 'position': p['position'],
            'isGoalie': p['is_goalie'], 'source': p['provenance'], 'tier': old.get('tier'),
            'baseGames': 1, 'games': effective_exposure(p), 'stats': deepcopy(rates),
            'rosterProbability': exposure.get('roster_probability'),
            'line': p['role'].get('line'), 'powerPlay': p['role'].get('pp'),
            'note': p['role'].get('notes'), 'confidence': None,
            'sourceRank': None, 'sourceFantasyPoints': None, 'sourceRow': source.get('row'),
            'forecastStatus': p['status'], 'availability': deepcopy(p['availability']),
            'exposureSemantics': exposure['probability_semantics'],
            'canonicalExposure': deepcopy(exposure), 'canonicalRates': deepcopy(p['rates']),
            'canonicalRemaining': deepcopy(p.get('remaining')),
            'canonicalCounts': deepcopy(p['counts']), 'canonicalRole': deepcopy(p['role']),
            'canonicalSources': deepcopy(p['sources']), 'canonicalIssues': deepcopy(p.get('issues', [])),
            'ratePolicy': p['rate_policy'], 'exposurePolicy': p['exposure_policy'],
            'legacyOverrides': deepcopy(p.get('legacy_overrides', [])),
            'unscoredCategories': sorted(set(p['rates']) - set(rates)),
            'zeroExposureWithoutRates': effective_exposure(p) == 0 and not p['rates'],
        })
    result['teams'] = []
    for team in document['teams']:
        notes = deepcopy(team['notes'])
        # Preserve source note coordinates. Never copy old numeric team columns.
        highest = max([3] + [n.get('row', 0) for n in notes] + [s['row'] for s in team['lineup_slots']])
        raw = [[None] * 18 for _ in range(highest)]
        for note in notes:
            r, c = note.get('row'), note.get('column')
            if isinstance(r, int) and isinstance(c, int) and 1 <= r <= highest and 1 <= c <= 18:
                raw[r - 1][c - 1] = note.get('text')
        slots = []
        for slot in team['lineup_slots']:
            s = deepcopy(slot)
            player = canonical.get(slot.get('player_id'))
            # An unresolved imported name must never accidentally join a known player.
            s['name'] = player['name'] if player else 'Unassigned / ' + str(slot.get('imported_name') or 'unresolved')
            s['key'] = 'canonical:' + player['player_id'] if player else None
            row = raw[slot['row'] - 1]
            row[0:3] = [slot.get('slot'), slot['position'], s['name']]
            row[3:17] = [None] * 14
            if slot.get('notes') is not None:
                row[17] = slot['notes']
            slots.append(s)
        result['teams'].append({
            'team': team['team'], 'title': raw[0][0] or team['team'],
            'intro': raw[1][0] or '', 'rawRows': raw, 'sections': [],
            'lineupSlots': slots, 'canonicalNotes': notes,
            'specialTeams': deepcopy(team['special_teams']),
            'snapshotStatus': team['snapshot_status'], 'sources': deepcopy(team['sources']),
        })
    names = {p['name']: [] for p in document['players']}
    for p in document['players']:
        names[p['name']].append(p['player_id'])
    for rookie in result.get('rookies', []):
        matches = names.get(rookie['name'], [])
        rookie['playerId'] = matches[0] if len(matches) == 1 else None
        rookie['key'] = 'canonical:' + matches[0] if len(matches) == 1 else None
    result['source'] = {
        'name': source_name, 'sha256': revision, 'canonicalRevision': revision,
        'asOf': document['as_of'], 'schemaVersion': VERSION,
        'editorialSource': deepcopy(editorial['source']),
        'inputSha256': deepcopy(document['input_sha256']),
    }
    result['canonicalRevision'] = revision
    if document.get('revision_algorithm') == 'sha256_postgres_jsonb_v1':
        if not document.get('source_revision') or not document.get('refresh_at'):
            raise ValueError('Runtime requires source revision and refresh timestamp')
        dates = {p['remaining']['as_of'] for p in document['players'] if 'remaining' in p}
        if len(dates) != 1:
            raise ValueError('Runtime remaining horizons must share one as-of date')
        result['edition'] = {
            'kind': 'effective_runtime', 'parentSourceRevision': document['source_revision'],
            'runtimeRevision': revision, 'runtimeRunId': runtime_run_id,
            'asOf': next(iter(dates)), 'refreshedAt': document['refresh_at'],
            'sourceAsOf': document['as_of'], 'horizon': 'remaining_season',
        }
        result['source'].update({'sourceRevision': document['source_revision'],
                                'asOf': result['edition']['asOf'],
                                'revisionAlgorithm': document['revision_algorithm']})
    result['schedule'] = deepcopy(document['schedule'])
    schedule = set(document['schedule'].values())
    result['seasonGames'] = next(iter(schedule)) if len(schedule) == 1 else None
    result['season'] = document['season']
    result['publication'] = {
        'status': 'draft', 'label': 'DRAFT — local scoring review; export is not a publication action',
        'publicationReady': False, 'sourcePublicationReady': document['contract']['publication_ready'],
        'reason': 'Offline import does not independently establish live publication status.',
        'blockers': deepcopy(document['publish_blockers']),
    }
    result['canonicalContract'] = deepcopy(document['contract'])
    result['teamLedger'] = deepcopy(document['team_ledger'])
    result['coverage'] = deepcopy(document['coverage'])
    result['readMe'] = [result['publication']['label'],
                        'Canonical rates use exposure baseline 1 in this guide adapter. Original baseline is retained as provenance.',
                        'Null exposure is unavailable, never zero. Probability and availability never add a second multiplier.'] + result.get('readMe', [])
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('canonical', type=Path)
    parser.add_argument('--revision', required=True, help='Exact canonical revision to import')
    parser.add_argument('--editorial', type=Path, default=ROOT / 'workbook-data.json')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--revision-preimage', type=Path, help='Exact PostgreSQL (payload-minus-revision)::text export')
    parser.add_argument('--runtime-run-id', help='Run ID from the matching runtime export receipt')
    args = parser.parse_args()
    protected = {args.canonical.resolve(), args.editorial.resolve(), (ROOT / 'workbook-data.json').resolve()}
    if args.output.resolve() in protected:
        parser.error('Output must be separate from canonical and existing workbook snapshots')
    document = json.loads(args.canonical.read_text())
    editorial = json.loads(args.editorial.read_text())
    result = convert(document, editorial, args.revision, source_name=args.canonical.name,
                     revision_preimage=args.revision_preimage.read_text() if args.revision_preimage else None,
                     runtime_run_id=args.runtime_run_id)
    # Refuse accidental overwrite of an earlier review artifact.
    with args.output.open('x') as out:
        json.dump(result, out, ensure_ascii=False, indent=2, allow_nan=False)
        out.write('\n')
    print(f'DRAFT: {len(result["players"])} players, revision {args.revision}, output {args.output}')


if __name__ == '__main__':
    main()
