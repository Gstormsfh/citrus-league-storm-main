"""Freeze stored shot identities and reconcile observed official source revisions.

No probabilities are selected or written. REST pagination is an observation
window, not a database transaction snapshot. Direct REST exports require two
matching full reads. Imported catalog exports instead require matching recorded
boundary digests and checksummed parts; these are distinct evidence contracts.
No model acceptance is inferred.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlparse

from acquisition.event_observation_service import prepare_observation
from monitoring.metric_identity import digest, reconcile


SOURCES = {
    'nhl': ('nhl_shots', 'game_id,event_id,season,shooter_id,period,period_type,is_goal,seconds_elapsed,x_raw,y_raw,shot_type,event_type', 'game_id.asc,event_id.asc'),
    'raw': ('raw_shots', 'id,game_id,event_id,season,player_id,period,period_type,is_goal,time_in_period,shot_x,shot_y,shot_type,type_desc', 'game_id.asc,event_id.asc,id.asc'),
}


def load_export_manifest(path, season, project_ref):
    """Validate persisted export evidence without upgrading it to a DB snapshot.

    Part hashes detect artifact corruption, not a maliciously rewritten manifest.
    Catalog MD5 boundary digests are externally recorded evidence, not recomputed
    from JSON: PostgreSQL numeric text can differ from Python serialization.
    """
    path = Path(path)
    manifest_content = path.read_bytes()
    manifest = json.loads(manifest_content)
    if (manifest.get('contract') != 'citrus-catalog-export-v1'
            or type(season) is not int or type(manifest.get('season')) is not int
            or manifest['season'] != season or not project_ref
            or manifest.get('project_ref') != project_ref
            or not isinstance(manifest.get('sources'), dict)
            or set(manifest['sources']) != set(SOURCES)):
        raise ValueError('Export contract, season or source project mismatch')
    times = []
    for field in ('observed_from', 'observed_to'):
        value = manifest.get(field)
        if not isinstance(value, str):
            raise ValueError('Export observation window requires aware timestamps')
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise ValueError('Export observation window requires aware timestamps')
        times.append(parsed)
    if times[0] > times[1] or times[1] > datetime.now(timezone.utc):
        raise ValueError('Invalid export observation window')
    sources = {}
    seen_parts = set()
    for name, spec in SOURCES.items():
        evidence = manifest['sources'][name]
        count, boundary_digest = evidence.get('n'), evidence.get('digest')
        boundary = {'n': count, 'digest': boundary_digest}
        if (type(count) is not int or count <= 0
                or not isinstance(boundary_digest, str)
                or not re.fullmatch(r'[a-f0-9]{32}', boundary_digest)
                or evidence.get('boundary_before') != boundary
                or evidence.get('boundary_after') != boundary):
            raise ValueError('Missing or conflicting export boundary evidence')
        paths, hashes = evidence.get('paths'), evidence.get('part_sha256')
        if (not isinstance(paths, list) or not paths
                or any(not isinstance(item, str) for item in paths)
                or len(set(paths)) != len(paths) or not isinstance(hashes, dict)
                or set(hashes) != set(paths)):
            raise ValueError('Missing or duplicate export part evidence')
        rows = []
        previous_key = None
        primary_keys = set()
        for item in paths:
            part_path = Path(item)
            if not part_path.is_absolute():
                part_path = path.parent / part_path
            resolved = part_path.resolve()
            if (part_path.is_symlink() or resolved.parent != path.resolve().parent
                    or resolved in seen_parts):
                raise ValueError('Export part must be unique and within the manifest directory')
            seen_parts.add(resolved)
            content = part_path.read_bytes()
            if hashlib.sha256(content).hexdigest() != hashes[item]:
                raise ValueError('Export part checksum conflict')
            part = json.loads(content)
            columns = spec[1].split(',')
            if (not isinstance(part, dict) or part.get('columns') != columns
                    or not isinstance(part.get('rows'), list) or not part['rows']
                    or any(not isinstance(row, list) or len(row) != len(columns)
                           for row in part['rows'])):
                raise ValueError('Invalid export columns or rows')
            for values in part['rows']:
                row = dict(zip(columns, values))
                if (type(row['season']) is not int or row['season'] != season
                        or type(row['game_id']) is not int
                        or row['game_id'] // 1000000 != season
                        or (row['game_id'] // 10000) % 100 not in (2, 3)
                        or type(row['event_id']) is not int or row['event_id'] < 0
                        or (name == 'raw' and (type(row['id']) is not int or row['id'] < 1))):
                    raise ValueError('Invalid stored export identity or season')
                key = (row['game_id'], row['event_id'])
                primary_key = key if name == 'nhl' else row['id']
                if name == 'raw':
                    key += (row['id'],)
                if primary_key in primary_keys or (previous_key is not None and key <= previous_key):
                    raise ValueError('Duplicate or unordered export rows')
                primary_keys.add(primary_key)
                previous_key = key
                rows.append(row)
        if len(rows) != count:
            raise ValueError('Incomplete stored export')
        sources[name] = rows
    return sources, {
        'observed_from': manifest['observed_from'], 'observed_to': manifest['observed_to'],
        'season': season, 'project_ref': project_ref,
        'export_manifest_sha256': hashlib.sha256(manifest_content).hexdigest(),
        'consistency': 'matching recorded boundary digests and checksummed parts; paged observation, not transaction snapshot',
    }


def export_rows(db, season):
    sources = {}
    for name, (table, columns, order) in SOURCES.items():
        rows = []
        while True:
            page = db.select_exact(table, select=columns, filters=[('season','eq',season)],
                                   order=order, limit=500, offset=len(rows))
            rows.extend(page)
            if len(page) < 500:
                break
        sources[name] = rows
    return sources


def compare_official(snapshot, receipts):
    from monitoring.final_game_evidence import verify_final_game
    grouped = {source: defaultdict(list) for source in SOURCES}
    for source in SOURCES:
        for row in snapshot[source]:
            grouped[source][row['game_id']].append(row)
    reports = []
    seen = set()
    for receipt in receipts:
        gid = receipt['game_id']
        if gid in seen:
            raise ValueError('Choose one explicitly observed revision per game')
        seen.add(gid)
        if receipt['status'] != 'complete':
            reports.append({'game_id': gid, 'status': 'official_unavailable'})
            continue
        source, events, manifest = receipt['prepared']
        # Recompute from captured raw source; reject edited/partial receipt rows.
        recomputed = prepare_observation(source['payload']['pbp'], receipt['observed_at'])
        if (list(recomputed) != [source, events, manifest] or manifest['game_id'] != gid
                or receipt['status'] != manifest['status']):
            raise ValueError('Receipt normalization/source integrity conflict')
        final_evidence = verify_final_game(source['payload']['pbp'])
        official = [{**event, 'seconds_elapsed': (event['period']-1)*1200+event['seconds_into_period']}
                    for event in events]
        for name in SOURCES:
            rows = [row for row in grouped[name][gid] if row.get('period_type') != 'SO']
            # Reuse the strict semantic reconciler; no orientation equivalence
            # is inferred by its absolute-coordinate check.
            normalized = rows if name == 'raw' else [
                {**row, 'player_id':row['shooter_id'], 'shot_x':row['x_raw'], 'shot_y':row['y_raw'],
                 'time_in_period': f"{(row['seconds_elapsed']-(row['period']-1)*1200)//60:02}:{row['seconds_elapsed']%60:02}"}
                for row in rows if type(row.get('seconds_elapsed')) is int and type(row.get('period')) is int]
            result = reconcile(official, normalized)
            extra = []
            kinds = {event['event_id']: event['event_type'] for event in events}
            for row in rows:
                kind = row.get('type_desc' if name == 'raw' else 'event_type')
                if row['event_id'] in kinds and kind != kinds[row['event_id']]:
                    extra.append({'game_id':gid,'event_id':row['event_id'],'reason':'attempt_outcome_type'})
            if len(normalized) != len(rows):
                extra.append({'game_id':gid,'reason':'invalid_stored_clock','count':len(rows)-len(normalized)})
            if final_evidence['status'] != 'verified':
                extra.append({'game_id': gid, 'reason': final_evidence['reason']})
            additional_conflicts={item['event_id'] for item in extra if 'event_id' in item}
            reports.append({'game_id':gid,'source':name,'source_snapshot_id':source['id'],
                            'observed_at':receipt['observed_at'],'official_events':len(official),
                            'stored_events':len(rows),'identity_verified_events':sum(
                                item['event_id'] not in additional_conflicts for item in result['matched']),
                            'quarantine':result['quarantine']+extra,
                            'final_game_evidence': final_evidence,
                            'status': 'official_unavailable' if final_evidence['status'] == 'unavailable' else
                                'matched' if result['accepted'] and not extra else 'quarantined'})
    return {'contract':'official-observed-corpus-v1','receipt_games':len(seen),
            'stored_games':len(set(grouped['nhl'])|set(grouped['raw'])),
            'unobserved_games':sorted((set(grouped['nhl'])|set(grouped['raw']))-seen),
            'status_counts':dict(Counter(row['status'] for row in reports)), 'games':reports,
            'limitations':['Current corrected observations are not historical as-of evidence.',
                           'Final score/SOG totals do not independently prove missed-shot coverage.',
                           'No source orientation, feature lineage or model probabilities validated.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--season',type=int,required=True)
    source=parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--env-file',type=Path)
    source.add_argument('--export-manifest',type=Path)
    parser.add_argument('--project-ref', required=True)
    parser.add_argument('--receipts',type=Path,required=True,action='append',
                        help='Frozen receipt directory; repeat for disjoint game sets')
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=False)
    if args.export_manifest:
        second, evidence = load_export_manifest(args.export_manifest, args.season, args.project_ref)
        snapshot = {**second, **evidence}
    else:
        from dotenv import dotenv_values
        from utils.supabase_rest import SupabaseRest
        env=dotenv_values(args.env_file)
        url=env.get('SUPABASE_URL') or env.get('VITE_SUPABASE_URL')
        if not args.project_ref or urlparse(url or '').hostname != args.project_ref+'.supabase.co':
            parser.error('Source project does not match explicit expected ref')
        db=SupabaseRest(url,env.get('SUPABASE_SERVICE_ROLE_KEY'))
        started=datetime.now(timezone.utc).isoformat()
        first=export_rows(db,args.season)
        print(json.dumps({'event':'identity_export.first_read','counts':{k:len(v) for k,v in first.items()}}),flush=True)
        second=export_rows(db,args.season)
        if digest(first)!=digest(second):
            raise RuntimeError('Stored source changed during freeze; no stable export')
        snapshot={'observed_from':started,'observed_to':datetime.now(timezone.utc).isoformat(),
                  'stable_double_read':True,**second}
    (args.output/'stored-snapshot.json').write_text(json.dumps(snapshot,sort_keys=True,allow_nan=False))
    baseline=reconcile(second['nhl'],[r for r in second['raw'] if r.get('period_type')!='SO'])
    (args.output/'stored-identity-quarantine.json').write_text(json.dumps(baseline,sort_keys=True))
    receipts=[json.loads(path.read_text()) for directory in args.receipts
              for path in sorted(directory.glob('*.json')) if path.name!='health.json']
    official=compare_official(second,receipts)
    (args.output/'official-reconciliation.json').write_text(json.dumps(official,sort_keys=True))
    health={'event':'canonical_corpus.health','source_hashes':baseline['source_sha256'],
            'stored_quarantine':baseline['quarantine_counts'],'official_statuses':official['status_counts'],
            'receipt_games':official['receipt_games'],'unobserved_games':len(official['unobserved_games'])}
    print(json.dumps(health),flush=True)
    return 0 if not baseline['quarantine'] and not official['unobserved_games'] and set(official['status_counts'])=={'matched'} else 2


if __name__=='__main__':
    raise SystemExit(main())
