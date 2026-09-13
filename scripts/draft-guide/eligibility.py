"""Fingerprint current directory eligibility separately from immutable forecasts."""
from copy import deepcopy
from datetime import date
from hashlib import sha256
import json
import os
from pathlib import Path
import shutil
import subprocess

SCHEMA = 'citrus.position-eligibility.v1'
ROOT = Path(__file__).resolve().parent


def fingerprint(snapshot):
    return sha256(json.dumps(snapshot, sort_keys=True, separators=(',', ':'),
                             ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def normalized(snapshot):
    if snapshot.get('schema_version') != SCHEMA:
        raise ValueError('Unsupported eligibility snapshot schema')
    date.fromisoformat(snapshot['as_of'])
    if not isinstance(snapshot.get('season'), int) or not isinstance(snapshot.get('players'), dict):
        raise ValueError('Eligibility requires season and players keyed by ID')
    for pid, row in snapshot['players'].items():
        if not isinstance(pid, str) or not pid.isdigit() or not isinstance(row, dict):
            raise ValueError('Eligibility requires numeric player ID keys and directory rows')
        if not isinstance(row.get('position'), (str, type(None))):
            raise ValueError('Invalid primary position')
        raw = row.get('eligible_positions')
        if not (raw is None or isinstance(raw, str) or isinstance(raw, list) and all(isinstance(p, str) for p in raw)):
            raise ValueError('Invalid eligibility evidence')
    # Execute the same reader as the web/server rather than a second Python policy.
    node = os.environ.get('CITRUS_NODE') or shutil.which('node')
    source = ROOT.parent.parent / 'packages/shared/src/utils/positionEligibility.ts'
    js = """import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source = readFileSync(process.argv[1], 'utf8');
const { playerEligiblePositions } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
const rows = JSON.parse(readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(Object.fromEntries(Object.entries(rows).map(([id, p]) => [id, playerEligiblePositions(p)]))));"""
    result = subprocess.run([node, '--disable-warning=ExperimentalWarning', '--input-type=module', '-e', js, str(source)],
        input=json.dumps(snapshot['players']), text=True, capture_output=True, timeout=30)
    if result.returncode:
        raise ValueError('Shared eligibility reader failed: ' + result.stderr[:500])
    return json.loads(result.stdout)


def attach(data, snapshot, *, source_name=None, source_sha256=None):
    normalized(snapshot)
    season = str(data.get('season', ''))[:4]
    if season.isdigit() and int(season) != snapshot['season']:
        raise ValueError('Eligibility season does not match the guide')
    result = deepcopy(data)
    result['eligibilityOverlay'] = deepcopy(snapshot)
    result['eligibilityIdentity'] = {'schemaVersion': SCHEMA, 'asOf': snapshot['as_of'],
        'season': snapshot['season'], 'sha256': fingerprint(snapshot),
        'sourceName': source_name, 'sourceSha256': source_sha256}
    return result


def load(data, path):
    raw = Path(path).read_bytes()
    return attach(data, json.loads(raw), source_name=str(path), source_sha256=sha256(raw).hexdigest())


def presentation(data, scored):
    snapshot = data.get('eligibilityOverlay')
    if snapshot is None:
        return scored
    if data.get('eligibilityIdentity', {}).get('sha256') != fingerprint(snapshot):
        raise ValueError('Eligibility fingerprint mismatch')
    rows = normalized(snapshot)
    result = deepcopy(scored)
    for player in result['players']:
        pid = str(player.get('playerId') or player['key'].removeprefix('canonical:'))
        # An absent snapshot row is not evidence for secondary positions.
        positions = rows.get(pid) or [player['position']]
        if ('G' in positions) != bool(player.get('isGoalie', player['position'] == 'G')):
            raise ValueError('Eligibility cannot change a forecast goalie/skater family')
        player['displayEligibility'] = positions
    return result


def display_position(player, *, ranked=False):
    if 'displayEligibility' in player:
        return '/'.join(player['displayEligibility'])
    return player['position'] + (str(player['positionRank']) if ranked and player.get('positionRank') is not None else '')
