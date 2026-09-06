"""Publish frozen TOI evidence ONLY to a disposable localhost PostgREST fixture.

Requires /rest/v1 routing, the real publication schema, and a synthetic JWT with
issuer citrus-local-integration. Never loads .env or hosted credentials. Root
provisions/removes Docker; this script neither launches nor deletes infrastructure.
"""
from __future__ import annotations

import argparse
import base64
from copy import deepcopy
from datetime import datetime,timezone
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT / 'data-pipeline'))
from projections.analytics_publication import AnalyticsPublisher, prepare, fingerprint
from projections.verified_toi_publication import build_candidate
from utils.supabase_rest import SupabaseRest


def guard_local(base_url,token):
    parsed=urlparse(base_url)
    if (parsed.scheme!='http' or parsed.hostname not in ('127.0.0.1','localhost','::1')
            or not parsed.port or parsed.username or parsed.password
            or parsed.path not in ('','/') or parsed.query or parsed.fragment):
        raise ValueError('Only an explicit disposable localhost base URL is permitted')
    try:
        segment=token.split('.')[1]
        claims=json.loads(base64.urlsafe_b64decode(segment+'='*(-len(segment)%4)))
    except Exception as exc:
        raise ValueError('Synthetic JWT is required') from exc
    if claims.get('iss')!='citrus-local-integration' or claims.get('role')!='service_role':
        raise ValueError('Only the synthetic local integration service-role JWT is permitted')


def correction_fixture(original):
    """Proposed correction in a LOCAL COPY; no legacy source row is updated."""
    payload=original[0]['payload']
    proof=payload['reconciliation']['8476453']
    assert proof['extra_games']==[2025020538] and proof['missing_games']==[]
    rows=[row for row in payload['stored_rows']
          if not (row['player_id']==8476453 and row['game_id']==2025020538)]
    evidence={int(pid):receipt for pid,receipt in payload['official_receipts'].items()}
    observed=datetime.now(timezone.utc).isoformat()
    computed=build_candidate(payload['expected_players'],rows,evidence,original[1]['season'],observed,
                             original[1]['code_revision'],summary_receipts=payload['official_summary_receipts'],
                             stored_observed_at=observed)
    computed[0]['payload']['local_integration_fixture']={
        'kind':'proposed correction on disposable local copy',
        'original_source_id':original[0]['id'],'removed_extra_appearance':[8476453,2025020538]}
    metadata={key:computed[1][key] for key in ('metric','variant','unit','season','game_type','population',
                                             'feature_version','model_version','code_revision','data_cutoff')}
    values=[{key:value for key,value in row.items() if key!='batch_id'} for row in computed[2]]
    validation={key:value for key,value in computed[1]['validation'].items()
                if key not in ('entity_ids','values_sha256')}
    validation['evidence_sha256']=fingerprint(computed[0]['payload'])
    return prepare('DISPOSABLE LOCAL TEST: proposed official-appearance correction',observed,
                   computed[0]['payload'],metadata,values,validation)


def frozen_database_evidence(db,prepared):
    source,batch,_=prepared
    return fingerprint({
        'source':db.select_exact('analytics_source_snapshots',select='id,source,observed_at,payload,payload_sha256',
                                filters=[('id','eq',source['id'])],limit=1),
        'batch':db.select_exact('analytics_metric_batches',select='id,source_snapshot_id,validation,data_cutoff,code_revision',
                               filters=[('id','eq',batch['id'])],limit=1),
        'values':db.select('analytics_metric_values',select='batch_id,entity_id,value,availability,reason,exposure',
                           filters=[('batch_id','eq',batch['id'])],order='entity_id.asc')})


def run(args):
    token=args.token_file.read_text().strip()
    guard_local(args.base_url,token)
    original=json.loads(args.candidate.read_text())
    assert len(original[2])==940
    assert sum(row['availability']=='available' for row in original[2])==939
    assert [(row['entity_id'],row['reason']) for row in original[2] if row['availability']=='unavailable']==[(8476453,'event_set_mismatch')]
    if args.output_dir.exists():
        raise ValueError('Integration output must be a new directory')
    args.output_dir.mkdir(parents=True)
    db=SupabaseRest(args.base_url,token,timeout_seconds=180)
    for table in ('analytics_source_snapshots','analytics_metric_batches','analytics_metric_values','analytics_publications'):
        assert db.select_exact(table,select='entity_id' if table=='analytics_metric_values' else 'id',limit=1)==[], 'Disposable publication tables must initially be empty'
    publisher=AnalyticsPublisher(db)
    report={'endpoint':args.base_url,'synthetic_fixture':True,'phases':[]}
    def reader(candidate_path):
        env={**os.environ,'CITRUS_LOCAL_PUBLICATION_URL':args.base_url,
             'CITRUS_LOCAL_PUBLICATION_TOKEN_FILE':str(args.token_file.resolve())}
        completed=subprocess.run([args.node,'--import','tsx',str(ROOT/'scripts/read_local_analytics_publication.ts'),
                                  str(candidate_path.resolve())],cwd=ROOT,env=env,text=True,capture_output=True,check=True)
        return json.loads(completed.stdout.strip().splitlines()[-1])
    publisher.publish(original)
    report['phases'].append({'phase':'original','reader':reader(args.candidate)})
    original_digest=frozen_database_evidence(db,original)
    assert publisher.publish(original)['replayed'] is True
    assert len(db.select('analytics_publications',select='id',order='id.asc'))==1
    report['phases'].append({'phase':'idempotent_replay','reader':reader(args.candidate)})
    corrected=correction_fixture(original)
    assert sum(row['availability']=='available' for row in corrected[2])==940
    correction_path=args.output_dir/'local-correction-candidate.json'
    correction_path.write_text(json.dumps(corrected,separators=(',',':')))
    publisher.publish(corrected)
    corrected_digest=frozen_database_evidence(db,corrected)
    report['phases'].append({'phase':'new_correction_batch','reader':reader(correction_path)})
    assert frozen_database_evidence(db,original)==original_digest
    # Explicit serving selection is a new publication event, never an UPDATE.
    db.insert('analytics_publications',[{'batch_id':original[1]['id'],'reason':'disposable integration rollback selection'}])
    report['phases'].append({'phase':'explicit_rollback','reader':reader(args.candidate)})
    assert len(db.select('analytics_publications',select='id',order='id.asc'))==3
    assert frozen_database_evidence(db,original)==original_digest
    assert frozen_database_evidence(db,corrected)==corrected_digest
    report.update(original_batch_id=original[1]['id'],correction_batch_id=corrected[1]['id'],
                  original_database_evidence_sha256=original_digest,
                  corrected_database_evidence_sha256=corrected_digest,
                  publication_events=3,old_evidence_unchanged=True,passed=True)
    (args.output_dir/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    return report


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url',required=True)
    parser.add_argument('--token-file',type=Path,required=True)
    parser.add_argument('--candidate',type=Path,required=True)
    parser.add_argument('--output-dir',type=Path,required=True)
    parser.add_argument('--node',default='node')
    args=parser.parse_args(argv)
    print(json.dumps(run(args)))


if __name__=='__main__':
    main()
