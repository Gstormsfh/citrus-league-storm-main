#!/usr/bin/env python3
"""Exercise the active-output write boundary against a retained full schema."""
import argparse,json,subprocess,time,hashlib
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--container',required=True);a=p.parse_args()
if not a.container.startswith('citrus-canonical-rehearsal-'):raise SystemExit('Refusing non-rehearsal container')
cmd=['docker','exec','-i',a.container,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At']
def sql(s):
 r=subprocess.run(cmd,input=s,text=True,capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
def rejected(s,needle='Canonical projection write boundary'):
 try:sql(s)
 except RuntimeError as e:assert needle in str(e),str(e)
 else:raise AssertionError('Obsolete writer accepted: '+s)
privileges=json.loads(sql("select json_build_object('service_can_set',pg_has_role('service_role','citrus_canonical_projection_writer','SET'),'postgres_can_set',pg_has_role('postgres','citrus_canonical_projection_writer','SET'),'schema_create',has_schema_privilege('citrus_canonical_projection_writer','public','CREATE'),'role_login',(select rolcanlogin from pg_roles where rolname='citrus_canonical_projection_writer'));"))
assert not any(privileges.values()),privileges
checks=[]
fingerprint="select json_build_object('active',(select md5(json_agg(a order by season)::text) from canonical_projection_active a),'ros',(select md5(json_agg(r order by player_id)::text) from player_ros_projections r),'daily',(select md5(json_agg(d order by projection_id)::text) from player_projected_stats d));"
before=json.loads(sql(fingerprint))
for table,key in [('player_ros_projections','player_id'),('player_projected_stats','projection_id')]:
 for statement in [f'UPDATE {table} SET total_projected_points=999;',f'DELETE FROM {table};',f'INSERT INTO {table} SELECT * FROM {table} LIMIT 1;',f'INSERT INTO {table} SELECT * FROM {table} LIMIT 1 ON CONFLICT({key}) DO UPDATE SET total_projected_points=999;',f'TRUNCATE {table};']:
  rejected('BEGIN; SET LOCAL ROLE service_role;'+statement+'ROLLBACK;')
 checks.append(table+': direct insert/update/delete/upsert retaining original stamps/truncate rejected')
rejected("BEGIN; SET LOCAL ROLE service_role;SET LOCAL citrus.canonical_writer='true';UPDATE player_projected_stats SET projected_saves=999;ROLLBACK;")
rejected('SET ROLE service_role; SET ROLE citrus_canonical_projection_writer;','permission denied')
checks.append('Service role cannot SET ROLE to materializer owner; spoofed GUC cannot authorize writes')
for isolation in ['REPEATABLE READ','SERIALIZABLE']:
 rejected(f'BEGIN ISOLATION LEVEL {isolation};UPDATE player_ros_projections SET total_projected_points=999;ROLLBACK;','retry noncanonical forecast write at READ COMMITTED')
checks.append('RR and serializable noncanonical forecasts explicitly rejected, preventing stale snapshot bypass')
sql('''BEGIN;CREATE TEMP TABLE saved_active AS SELECT * FROM canonical_projection_active;DELETE FROM canonical_projection_active;
UPDATE player_ros_projections SET total_projected_points=12;
UPDATE player_projected_stats SET projection_date=current_date-10;
INSERT INTO canonical_projection_active SELECT * FROM saved_active;
SET LOCAL ROLE service_role;INSERT INTO player_projected_stats SELECT (jsonb_populate_record(NULL::player_projected_stats,to_jsonb(d)||jsonb_build_object('projection_id',gen_random_uuid(),'projection_date',current_date-11))).* FROM player_projected_stats d LIMIT 1;UPDATE player_projected_stats SET total_projected_points=17 WHERE projection_date<current_date;DELETE FROM player_projected_stats WHERE projection_date<current_date;ROLLBACK;''')
checks.append('No-active ROS/daily updates and active-season historical daily insert/update/delete repairs remain allowed')
# Restore canonical data through the only authorized writer, then roll back.
sql('BEGIN; SET LOCAL ROLE service_role; SELECT canonical_materialize_projection_run(run_id) FROM canonical_projection_active;ROLLBACK;')
checks.append('Service-role canonical materialization succeeds through restricted owner role')
# A concurrent reader/writer waits for activation's seasonal advisory lock.
locker=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
locker.stdin.write("BEGIN;SELECT pg_advisory_xact_lock(724811,2026);SELECT 'LOCKED';\n");locker.stdin.flush()
while locker.stdout.readline().strip()!='LOCKED':pass
writer=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
writer.stdin.write("SET ROLE service_role;UPDATE player_projected_stats SET total_projected_points=999;\n");writer.stdin.close()
try:
 blocked=False
 for _ in range(50):
  if sql("SELECT count(*) FROM pg_stat_activity WHERE wait_event='advisory' AND query LIKE 'UPDATE player_projected_stats%';")!='0':blocked=True;break
  time.sleep(.02)
 assert blocked,'Writer did not wait for seasonal lock'
 locker.stdin.write('ROLLBACK;\n');locker.stdin.close();locker.wait(timeout=10)
 writer.wait(timeout=10);assert writer.returncode!=0 and 'Canonical projection write boundary' in writer.stderr.read()
finally:
 if locker.poll() is None:locker.kill()
 if writer.poll() is None:writer.kill()
checks.append('Concurrent legacy writer waits on publication lock, then rejects active output mutation')
assert json.loads(sql(fingerprint))==before
root=Path(__file__).resolve().parents[3];migration=root/'supabase/migrations/20260912073540_canonical_projection_write_boundary.sql'
print(json.dumps({'owner_role_privileges':privileges,'checks':checks,'rollback_fingerprints':before,'migration_sha256':hashlib.sha256(migration.read_bytes()).hexdigest(),'scope':'Isolated full-schema database only; no source change or production write'},indent=2))
