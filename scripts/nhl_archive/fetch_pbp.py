#!/usr/bin/env python3
"""Fetch exact manifest games into the legacy mutable raw_nhl_data writer.

Both PBP and boxscore must be valid before writing. Health counts only exact
requested identities, never a season-wide count that can hide missing games.
content_sha256 retains the historical sorted-JSON semantic hash format; it is
NOT a hash of HTTP bytes. Unchanged payloads retain prior observed timestamps.
Changed existing PBP or nonempty boxscore is withheld, not overwritten: this
table cannot preserve corrected historical revisions. Its fetched_at covers
PBP only; filling a missing boxscore does not establish its observation time.
Independent endpoint times and corrections require a versioned archive.
Filling a NULL boxscore requires the separately deployed, service-only
citrus_fill_archive_boxscore RPC; full PBP comparisons travel in the POST body.
"""
from __future__ import annotations

import argparse
import csv
from datetime import date, datetime, timezone
import hashlib
import json
import math
import os
import sys
import time

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_REPO_ROOT, 'data-pipeline'))
import _bootstrap  # noqa: F401
from data_pipeline.utils.supabase_rest import SupabaseRest
from data_pipeline.utils.citrus_request import citrus_request

NHL_API_BASE = 'https://api-web.nhle.com/v1'


