#!/usr/bin/env python3
"""Restore an explicit cache backup and test rename/inverse in a local full-schema container."""
import argparse,hashlib,json,subprocess
from pathlib import Path
HERE=Path(__file__).resolve().parent
p=argparse.ArgumentParser();p.add_argument('--container',required=True);p.add_argument('--backup',type=Path,required=True);p.add_argument('--operations-dir',type=Path,required=True);p.add_argument('--reuse-restored',action='store_true');args=p.parse_args()
if not args.container.startswith('citrus-canonical-rehearsal-'):raise SystemExit('Refusing non-rehearsal container')
def sql(body):
 r=subprocess.run(['docker','exec','-i',args.container,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],input=body,text=True,capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
def query(body):return json.loads(sql(body))
backup=json.loads(args.backup.read_text());parents=json.loads((HERE/'cache-parent-rows-20260912.json').read_text())
empty=sql('select count(*) from projection_cache;')=='0'
assert empty or args.reuse_restored,'Only restore into an empty rehearsal table unless explicitly reusing verified rows'
for table,key in [('nhl_teams','teams'),('nhl_games','games')]:
 sql(f'INSERT INTO {table} SELECT * FROM jsonb_populate_recordset(NULL::{table},$data$'+json.dumps(parents[key])+'$data$::jsonb) ON CONFLICT DO NOTHING;')
if empty:sql('INSERT INTO projection_cache SELECT * FROM jsonb_populate_recordset(NULL::projection_cache,$data$'+json.dumps(backup['rows'])+'$data$::jsonb);')
def metadata(name):
 return query(f"""select json_build_object('oid',c.oid,'acl',c.relacl::text,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
 'rows',(select count(*) from public.{name}),'content_md5',(select md5(coalesce(string_agg(row_to_json(t)::text,'' order by cache_id),'')) from public.{name} t),
 'constraints',(select json_agg(json_build_object('oid',oid,'name',conname,'definition',pg_get_constraintdef(oid)) order by conname) from pg_constraint where conrelid=c.oid),
 'policies',(select json_agg(json_build_object('oid',oid,'name',polname,'command',polcmd,'roles',polroles::text,'qual',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid)) order by polname) from pg_policy where polrelid=c.oid),
 'index_oids',(select json_agg(indexrelid order by indexrelid) from pg_index where indrelid=c.oid)) from pg_class c where c.oid='public.{name}'::regclass;""")
before=metadata('projection_cache');assert before['rows']==backup['count'] and before['content_md5']==backup['content_md5'],before
# The isolated image preloads pg_cron; the snapshot omits its extension installation.
sql('CREATE EXTENSION IF NOT EXISTS pg_cron;')
preflight=sql((args.operations_dir/'preflight-cache.sql').read_text())
gates=f"SET LOCAL citrus.retirement_release_verified='true'; SET LOCAL citrus.retirement_external_callers_verified='true'; SET LOCAL citrus.retirement_restore_verified='true'; SET LOCAL citrus.retirement_expected_rows='{backup['count']}'; SET LOCAL citrus.retirement_expected_md5='{backup['content_md5']}';"
# Attestations below are local test fixture settings, never production claims.
sql('BEGIN;'+gates+(args.operations_dir/'quarantine-cache.sql').read_text()+'COMMIT;')
assert sql("select to_regclass('public.projection_cache') is null;")=='t'
retired=metadata('projection_cache_retired_20260912');assert retired==before,(before,retired)
sql('BEGIN;'+(args.operations_dir/'restore-cache.sql').read_text()+'COMMIT;')
after=metadata('projection_cache');assert after==before
assert sql('select count(*) from projection_cache c left join nhl_games g using(game_id) where g.game_id is null;')=='0'
print(json.dumps({'backup_sha256':hashlib.sha256(args.backup.read_bytes()).hexdigest(),'backup_captured_at':backup.get('captured_at'),'backup_rows':backup['count'],'content_md5':backup['content_md5'],'metadata_before_and_after':before,'checks':['Actual backup restored into full schema with real NHL parent rows and foreign key intact','Quarantine renamed only the table, preserving OID, rows/hash, ACLs/RLS, policy/constraint/index OIDs','Inverse rename restored original endpoint name and identical metadata/data','No dangling game foreign keys'],'operations_sha256':{f:hashlib.sha256((args.operations_dir/f).read_bytes()).hexdigest() for f in ['preflight-cache.sql','quarantine-cache.sql','restore-cache.sql']},'scope':'Isolated local container only; does not establish production release/external caller approval'},indent=2))
