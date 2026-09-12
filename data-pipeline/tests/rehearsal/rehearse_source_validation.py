#!/usr/bin/env python3
"""Validate a DRAFT, or activate an explicitly labeled test copy, in a rollback-only local transaction."""
import argparse,hashlib,json,subprocess,copy
from pathlib import Path
HERE=Path(__file__).resolve().parent
p=argparse.ArgumentParser();p.add_argument('--container',required=True);p.add_argument('--source',required=True,type=Path);p.add_argument('--activate-test-copy',action='store_true');a=p.parse_args()
if not a.container.startswith('citrus-canonical-rehearsal-'):raise SystemExit('Refusing non-rehearsal container')
def sql(body):
 r=subprocess.run(['docker','exec','-i',a.container,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],input=body,text=True,capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
def lit(data):return "$source$"+json.dumps(data)+"$source$::jsonb"
original_bytes=a.source.read_bytes();source=json.loads(original_bytes);directory=json.loads((HERE/'source-directory-20260912.json').read_text());schedule=json.loads((HERE/'source-schedule-20260912.json').read_text())
# Full-schema runner's synthetic rows are removed only inside this rollback-only session.
setup='BEGIN; DELETE FROM canonical_projection_active; DELETE FROM canonical_projection_players; DELETE FROM canonical_projection_runs; DELETE FROM player_projected_stats; DELETE FROM player_ros_projections; DELETE FROM player_directory; DELETE FROM nhl_games;'
setup+='INSERT INTO nhl_teams SELECT * FROM jsonb_populate_recordset(NULL::nhl_teams,'+lit(schedule['teams'])+') ON CONFLICT DO NOTHING;'
setup+='INSERT INTO nhl_games SELECT * FROM jsonb_populate_recordset(NULL::nhl_games,'+lit(schedule['games'])+');'
setup+='INSERT INTO player_directory(season,player_id,full_name,team_abbrev,position_code,is_goalie) SELECT season,player_id,full_name,team_abbrev,position_code,is_goalie FROM jsonb_populate_recordset(NULL::player_directory,'+lit(directory)+');'

if not a.activate_test_copy:
 setup+='SELECT canonical_validate_projection_run(canonical_stage_projection_run('+lit(source)+')); ROLLBACK;'
 lines=sql(setup).splitlines();validation=next(json.loads(x) for x in lines if x.startswith('{'))
 report={'validation':validation,'distinct_error_codes':sorted(set(e['code'] for e in validation['errors']))}
else:
 assert source['publish_blockers'] and all(b['code']=='ROSTER_ROLE_SCENARIOS_NOT_CONFIRMED' for b in source['publish_blockers']), 'Only explicit publication review gate may be cleared in local test copy'
 test=copy.deepcopy(source);test['publish_blockers']=[];test['contract']['publication_ready']=True
 test['local_rehearsal']={'scope':'REVIEWED TEST COPY ONLY; no human approval or production publication implied','original_revision':source['revision']}
 test['revision']=hashlib.sha256(json.dumps({k:v for k,v in test.items() if k!='revision'},sort_keys=True,separators=(',', ':'),allow_nan=False).encode()).hexdigest()
 assert test['players']==source['players'] and test['teams']==source['teams'] and test['schedule']==source['schedule']
 fingerprint="SELECT json_build_object("+','.join("'"+t+"',(SELECT md5(coalesce(string_agg(row_to_json(x)::text,'' ORDER BY row_to_json(x)::text),'')) FROM "+t+" x)" for t in ['canonical_projection_active','canonical_projection_runs','canonical_projection_players','player_ros_projections','player_projected_stats','player_directory','nhl_games'])+");"
 before=json.loads(sql(fingerprint))
 mapping={'goals':('projected_goals','projected_goals'),'assists':('projected_assists','projected_assists'),'shots_on_goal':('projected_sog','projected_sog'),'blocks':('projected_blocks','projected_blocks'),'power_play_points':('projected_ppp','projected_ppp'),'short_handed_points':('projected_shp','projected_shp'),'hits':('projected_hits','projected_hits'),'penalty_minutes':('projected_pim','projected_pim'),'wins':('projected_wins_ros','projected_wins'),'saves':('projected_saves_ros','projected_saves'),'shutouts':('projected_shutouts_ros','projected_shutouts'),'goals_against':('projected_ga_ros','projected_goals_against')}
 setup+='CREATE TEMP TABLE rehearsal_run AS SELECT canonical_stage_projection_run('+lit(test)+') id;'
 setup+="SELECT json_build_object('validation',canonical_validate_projection_run(id)) FROM rehearsal_run;"
 setup+="SELECT json_build_object('activation',canonical_activate_projection_run(id,'"+test['revision']+"',NULL)) FROM rehearsal_run;"
 stats=','.join("'"+k+"',json_build_array(r."+cols[0]+",(SELECT sum(d."+cols[1]+") FROM player_projected_stats d WHERE d.player_id=r.player_id))" for k,cols in mapping.items())
 setup+="SELECT json_build_object('rows',json_agg(json_build_object('player_id',r.player_id,'gp',r.games_remaining,'daily_gp',(SELECT sum(d.projected_gp) FROM player_projected_stats d WHERE d.player_id=r.player_id),'points',r.total_projected_points,'daily_points',(SELECT sum(d.total_projected_points) FROM player_projected_stats d WHERE d.player_id=r.player_id),'stats',json_build_object("+stats+")))) FROM player_ros_projections r;"
 setup+="SELECT json_build_object('daily_rows',count(*),'bad_stamps',count(*) FILTER(WHERE projection_revision<>'"+test['revision']+"' OR projection_run_id IS DISTINCT FROM (SELECT id FROM rehearsal_run))) FROM player_projected_stats;"
 setup+="SELECT json_build_object('bad_ros_stamps',count(*) FILTER(WHERE projection_revision<>'"+test['revision']+"' OR projection_run_id IS DISTINCT FROM (SELECT id FROM rehearsal_run))) FROM player_ros_projections; ROLLBACK;"
 results=[json.loads(x) for x in sql(setup).splitlines() if x.startswith('{')]
 assert results[0]['validation']['valid'],results[0]
 expected={str(p['player_id']):p for p in source['players'] if p['status']=='projected'}
 rows=results[2]['rows'];assert len(rows)==len(expected)
 defaults=json.loads((HERE.parents[2]/'packages/shared/src/constants/scoringDefaults.json').read_text())['stats']
 for row in rows:
  p=expected[str(row['player_id'])]
  source_points=sum(p['counts'].get(stat['key'],0)*stat['points'] for stat in defaults if stat['group']==('goalie' if p['is_goalie'] else 'skater'))
  assert abs(row['points']-source_points)<1e-8,(p['player_id'],row['points'],source_points)
  assert abs(row['gp']-p['exposure']['used'])<1e-8 and abs(row['daily_gp']-row['gp'])<1e-8,row
  assert abs(row['points']-row['daily_points'])<1e-8,row
  for stat,values in row['stats'].items():
   assert abs(values[0]-p['counts'].get(stat,0))<1e-8 and abs(values[0]-values[1])<1e-8,(p['player_id'],stat,values)
 assert results[3]['bad_stamps']==0 and results[4]['bad_ros_stamps']==0,results[3:]
 after=json.loads(sql(fingerprint));assert before==after,'Rollback did not preserve prior database contents'
 assert a.source.read_bytes()==original_bytes,'Original DRAFT source changed'
 unmapped=[{'player_id':p['player_id'],'stat':k,'count':v} for p in expected.values() for k,v in p['counts'].items() if k not in mapping and v!=0]
 report={'test_revision':test['revision'],'validation':results[0]['validation'],'activation':results[1]['activation'],'projected_players':len(rows),'daily_rows':results[3]['daily_rows'],'checked_categories':list(mapping),'unmapped_nonzero_categories':unmapped,'source_players_teams_schedule_unchanged':True,'original_draft_bytes_unchanged':True,'rollback_fingerprints':before,'checks':['All projected player IDs and exposure match source','All exported categories match source and daily sums per player within 1e-8','ROS and daily default points match source scored from shared scoring JSON per player within 1e-8','All ROS/daily rows carry activated test run and revision','Rollback restored original pointer, runs, player records, outputs, directory and schedule']}
report.update({'source_revision':source['revision'],'source_sha256':hashlib.sha256(original_bytes).hexdigest(),'directory_rows':len(directory),'regular_games':len(schedule['games']),'scope':'Isolated local rollback-only rehearsal; test copy is not human approval, original remains DRAFT, no production write'})
report['migration_sha256']={f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted((HERE.parents[2]/'supabase/migrations').glob('20260912073*.sql'))}
print(json.dumps(report,indent=2))
