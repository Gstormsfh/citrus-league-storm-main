"""Read-only TOI receipts and complete-population reconciliation CLI.

Writes only a newly created local output directory. Official retrieval times are
current observations of corrected history, never historical availability claims.
No database mutation or publication is performed. Failed HTTP responses remain
receipts; a complete expected-player manifest survives individual source failure.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import hashlib
import re
from pathlib import Path
import sys
import time
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import _bootstrap  # noqa: E402,F401
from monitoring.appearance_contract import SUMMARY_URL, official_summary_population
from projections.analytics_publication import fingerprint, timestamp, prepare
from projections.verified_toi_publication import build_candidate


def now():
    return datetime.now(timezone.utc).isoformat()


def capture(url, params, request):
    receipt = {'url':url, 'params':params, 'requested_at':now(),
               'status':'failed', 'payload':None, 'http_status':None}
    try:
        response = request(url, params=params, timeout=30, max_retries=2)
        receipt['http_status'] = response.status_code
        response.raise_for_status()
        receipt['payload'] = response.json()
        receipt['status'] = 'ok'
    except Exception as exc:
        # Exception text may contain proxy credentials. Retain only its class.
        receipt['error_type'] = type(exc).__name__
        if getattr(exc, 'response', None) is not None:
            receipt['http_status'] = exc.response.status_code
    receipt['observed_at'] = now()
    return receipt


def collect_summary(season, request, pause, emit=lambda receipt: None):
    pages = []
    offset = 0
    expected_total = None
    while True:
        params = {'isAggregate':'false', 'isGame':'false', 'start':offset, 'limit':100,
                  'sort':'[{"property":"playerId","direction":"ASC"}]',
                  'cayenneExp':f'seasonId={season}{season + 1} and gameTypeId=2'}
        receipt = capture(SUMMARY_URL, params, request)
        pages.append(receipt)
        emit(receipt)
        payload = receipt['payload']
        if receipt['status'] != 'ok' or not isinstance(payload, dict):
            break
        rows, total = payload.get('data'), payload.get('total')
        if (not isinstance(rows, list) or type(total) is not int or total <= 0
                or len(rows) != min(100, total - offset)
                or (expected_total is not None and total != expected_total)):
            break
        expected_total = total
        offset += len(rows)
        if offset >= total:
            break
        pause()
    return pages


def collect_player(pid, season, request):
    source = capture(f'https://api-web.nhle.com/v1/player/{pid}/game-log/{season}{season + 1}/2', {}, request)
    payload = source['payload']
    log = payload.get('gameLog') if source['status'] == 'ok' and isinstance(payload, dict) else None
    return {'observed_at':source['observed_at'], 'game_log':log,
            'source_receipt':source}


def export_stored(db, season):
    rows = []
    offset = 0
    while True:
        page = db.select_exact('player_game_stats',
            select='season,player_id,game_id,is_goalie,nhl_toi_seconds',
            filters=[('season','eq',season),('game_id','gte',season * 1000000 + 20000),
                     ('game_id','lt',season * 1000000 + 30000),('is_goalie','eq',False)],
            order='game_id.asc,player_id.asc',limit=1000,offset=offset)
        rows.extend(page)
        if len(page) < 1000:
            validate_stored_rows(rows,season)
            return rows
        offset += 1000


def write_json(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, sort_keys=True, separators=(',', ':'), allow_nan=False)
        stream.write('\n')


STORED_COLUMNS = ['season','player_id','game_id','is_goalie','nhl_toi_seconds']
CATALOG_CONTRACT = 'citrus-toi-stored-catalog-v1'
DIGEST_CONTRACT = 'sha256-canonical-json-compact-rows-v1'


def validate_stored_rows(rows, season):
    if not isinstance(rows,list):
        raise ValueError('Stored snapshot requires rows')
    previous = None
    for row in rows:
        if (not isinstance(row,dict) or set(row) != set(STORED_COLUMNS)
                or type(row['season']) is not int or row['season'] != season
                or type(row['player_id']) is not int or row['player_id'] <= 0
                or type(row['game_id']) is not int
                or not season * 1000000 + 20000 <= row['game_id'] < season * 1000000 + 30000
                or type(row['is_goalie']) is not bool or row['is_goalie']
                or (row['nhl_toi_seconds'] is not None and type(row['nhl_toi_seconds']) is not int)):
            raise ValueError('Stored row has invalid columns, types or population')
        key = (row['game_id'],row['player_id'])
        if previous is not None and key <= previous:
            raise ValueError('Stored rows must be globally strictly ordered by game and player')
        previous = key


def compact_rows(rows):
    return [[row[column] for column in STORED_COLUMNS] for row in rows]


def _project(value):
    if not isinstance(value,str) or re.fullmatch('[a-z0-9]{20}',value) is None:
        raise ValueError('An explicit expected project ref is required')
    return value


def _window(manifest, reference_now):
    start = datetime.fromisoformat(timestamp(manifest['observed_at']))
    end = datetime.fromisoformat(timestamp(manifest['export_completed_at']))
    before = datetime.fromisoformat(timestamp(manifest['boundary_before']['observed_at']))
    after = datetime.fromisoformat(timestamp(manifest['boundary_after']['observed_at']))
    reference = datetime.fromisoformat(timestamp(reference_now))
    if not start <= before <= after <= end <= reference:
        raise ValueError('Export observation window must be ordered and nonfuture')


def load_stored_snapshot(path, season, *, mode='legacy', expected_project_ref=None, reference_now=None):
    """Load catalog evidence only with explicit project and strict contract checks.

    Backwards-compatible legacy loading validates rows but never upgrades old
    manifests or synthetic inline data into catalog/capture-time checksum evidence.
    """
    path = Path(path)
    if path.is_symlink():
        raise ValueError('Stored manifest must not be a symlink')
    manifest_bytes = path.read_bytes()
    manifest = json.loads(manifest_bytes)
    if not isinstance(manifest, dict):
        raise ValueError('Stored snapshot requires an object manifest')
    if mode not in ('catalog','legacy'):
        raise ValueError('Explicit supported stored export mode is required')
    catalog = mode == 'catalog'
    if catalog:
        absolute = path.absolute()
        if any(parent.is_symlink() for parent in (absolute,*absolute.parents)):
            raise ValueError('Catalog paths must not contain symlinks')
        project = _project(expected_project_ref)
        if (manifest.get('contract') != CATALOG_CONTRACT or manifest.get('project_ref') != project
                or type(manifest.get('season')) is not int or manifest['season'] != season
                or manifest.get('digest_contract') != DIGEST_CONTRACT
                or manifest.get('consistency') != 'paged-observation-not-transactional'
                or 'parts' not in manifest):
            raise ValueError('Catalog contract, project, season or consistency mismatch')
        _window(manifest,reference_now or now())
    elif manifest.get('contract') == CATALOG_CONTRACT:
        raise ValueError('Catalog manifests require explicit catalog validation')
    timestamp(manifest['observed_at'])  # Actual explicitly zoned export time.
    part_digests = {}
    if 'parts' in manifest:
        names = manifest['parts']
        if (manifest.get('columns') != STORED_COLUMNS or 'rows' in manifest
                or not isinstance(names,list) or not names
                or any(not isinstance(name,str) for name in names)
                or len(set(names)) != len(names)
                or type(manifest.get('expected_rows')) is not int
                or manifest['expected_rows'] < 0):
            raise ValueError('Invalid stored part manifest')
        if catalog and (not isinstance(manifest.get('parts_sha256'),dict)
                        or set(manifest['parts_sha256']) != set(names)):
            raise ValueError('Every catalog part requires an exact SHA256 receipt')
        rows = []
        directory = path.resolve().parent
        inodes = set()
        for name in names:
            part = directory / name
            if (not name or Path(name).name != name or name in ('.','..')
                    or '/' in name or '\\' in name or part.resolve().parent != directory
                    or part.is_symlink()):
                raise ValueError('Stored part names must be local basenames')
            identity = (part.stat().st_dev,part.stat().st_ino)
            if identity in inodes:
                raise ValueError('Stored parts must identify unique local files')
            inodes.add(identity)
            data = part.read_bytes()
            digest = hashlib.sha256(data).hexdigest()
            if catalog and manifest['parts_sha256'][name] != digest:
                raise ValueError('Stored catalog part SHA256 mismatch')
            part_digests[name] = digest
            payload = json.loads(data)
            if not isinstance(payload,list):
                raise ValueError('Stored part must be an array')
            for row in payload:
                if not isinstance(row,list) or len(row) != len(STORED_COLUMNS):
                    raise ValueError('Stored compact row has wrong length')
                rows.append(dict(zip(STORED_COLUMNS,row)))
        if len(rows) != manifest['expected_rows']:
            raise ValueError('Stored row count does not match manifest')
        manifest = {**manifest,'rows':rows,'source_parts':names}
        del manifest['parts']
        del manifest['columns']
    rows = manifest.get('rows')
    validate_stored_rows(rows,season)
    row_digest = fingerprint(compact_rows(rows))
    if catalog:
        for name in ('boundary_before','boundary_after'):
            boundary = manifest[name]
            if (set(boundary) != {'row_count','rows_sha256','observed_at'}
                    or type(boundary['row_count']) is not int or boundary['row_count'] != len(rows)
                    or boundary['rows_sha256'] != row_digest):
                raise ValueError('Catalog boundary count/digest differs from frozen rows')
        provenance = {key:manifest[key] for key in ('contract','project_ref','season','digest_contract',
                        'consistency','observed_at','export_completed_at','boundary_before','boundary_after')}
        provenance.update(mode='catalog',catalog_verified=True,parts_sha256=part_digests,
                          expected_rows=len(rows),rows_sha256=row_digest,
                          manifest_sha256=hashlib.sha256(manifest_bytes).hexdigest())
        # A materialized inline rows file is not the original part catalog.
        # Its prior validation receipt is retained below; loading it as legacy
        # never reasserts catalog validity without the original checksummed parts.
        manifest['source_catalog_contract'] = manifest.pop('contract')
    else:
        provenance = {'mode':'legacy','catalog_verified':False,
                      'consistency':'legacy-or-synthetic-input-not-catalog-evidence',
                      'observed_at':timestamp(manifest['observed_at']),
                      'expected_rows':len(rows),'validation_time_rows_sha256':row_digest}
    manifest['export_provenance'] = provenance
    return manifest


def export_stored_twice(db, season, project_ref):
    """Two equal paged reads prove observed agreement, not snapshot isolation."""
    _project(project_ref)
    parsed = urlparse(db.url)
    if (parsed.scheme != 'https' or parsed.hostname != f'{project_ref}.supabase.co'
            or parsed.username or parsed.password or parsed.path not in ('','/')
            or parsed.query or parsed.fragment or parsed.port not in (None,443)):
        raise ValueError('REST endpoint does not match the expected project')
    started = now()
    first = export_stored(db,season)
    first_at = now()
    second = export_stored(db,season)
    second_at = now()
    if first != second:
        raise ValueError('Complete ordered REST exports changed between observations')
    digest = fingerprint(compact_rows(second))
    provenance = {'mode':'rest-double-read','catalog_verified':False,'project_ref':project_ref,
                  'season':season,'consistency':'paged-observation-not-transactional',
                  'observed_at':started,'export_completed_at':second_at,
                  'boundary_before':{'row_count':len(first),'rows_sha256':digest,'observed_at':first_at},
                  'boundary_after':{'row_count':len(second),'rows_sha256':digest,'observed_at':second_at},
                  'digest_contract':DIGEST_CONTRACT}
    _window(provenance,now())
    return {'rows':second,'observed_at':started,'export_completed_at':second_at,
            'project_ref':project_ref,'season':season,'export_provenance':provenance}


def retain_export_provenance(prepared, provenance):
    """Bind validated export provenance into immutable source and batch identity."""
    source,batch,rows = prepared
    payload = {**source['payload'],'stored_export_provenance':provenance}
    metadata = {key:batch[key] for key in ('metric','variant','unit','season','game_type','population',
                'feature_version','model_version','code_revision','data_cutoff')}
    validation = {key:value for key,value in batch['validation'].items()
                  if key not in ('entity_ids','values_sha256')}
    validation['evidence_sha256'] = fingerprint(payload)
    values = [{key:value for key,value in row.items() if key!='batch_id'} for row in rows]
    return prepare(source['source'],source['observed_at'],payload,metadata,values,validation)


def _run(args):
    if args.stored_snapshot:
        stored = load_stored_snapshot(args.stored_snapshot,args.season,mode=args.stored_mode,
                                      expected_project_ref=args.expected_project_ref)
    else:
        _project(args.expected_project_ref)
        from dotenv import dotenv_values
        from utils.supabase_rest import SupabaseRest
        env = dotenv_values(args.env_file)
        db = SupabaseRest(env['VITE_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY'])
        stored = export_stored_twice(db,args.season,args.expected_project_ref)
    write_json(args.output_dir / 'stored.json', stored)
    from utils.citrus_request import citrus_request
    pause = lambda: time.sleep(args.delay_seconds)
    pages = collect_summary(args.season, citrus_request, pause,
        emit=lambda receipt: write_json(args.output_dir / f'summary-{receipt["params"]["start"]}.json',receipt))
    population = official_summary_population(pages,args.season)
    expected = sorted({r['player_id'] for r in stored['rows']} | set(population or {}))
    write_json(args.output_dir / 'expected-players.json',expected)
    evidence = {}
    for index,pid in enumerate(expected,1):
        pause()
        evidence[pid] = collect_player(pid,args.season,citrus_request)
        write_json(args.output_dir / f'player-{pid}.json',evidence[pid])
        if index % 25 == 0:
            print(json.dumps({'expected':len(expected),'receipts':index}),flush=True)
    prepared = build_candidate(expected,stored['rows'],evidence,args.season,now(),args.code_revision,
                               summary_receipts=pages,stored_observed_at=stored['observed_at'])
    prepared = retain_export_provenance(prepared,stored['export_provenance'])
    write_json(args.output_dir / 'candidate.json',prepared)
    health = {**prepared[1]['validation']['coverage'],
              'reason_counts':dict(Counter(row['reason'] for row in prepared[2])),
              'source_sha256':fingerprint(prepared[0]),
              'snapshot_complete':True,'database_modified':False,
              'stored_export_mode':stored['export_provenance']['mode'],
              'catalog_export_verified':stored['export_provenance']['catalog_verified']}
    write_json(args.output_dir / 'health.json',health)
    print(json.dumps(health),flush=True)
    return 0 if health['official_population_complete'] and not health['withheld'] else 2


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--season',type=int,required=True)
    parser.add_argument('--output-dir',type=Path,required=True,help='Must not exist')
    parser.add_argument('--code-revision',required=True)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--stored-snapshot',type=Path)
    source.add_argument('--env-file',type=Path,help='Read-only export; credentials never saved')
    parser.add_argument('--stored-mode',choices=('catalog','legacy'),default='catalog')
    parser.add_argument('--expected-project-ref',help='Required for catalog or direct REST exports')
    parser.add_argument('--delay-seconds',type=float,default=1.0)
    args = parser.parse_args(argv)
    if not 1917 <= args.season <= 2100 or args.delay_seconds < 0.5:
        parser.error('Season must be valid; request delay must be at least 0.5 seconds')
    args.output_dir.mkdir(parents=True,exist_ok=False)
    try:
        return _run(args)
    except Exception as exc:
        health = {'status':'failed','stage':'collector_or_export_validation',
                  'error_type':type(exc).__name__,'snapshot_complete':False,
                  'catalog_export_verified':False,'database_modified':False,'observed_at':now()}
        # Never save exception text: it can contain credentials or private URLs.
        write_json(args.output_dir / 'failure-health.json',health)
        print(json.dumps(health),flush=True)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
