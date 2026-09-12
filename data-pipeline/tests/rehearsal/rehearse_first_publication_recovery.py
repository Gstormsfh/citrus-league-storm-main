#!/usr/bin/env python3
"""Two-commit first-publication/recovery proof in an isolated full-schema fixture."""
import argparse,hashlib,importlib.util,json,tempfile,contextlib
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2]
p=argparse.ArgumentParser();p.add_argument('--container',required=True);p.add_argument('--output-dir',type=Path);a=p.parse_args()
if not a.container.startswith('citrus-canonical-rehearsal-'):raise SystemExit('Refusing non-rehearsal container')
module_path=ROOT/'scripts/ops/projection-release/first-publication/run.py'
spec=importlib.util.spec_from_file_location('recovery_runner',module_path);runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
import subprocess
command=['docker','exec','-i',a.container,'psql','-U','postgres','-d','postgres']
def sql(s):
 r=subprocess.run(command+['-X','-qAt','-v','ON_ERROR_STOP=1'],input=s,text=True,capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
# Only this disposable fixture is reset. Actual production source is untouched.
payload=json.loads(sql('SELECT payload FROM canonical_projection_runs WHERE season=2026 ORDER BY created_at DESC LIMIT 1;'))
payload['local_rehearsal']={'scope':'First-publication recovery test only, synthetic model fixture, not user approval'}
payload['revision']=hashlib.sha256(json.dumps({k:v for k,v in payload.items() if k!='revision'},sort_keys=True,separators=(',',':')).encode()).hexdigest()
runid=sql("SELECT canonical_stage_projection_run($fixture$"+json.dumps(payload)+"$fixture$::jsonb);")
sql('BEGIN;DELETE FROM canonical_projection_active;SELECT * FROM rebuild_ros_projections(2026);SELECT * FROM rebuild_player_projected_stats(2026);COMMIT;')
request=json.dumps({'season':2026,'run_id':runid,'revision':payload['revision']})
checks=[]
if a.output_dir:a.output_dir.mkdir(parents=True,exist_ok=True)
context=contextlib.nullcontext(tempfile.mkdtemp(prefix='citrus-recovery-',dir=a.output_dir)) if a.output_dir else tempfile.TemporaryDirectory(prefix='citrus-recovery-')
with context as directory:
 backup=Path(directory)/'first-publication.json'
 # Existing output file must abort before activation COMMIT.
 backup.write_text('existing file')
 try:runner.run_transaction(command,request,'activate',lambda raw:runner.save_bundle(backup,raw))
 except FileExistsError:pass
 else:raise AssertionError('Backup overwrite was accepted')
 assert sql('select count(*) from canonical_projection_active;')=='0'
 backup.unlink()
 checks.append('Backup creation failure closes transaction and leaves no active publication')
 activated=runner.run_transaction(command,request,'activate',lambda raw:runner.save_bundle(backup,raw))
 assert sql('select run_id from canonical_projection_active;')==runid
 assert backup.stat().st_mode & 0o777==0o600
 raw=runner.load_bundle(backup);bundle=json.loads(raw)
 assert bundle['pre_hashes']['active']['count']==0 and bundle['pre_hashes']['ros']['count']==6 and bundle['post_hashes']['ros']['count']==6
 checks.append('First activation COMMIT occurred only after fresh locked backup was written and fsynced (0600)')
 original_schema=runner.HERE/'restore.sql'
 def reject(raw,needle):
  try:runner.run_transaction(command,raw,'restore')
  except RuntimeError as e:assert needle in str(e),str(e)
  else:raise AssertionError('Unsafe recovery accepted')
  assert sql('select run_id from canonical_projection_active;')==runid
 bad=json.loads(raw);bad['request']['revision']='0'*64;reject(json.dumps(bad),'Recovery active revision CAS changed')
 bad=json.loads(raw);bad['database_date']='2000-01-01';reject(json.dumps(bad),'Recovery calendar changed')
 bad=json.loads(raw);bad['schema']['server_version']='different';reject(json.dumps(bad),'Recovery database/schema changed')
 bad=json.loads(raw);bad['post_hashes']['ros']['md5']='0'*32;reject(json.dumps(bad),'Recovery protected outputs changed')
 checks.append('Stale active CAS, wrong calendar/schema and mismatched expected output hash all refuse recovery without changing publication')
 damaged=json.loads(backup.read_text());damaged['sha256']='0'*64;badfile=Path(directory)/'damaged.json';badfile.write_text(json.dumps(damaged))
 try:runner.load_bundle(badfile)
 except ValueError:pass
 else:raise AssertionError('Damaged envelope accepted')
 checks.append('External bundle corruption rejected before opening recovery transaction')
 restored=runner.run_transaction(command,raw,'restore')
 assert restored['restored'] and restored['history_retained'] and restored['hashes']==bundle['pre_hashes'],(restored,bundle['pre_hashes'])
 assert sql('select count(*) from canonical_projection_active;')=='0'
 assert sql("select count(*) from canonical_projection_runs where id='"+runid+"';")=='1'
 assert int(sql("select count(*) from canonical_projection_players where run_id='"+runid+"';"))==len(payload['players'])
 checks.append('Separate recovery COMMIT restores fresh pre-state hashes and retains immutable run/player history')
 # A second committed activation followed by a legitimate committed materializer
 # run changes updated_at in output rows. The original bundle must now refuse.
 second=Path(directory)/'intervening.json'
 runner.run_transaction(command,request,'activate',lambda value:runner.save_bundle(second,value))
 sql("select canonical_materialize_projection_run('"+runid+"');")
 reject(runner.load_bundle(second),'Recovery protected outputs changed')
 checks.append('Committed intervening canonical materialization invalidates recovery bundle and is not overwritten')
 # Leave this isolated second case published, deliberately preserving the
 # intervening data; the successful first recovery was already independently committed.
 paths=[module_path,*sorted(runner.HERE.glob('*.sql'))]
 report={'checks':checks,'first_activation':{'request':bundle['request'],'database_date':bundle['database_date'],'pre_hashes':bundle['pre_hashes'],'post_hashes':bundle['post_hashes']},'committed_recovery':restored,'retained_backup':str(backup) if a.output_dir else None,'backup_envelope_sha256':json.loads(backup.read_text())['sha256'],'schema_sha256':hashlib.sha256(json.dumps(bundle['schema'],sort_keys=True).encode()).hexdigest(),'files':{str(f.relative_to(ROOT)):hashlib.sha256(f.read_bytes()).hexdigest() for f in paths},'scope':'Isolated synthetic full-schema fixture only; first activation and recovery separately committed; final negative case intentionally retains intervening canonical publication; no production/source mutation'}
 print(json.dumps(report,indent=2))