def valid_identity(game_id, season=None):
    return (type(game_id) is int and len(str(game_id)) == 10
            and 1900 <= game_id // 1000000 <= 9998
            and (game_id // 10000) % 100 in (2, 3) and game_id % 10000 > 0
            and (season is None or game_id // 1000000 == season))


def valid_request(game_id, game_date, season=None):
    try:
        return (valid_identity(game_id, season) and isinstance(game_date, str)
                and date.fromisoformat(game_date).isoformat() == game_date
                and date.fromisoformat(game_date) <= datetime.now(timezone.utc).date()
                and date.fromisoformat(game_date).year in (game_id // 1000000, game_id // 1000000 + 1))
    except (ValueError, TypeError):
        return False


def valid_stored_provenance(row, game_id):
    try:
        observed = datetime.fromisoformat(row['fetched_at'].replace('Z', '+00:00'))
        return (type(row.get('game_id')) is int and row['game_id'] == game_id
                and valid_request(game_id, row.get('game_date'))
                and valid_payload(row.get('raw_json'), game_id, row.get('game_date'), pbp=True)
                and row.get('content_sha256') == _sha256_of(row['raw_json'])
                and row.get('source_url') == f'{NHL_API_BASE}/gamecenter/{game_id}/play-by-play'
                and observed.tzinfo is not None and observed.utcoffset() is not None
                and observed <= datetime.now(timezone.utc)
                and observed.astimezone(timezone.utc).date() >= date.fromisoformat(row['game_date']))
    except (KeyError, ValueError, TypeError, AttributeError):
        return False


def _sha256_of(obj):
    """Legacy semantic JSON digest, with non-JSON NaN/Infinity rejected."""
    return hashlib.sha256(json.dumps(obj, sort_keys=True, allow_nan=False).encode('utf-8')).hexdigest()


def load_manifest_for_season(manifest_path, season):
    if type(season) is not int or not 1900 <= season <= 9998:
        raise ValueError('Invalid season')
    rows, seen = [], set()
    with open(manifest_path, encoding='utf-8') as stream:
        for row in csv.DictReader(stream):
            if int(row.get('season', 0)) != season:
                continue
            gid = int(row['game_id'])
            day = row['date']
            if gid in seen or not valid_request(gid, day, season) or str(gid) != row['game_id']:
                raise ValueError('Invalid or duplicate requested manifest identity/date')
            seen.add(gid)
            rows.append({**row, 'game_id': gid})
    if not rows:
        raise ValueError('Requested manifest is empty')
    return sorted(rows, key=lambda row: row['game_id'])


def existing_rows(db, requested):
    """Ordered exact-count pages, each bounded to explicit requested IDs.

    select_exact verifies Content-Range truncation; local checks reject extra,
    repeated or unordered identities. This is a paged read, not a transaction.
    """
    found = {}
    ids = sorted(requested)
    for start in range(0, len(ids), 100):
        page_ids = ids[start:start + 100]
        rows = db.select_exact('raw_nhl_data',
            select='game_id,game_date,raw_json,boxscore_json,source_url,content_sha256,processed,fetched_at',
            filters=[('game_id', 'in', page_ids)], order='game_id.asc', limit=100, offset=0)
        previous = None
        for row in rows:
            gid = row.get('game_id')
            if (type(gid) is not int or gid not in page_ids or gid in found
                    or (previous is not None and gid <= previous)):
                raise ValueError('Stored page identity/order conflict')
            previous = gid
            found[gid] = row
    return found


def fetch_game(game_id):
    payloads = []
    for endpoint in ('play-by-play', 'boxscore'):
        payload = None
        try:
            response = citrus_request(f'{NHL_API_BASE}/gamecenter/{game_id}/{endpoint}', timeout=25)
            if response.status_code == 200:
                payload = response.json()
                _sha256_of(payload)
        except Exception as exc:
            print(f'[warn] game {game_id} {endpoint}: {type(exc).__name__}', flush=True)
            payload = None
        payloads.append(payload)
    return tuple(payloads)


def valid_payload(payload, game_id, game_date, *, pbp):
    if not valid_request(game_id, game_date) or not isinstance(payload, dict) or not payload:
        return False
    try:
        _sha256_of(payload)
        if (type(payload.get('id')) is not int or payload['id'] != game_id
                or payload.get('gameDate') != game_date
                or type(payload.get('season')) is not int
                or payload['season'] != (game_id // 1000000) * 10000 + game_id // 1000000 + 1
                or type(payload.get('gameType')) is not int
                or payload['gameType'] != (game_id // 10000) % 100
                or payload.get('gameState') not in ('OFF', 'FINAL')
                or not all(isinstance(payload.get(side), dict)
                           and type(payload[side].get('id')) is int and payload[side]['id'] > 0
                           for side in ('homeTeam', 'awayTeam'))
                or payload['homeTeam']['id'] == payload['awayTeam']['id']):
            return False
        if pbp:
            return (isinstance(payload.get('plays'), list) and bool(payload['plays'])
                    and all(isinstance(play, dict) and bool(play) for play in payload['plays']))
        # Endpoint identity alone is not a complete boxscore response.
        return (isinstance(payload.get('homeTeam'), dict) and bool(payload['homeTeam'])
                and isinstance(payload.get('awayTeam'), dict) and bool(payload['awayTeam'])
                and type(payload['homeTeam'].get('id')) is int and payload['homeTeam']['id'] > 0
                and type(payload['awayTeam'].get('id')) is int and payload['awayTeam']['id'] > 0
                and payload['homeTeam']['id'] != payload['awayTeam']['id']
                and isinstance(payload.get('playerByGameStats'), dict)
                and all(isinstance(payload['playerByGameStats'].get(side), dict)
                        and bool(payload['playerByGameStats'][side]) for side in ('homeTeam', 'awayTeam')))
    except (TypeError, ValueError):
        return False


def valid_pair(pbp, box, game_id, game_date):
    """Structural final-game pairing only, not official-stat adjudication."""
    return (valid_payload(pbp, game_id, game_date, pbp=True)
            and valid_payload(box, game_id, game_date, pbp=False)
            and all(pbp[side]['id'] == box[side]['id'] for side in ('homeTeam', 'awayTeam')))


def upsert_raw(db, game_id, game_date, pbp, box, source_url, content_sha256, *, previous=None):
    if (not valid_pair(pbp, box, game_id, game_date)
            or source_url != f'{NHL_API_BASE}/gamecenter/{game_id}/play-by-play'
            or content_sha256 != _sha256_of(pbp)):
        raise ValueError('Complete matching PBP and boxscore required before mutation')
    if previous is not None and not valid_stored_provenance(previous, game_id):
        raise ValueError('invalid_stored_source_provenance')
    same_pbp = previous is not None and previous.get('raw_json') == pbp
    if previous is not None and (not same_pbp or (
            previous.get('boxscore_json') is not None and previous['boxscore_json'] != box)):
        raise ValueError('correction_requires_versioned_storage')
    row = {'game_id': game_id, 'game_date': game_date, 'raw_json': pbp,
           'boxscore_json': box, 'source_url': source_url, 'content_sha256': content_sha256,
           'processed': previous.get('processed', False) if same_pbp else False,
           'fetched_at': previous.get('fetched_at') if same_pbp else time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    if previous is None:
        # A concurrently created row must conflict, never be overwritten.
        db.insert('raw_nhl_data', [row])
    else:
        if previous.get('boxscore_json') == box:
            return
        # Only fill missing box evidence; never rewrite raw PBP or its time.
        # An exact conditional UPDATE inside the service-only RPC avoids putting
        # a full source document in the URL (which fails at realistic PBP size).
        applied = db.rpc('citrus_fill_archive_boxscore', {
            'p_game_id': game_id, 'p_game_date': game_date, 'p_expected_raw': pbp,
            'p_expected_sha256': content_sha256,
            'p_expected_fetched_at': previous['fetched_at'], 'p_boxscore': box})
        if applied is not True:
            raise ValueError('archive_source_changed_or_boxscore_already_present')


def record_audit(db, season, gate_name, expected, actual, note=''):
    db.rpc('record_rebuild_audit', {'p_season': season, 'p_gate_name': gate_name,
           'p_expected': expected, 'p_actual': actual, 'p_note': note[:1000]})


def run(db, manifest_rows, season, rate_sleep):
    if type(rate_sleep) not in (int, float) or not math.isfinite(rate_sleep) or rate_sleep <= 0:
        raise ValueError('Positive finite rate sleep required')
    if type(season) is not int or any(not valid_request(row.get('game_id'), row.get('date'), season)
                                       for row in manifest_rows):
        raise ValueError('Invalid requested manifest identity/date')
    requested = {row['game_id']: row['date'] for row in manifest_rows}
    if not requested or len(requested) != len(manifest_rows):
        raise ValueError('Nonempty unique requested identities required')
    errors, completed, corrections = 0, 0, 0
    fetched_pairs = {}
    try:
        before = existing_rows(db, requested)
        for gid, day in requested.items():
            pbp, box = fetch_game(gid)
            if not valid_pair(pbp, box, gid, day):
                errors += 1
            else:
                previous = before.get(gid)
                sha = _sha256_of(pbp)
                if previous is not None and not valid_stored_provenance(previous, gid):
                    errors += 1
                    print(f'[withheld] game {gid}: invalid_stored_source_provenance', flush=True)
                    time.sleep(rate_sleep)
                    continue
                if previous is not None and (previous.get('raw_json') != pbp or (
                        previous.get('boxscore_json') is not None and previous['boxscore_json'] != box)):
                    errors += 1
                    corrections += 1
                    print(f'[withheld] game {gid}: correction_requires_versioned_storage', flush=True)
                    time.sleep(rate_sleep)
                    continue
                if not (previous and previous.get('raw_json') == pbp
                        and previous.get('boxscore_json') == box
                        and previous.get('content_sha256') == sha and previous.get('game_date') == day):
                    try:
                        upsert_raw(db, gid, day, pbp, box,
                            f'{NHL_API_BASE}/gamecenter/{gid}/play-by-play', sha, previous=previous)
                    except Exception as exc:
                        print(f'[error] game {gid} write: {type(exc).__name__}', flush=True)
                        errors += 1
                        time.sleep(rate_sleep)
                        continue
                completed += 1
                fetched_pairs[gid] = (pbp, box)
            time.sleep(rate_sleep)
        after = existing_rows(db, requested)
        valid_pbp = {gid for gid, row in after.items() if row.get('game_date') == requested[gid]
                     and valid_stored_provenance(row, gid)
                     and valid_payload(row.get('raw_json'), gid, requested[gid], pbp=True)
                     and row.get('content_sha256') == _sha256_of(row['raw_json'])}
        valid_both = {gid for gid in valid_pbp if valid_pair(after[gid]['raw_json'],
                                   after[gid].get('boxscore_json'), gid, requested[gid])}
        note = (f'exact_requested_manifest; completed_fetches={completed}; errors={errors}; '
                f'correction_requires_versioned_storage={corrections}; paged_observation; '
                'structural_pair_only_not_official_stat_adjudication')
        record_audit(db, season, 'raw_pbp', len(requested), len(valid_pbp), note)
        record_audit(db, season, 'pbp_nonempty', len(requested), len(valid_both), note + '; requires boxscore too')
        exact_pairs = all((after.get(gid, {}).get('raw_json'), after.get(gid, {}).get('boxscore_json'))
                          == pair for gid, pair in fetched_pairs.items())
        healthy = not errors and completed == len(requested) and valid_both == set(requested) and exact_pairs
        record_audit(db, season, 'pbp_fetch_complete', len(requested), len(requested) if healthy else 0, note)
        return 0 if healthy else 1
    except Exception as exc:
        # No successful coverage result follows an incomplete read. Exception
        # messages can contain request URLs/credentials, so record type only.
        record_audit(db, season, 'pbp_fetch_complete', len(requested), 0,
                     f'failed:{type(exc).__name__}; coverage_unverified')
        return 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--season', type=int, required=True)
    ap.add_argument('--manifest', default='manifest.csv')
    ap.add_argument('--rate-sleep', type=float, default=0.5, help='Positive sleep between game fetch pairs')
    ap.add_argument('--limit', type=int)
    args = ap.parse_args()
    if not math.isfinite(args.rate_sleep) or args.rate_sleep <= 0 or (args.limit is not None and args.limit <= 0):
        ap.error('rate-sleep and supplied limit must be positive and finite')
    rows = load_manifest_for_season(args.manifest, args.season)
    if args.limit is not None:
        rows = rows[:args.limit]
    url, key = os.environ.get('VITE_SUPABASE_URL'), os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key:
        print('Required Supabase credentials unavailable', file=sys.stderr)
        return 1
    return run(SupabaseRest(url, key), rows, args.season, args.rate_sleep)


if __name__ == '__main__':
    sys.exit(main())
