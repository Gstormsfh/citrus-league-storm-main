#!/usr/bin/env python3
"""Reject/validate an actual draft source on a disposable full-schema database, never activate."""
import argparse,hashlib,json,subprocess
from pathlib import Path
HERE=Path(__file__).resolve().parent
p=argparse.ArgumentParser();p.add_argument('--container',required=True);p.add_argument('--source',required=True,type=Path);a=p.parse_args()
if not a.container.startswith('citrus-canonical-rehearsal-'):raise SystemExit('Refusing non-rehearsal container')
def sql(body):
 r=subprocess.run(['docker','exec','-i',a.container,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],input=body,text=True,capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
def lit(data):return "$source$"+json.dumps(data)+"$source$::jsonb"
source=json.loads(a.source.read_text());directory=json.loads((HERE/'source-directory-20260912.json').read_text());schedule=json.loads((HERE/'source-schedule-20260912.json').read_text())
# Full-schema runner's synthetic rows are removed only inside this rollback-only session.
setup='BEGIN; DELETE FROM canonical_projection_active; DELETE FROM canonical_projection_players; DELETE FROM canonical_projection_runs; DELETE FROM player_projected_stats; DELETE FROM player_ros_projections; DELETE FROM player_directory; DELETE FROM nhl_games;'
setup+='INSERT INTO nhl_teams SELECT * FROM jsonb_populate_recordset(NULL::nhl_teams,'+lit(schedule['teams'])+') ON CONFLICT DO NOTHING;'
setup+='INSERT INTO nhl_games SELECT * FROM jsonb_populate_recordset(NULL::nhl_games,'+lit(schedule['games'])+');'
setup+='INSERT INTO player_directory(season,player_id,full_name,team_abbrev,position_code,is_goalie) SELECT season,player_id,full_name,team_abbrev,position_code,is_goalie FROM jsonb_populate_recordset(NULL::player_directory,'+lit(directory)+');'
setup+='SELECT canonical_validate_projection_run(canonical_stage_projection_run('+lit(source)+')); ROLLBACK;'
lines=sql(setup).splitlines();validation=next(json.loads(x) for x in lines if x.startswith('{'))
print(json.dumps({'source_revision':source['revision'],'source_sha256':hashlib.sha256(a.source.read_bytes()).hexdigest(),'directory_rows':len(directory),'regular_games':len(schedule['games']),'validation':validation,'distinct_error_codes':sorted(set(e['code'] for e in validation['errors'])),'scope':'Actual source rejection preflight, isolated full schema; transaction rolled back, no activation or production write'},indent=2))
