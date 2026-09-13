"""Explicit, separately fingerprinted current-club presentation overlays.

Canonical player teams, team slots and scoring inputs are never overwritten.
"""
from copy import deepcopy
from datetime import date
from hashlib import sha256
import json
from pathlib import Path
from urllib.parse import urlparse

SCHEMA = 'citrus.current-affiliations.v1'
STATUSES = {'affiliated', 'free_agent', 'retired', 'non_nhl', 'unknown'}
AUTHORITIES = {'official_transaction', 'official_roster', 'reviewed_unknown',
               'owner_override', 'nhl_roster_feed', 'unknown'}
LABELS = {'free_agent': 'Unsigned', 'retired': 'Retired',
          'non_nhl': 'Non-NHL', 'unknown': 'Unknown'}


def fingerprint(snapshot):
    return sha256(json.dumps(snapshot, sort_keys=True, separators=(',', ':'),
                             ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def validate(snapshot):
    if snapshot.get('schema_version') != SCHEMA:
        raise ValueError('Unsupported affiliation overlay schema')
    date.fromisoformat(snapshot['as_of'])
    if not isinstance(snapshot.get('players'), dict):
        raise ValueError('Affiliations must be keyed by player ID')
    for pid, row in snapshot['players'].items():
        if not isinstance(pid, str) or not pid.isdigit():
            raise ValueError('Affiliation requires a numeric player ID string')
        if row.get('status') not in STATUSES:
            raise ValueError('Unsupported affiliation status')
        if row['authority'] not in AUTHORITIES:
            raise ValueError('Unsupported affiliation authority')
        if row.get('organization') is not None and not isinstance(row['organization'], str):
            raise ValueError('Affiliation organization must be text or null')
        fallback = row['authority'] in {'nhl_roster_feed', 'unknown'}
        if row.get('as_of') is not None:
            date.fromisoformat(row['as_of'])
            if row['as_of'] > snapshot['as_of']:
                raise ValueError('Affiliation event is newer than snapshot')
        elif not fallback:
            raise ValueError('Reviewed affiliation requires as_of')
        if not fallback and (not isinstance(row.get('reason'), str) or not row['reason'].strip()):
            raise ValueError('Reviewed affiliation requires reason')
        if row.get('reason') is not None and not isinstance(row['reason'], str):
            raise ValueError('Affiliation reason must be text or null')
        if not fallback and (not isinstance(row.get('event_id'), str) or not row['event_id']):
            raise ValueError('Reviewed affiliation requires event_id')
        if row['status'] == 'affiliated':
            if not isinstance(row.get('team'), str) or len(row['team']) != 3 or not row['team'].isascii() or not row['team'].isalpha() or not row['team'].isupper():
                raise ValueError('NHL affiliation requires a team abbreviation')
        elif row.get('team') is not None:
            raise ValueError('Non-NHL statuses cannot imply an NHL team')
        urls = row.get('source_urls')
        if not isinstance(urls, list) or (not urls and not fallback):
            raise ValueError('Affiliation requires evidence URLs')
        if any(not isinstance(u, str) or urlparse(u).scheme not in ('https', 'http') or not urlparse(u).netloc for u in urls):
            raise ValueError('Invalid affiliation evidence URL')
    return snapshot


def attach(data, snapshot, *, source_name=None, source_sha256=None):
    validate(snapshot)
    result = deepcopy(data)
    result['affiliationOverlay'] = deepcopy(snapshot)
    result['affiliationIdentity'] = {'schemaVersion': SCHEMA,
        'sha256': fingerprint(snapshot), 'asOf': snapshot['as_of'],
        'sourceName': source_name, 'sourceSha256': source_sha256}
    return result


def load(data, path):
    raw = Path(path).read_bytes()
    return attach(data, json.loads(raw), source_name=str(path),
                  source_sha256=sha256(raw).hexdigest())


def presentation(data, scored):
    snapshot = data.get('affiliationOverlay')
    if snapshot is None:
        return scored
    validate(snapshot)
    if data.get('affiliationIdentity', {}).get('sha256') != fingerprint(snapshot):
        raise ValueError('Affiliation fingerprint mismatch')
    result = deepcopy(scored)
    result['affiliationIdentity'] = deepcopy(data['affiliationIdentity'])
    for player in result['players']:
        pid = str(player['key']).removeprefix('canonical:')
        row = snapshot['players'].get(pid)
        player['projectionTeam'] = player['team']
        player['currentAffiliation'] = deepcopy(row)
        # An omitted row is not a fresh confirmation of the projection club.
        player['displayTeam'] = row['team'] if row and row['status'] == 'affiliated' else LABELS[row['status']] if row else 'Unreviewed'
    return result


def display_team(player):
    return player.get('displayTeam', player['team'])


def context(player):
    if 'projectionTeam' not in player:
        return ''
    row = player.get('currentAffiliation')
    if not row:
        return 'Current affiliation unreviewed; projection club ' + player['projectionTeam'] + '.'
    club = (' / ' + row['organization']) if row.get('organization') else ''
    return (f"Current affiliation: {display_team(player)}{club}. Projection club: {player['projectionTeam']}. "
            f"{row['authority']} / as of {row.get('as_of') or 'not supplied'}. {row.get('reason') or 'Transaction evidence not supplied.'}")
