#!/usr/bin/env python3
"""Run the real schema + pinned production functions in an isolated Docker database.
No production connection, host port, production credentials or external network.
"""
import argparse,hashlib,json,subprocess,sys,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
HERE=Path(__file__).resolve().parent
IMAGE='public.ecr.aws/supabase/postgres:17.6.1.159'
MIGRATIONS=sorted((ROOT/'supabase/migrations').glob('20260912073*.sql'))
def command(args,input=None):
 p=subprocess.run(args,input=input,text=True,capture_output=True)
 if p.returncode: raise RuntimeError(f'{args[0:3]} failed: {p.stderr[-5000:]} {p.stdout[-1000:]}')
 return p.stdout

def run(container):
 def sql(s):return command(['docker','exec','-i',container,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],s).strip()
 def query(s):return json.loads(sql(s))
 report={'image':IMAGE,'checks':[],'files':{}}
 snapshot=ROOT/'supabase/schema/production_snapshot_20260813.sql'
 sql(snapshot.read_text())
 alignment=command([sys.executable,str(HERE/'align-production-columns.py'),container]);sql(alignment)
 sql('DROP FUNCTION IF EXISTS public.project_ros(integer);')
 sql((HERE/'production-functions-20260912.sql').read_text())
 catalog=(HERE/'production-stat-catalog-20260912.json').read_text()
 sql("INSERT INTO stat_catalog SELECT * FROM jsonb_populate_recordset(NULL::stat_catalog,$catalog$"+catalog+"$catalog$::jsonb);")
 sql("""DROP TRIGGER IF EXISTS sync_scoring_settings_to_rules_trg ON leagues;CREATE TRIGGER sync_scoring_settings_to_rules_trg AFTER INSERT OR UPDATE OF scoring_settings ON leagues FOR EACH ROW EXECUTE FUNCTION sync_scoring_settings_to_rules();
 INSERT INTO auth.users(id) VALUES('00000000-0000-0000-0000-000000000011');
 INSERT INTO profiles(id,username) VALUES('00000000-0000-0000-0000-000000000011','local_rehearsal');
 INSERT INTO leagues(id,name,commissioner_id,scoring_settings) VALUES('00000000-0000-0000-0000-000000000012','Local rehearsal','00000000-0000-0000-0000-000000000011','{"skater":{"goals":2}}');
 INSERT INTO league_scoring_rules(league_id,stat_key,multiplier) VALUES('00000000-0000-0000-0000-000000000012','shots_on_goal',9) ON CONFLICT(league_id,stat_key) DO UPDATE SET multiplier=9;
 UPDATE leagues SET scoring_settings='{"skater":{"goals":2}}' WHERE id='00000000-0000-0000-0000-000000000012';
 """)
 for path in MIGRATIONS:
  sql('BEGIN;\n'+path.read_text()+'\nCOMMIT;')
 for path in [snapshot,HERE/'production-functions-20260912.sql',HERE/'production-columns-20260912.json',HERE/'production-stat-catalog-20260912.json',*MIGRATIONS]:report['files'][str(path.relative_to(ROOT))]=hashlib.sha256(path.read_bytes()).hexdigest()
 report['alignment_columns']=alignment.count('ADD COLUMN')
 report['checks'].append('Full production public schema and all four transactional migrations loaded')
 assert query("select scoring_settings from leagues where id='00000000-0000-0000-0000-000000000012';")=={'skater':{'goals':2}}
 assert float(sql("select multiplier from league_scoring_rules where league_id='00000000-0000-0000-0000-000000000012' and stat_key='shots_on_goal';"))==0
 sql("update leagues set scoring_settings=null where id='00000000-0000-0000-0000-000000000012';")
 assert float(sql("select multiplier from league_scoring_rules where league_id='00000000-0000-0000-0000-000000000012' and stat_key='shots_on_goal';"))==.9
 assert sql("select scoring_settings is null from leagues where id='00000000-0000-0000-0000-000000000012';")=='t'
 sql("update leagues set scoring_settings='{\"goalie\":{\"saves\":0,\"goals_against\":-1.25}}' where id='00000000-0000-0000-0000-000000000012';")
 rules=query("select json_object_agg(stat_key,multiplier) from league_scoring_rules where league_id='00000000-0000-0000-0000-000000000012';")
 assert len(rules)==35 and rules['saves']==0 and rules['goals_against']==-1.25 and rules['goals']==0
 report['checks'].append('Real 35-category catalog + league FK/trigger path repairs drift, resets defaults and retains explicit zero/negative fractions')
 report['server_version']=sql('show server_version;')
 report['public_tables']=int(sql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r';"))
 # Explicit synthetic observations exercise actual production model code. These
 # are test players, not a claim about any NHL player's measured performance.
 sql("""
 INSERT INTO nhl_teams(team_id,name,abbreviation,city) VALUES(3,'Rangers','NYR','New York'),(6,'Bruins','BOS','Boston');
 INSERT INTO nhl_games(game_id,season,game_type,game_date,home_team,away_team,home_team_id,away_team_id)
 VALUES(2026020001,2026,'regular',current_date,'NYR','BOS',3,6),(2026020002,2026,'regular',current_date+1,'BOS','NYR',6,3);
 INSERT INTO player_directory(season,player_id,full_name,team_abbrev,position_code,is_goalie,birthdate,career)
 VALUES(2026,1,'Rehearsal starter','NYR','G',true,'1995-01-01','{}'),(2026,2,'Rehearsal backup','NYR','G',true,'2000-01-01','{}'),
 (2026,3,'Rehearsal opposing goalie','BOS','G',true,'1997-01-01','{}'),(2026,4,'Rehearsal skater','NYR','C',false,'1999-01-01','{}'),
 (2026,5,'Rehearsal rookie','BOS','C',false,'2006-01-01','{"draft":{"overall":8}}'),(2026,6,'Rehearsal zero backup','BOS','G',true,'2002-01-01','{}');
 INSERT INTO player_game_stats(season,game_id,game_date,player_id,is_goalie,goalie_gp,nhl_goals,nhl_assists,nhl_shots_on_goal,nhl_blocks,nhl_ppp,nhl_shp,nhl_hits,nhl_pim,nhl_plus_minus,nhl_wins,nhl_saves,nhl_shutouts,nhl_goals_against,nhl_toi_seconds)
 SELECT 2025,2025020000+g,current_date-100-g,p,p<4,CASE WHEN p<4 THEN 1 ELSE 0 END,CASE WHEN p=4 THEN 1 ELSE 0 END,0,2,1,0,0,1,0,0,CASE WHEN p<4 THEN 1 ELSE 0 END,CASE WHEN p<4 THEN 25 ELSE 0 END,0,CASE WHEN p<4 THEN 2 ELSE 0 END,1200
 FROM generate_series(1,20) g CROSS JOIN generate_series(1,4) p;
 """)
 report['real_model_rows']=query("select json_build_object('project_ros',(select count(*) from project_ros(2026)),'project_rookies',(select count(*) from project_rookies(2026))); ")
 legacy_ros=query('select row_to_json(r) from rebuild_ros_projections(2026) r;')
 legacy_daily=query('select row_to_json(r) from rebuild_player_projected_stats(2026) r;')
 assert legacy_ros['rows_written']==6 and legacy_daily['rows_written']>0,(legacy_ros,legacy_daily)
 report['legacy_fallback']={'ros':legacy_ros,'daily':legacy_daily};report['checks'].append('No active canonical run executes both real legacy writers')
 def player(i,team,gp,goalie=True):
  rates={'wins':.5,'saves':25,'shutouts':.1,'goals_against':2} if goalie else {'goals':.5,'assists':.5,'shots_on_goal':2,'blocks':1,'power_play_points':.2,'short_handed_points':0,'hits':1,'penalty_minutes':1}
  return {'player_id':str(i),'name':f'Rehearsal {i}','team':team,'position':'G' if goalie else 'C','is_goalie':goalie,'status':'projected','availability':{'status':'unknown'},'sources':[{'file':'rehearsal synthetic fixture'}],'rate_policy':'preserve_override' if goalie else ('refresh_model' if i==4 else 'refresh_cohort'),'exposure_policy':'preserve_season_override' if i!=5 else 'model_remaining','exposure':{'used':gp,'unit':'starts' if goalie else 'games'},'rates':rates,'counts':{k:v*gp for k,v in rates.items()}}
 payload={'schema_version':'citrus.canonical-projection-inputs.v1','season':2026,'revision':'a'*64,'players':[player(1,'NYR',1.5),player(2,'NYR',.5),player(3,'BOS',2),player(4,'NYR',2,False),player(5,'BOS',1,False),player(6,'BOS',0)],'scope_player_ids':['1','2','3','4','5','6'],'schedule':{'NYR':2,'BOS':2},'teams':[{'team':'NYR','lineup_slots':[{'player_id':'1'},{'player_id':'4'}]},{'team':'BOS','lineup_slots':[{'player_id':'3'},{'player_id':'5'}]}],'publish_blockers':[],'contract':{'publication_ready':True}}
 def stage(p): return sql("select canonical_stage_projection_run($payload$"+json.dumps(p)+"$payload$::jsonb);")
 source=stage(payload)
 validation=query(f"select canonical_validate_projection_run('{source}');");assert validation['valid'],validation
 activated=query(f"select canonical_activate_projection_run('{source}','{'a'*64}');")
 assert activated['readiness']=='published'
 identity=query("""select json_agg(x) from (select r.player_id,r.games_remaining gp,sum(d.projected_gp) daily_gp,r.projected_saves_ros saves,sum(d.projected_saves) daily_saves,r.total_projected_points points,sum(d.total_projected_points) daily_points,bool_and(d.projection_run_id=r.projection_run_id and d.projection_revision=r.projection_revision) matched from player_ros_projections r join player_projected_stats d using(player_id) group by r.player_id) x;""")
 for row in identity:
  assert abs(row['gp']-row['daily_gp'])<1e-10 and abs(row['saves']-row['daily_saves'])<1e-10 and abs(row['points']-row['daily_points'])<1e-10 and row['matched'],row
 report['identity']=identity;report['checks'].append('Atomic publication preserves fractional starts and ROS/daily category, points and revision identity')
 refreshed=query('select canonical_refresh_projection_run(2026);');assert refreshed.get('status')!='failed',refreshed
 current=refreshed['revision'];assert current!=payload['revision']
 published=query("select row_to_json(r) from (select revision,source_revision,last_refresh_status from canonical_published_runs) r;")
 assert published['source_revision']==payload['revision'] and published['last_refresh_status']=='success'
 report['refresh']=published;report['checks'].append('Nightly refresh executes real veteran/cohort models and retains authoritative source identity')
 # Force a derivative write failure only inside this disposable database.
 sql("CREATE FUNCTION rehearsal_reject_daily() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'rehearsal derivative failure';END$$; CREATE TRIGGER rehearsal_reject_daily BEFORE INSERT ON player_projected_stats FOR EACH ROW EXECUTE FUNCTION rehearsal_reject_daily();")
 failed=query('select canonical_refresh_projection_run(2026);');assert failed['status']=='failed',failed
 assert sql('select revision from canonical_published_runs;')==current
 assert sql('select count(*) from player_projected_stats;')=='12'
 sql('DROP TRIGGER rehearsal_reject_daily ON player_projected_stats;DROP FUNCTION rehearsal_reject_daily();')
 report['checks'].append('Real table trigger failure rolls back new run, pointer and derivative writes while failure health persists')
 payload['revision']='b'*64;next_id=stage(payload)
 try:sql(f"select canonical_activate_projection_run('{next_id}','{'b'*64}','{'a'*64}');")
 except RuntimeError as e:assert 'Active revision changed' in str(e)
 else:raise AssertionError('Stale CAS accepted')
 query(f"select canonical_activate_projection_run('{next_id}','{'b'*64}','{current}');")
 report['checks'].append('Stale editor CAS rejected; exact current revision accepted')
 # Real RLS: authenticated sees active/source only, cannot stage.
 assert sql('SET ROLE authenticated; SELECT count(*) FROM canonical_published_players;').splitlines()[-1]=='6'
 try:sql("SET ROLE authenticated; SELECT canonical_stage_projection_run('{}');")
 except RuntimeError as e:assert 'permission denied' in str(e)
 else:raise AssertionError('Authenticated mutation accepted')
 report['checks'].append('Real snapshot roles/RLS permit published reads and reject authenticated staging')
 return report
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--container',help='Reuse only an existing citrus-canonical-rehearsal-* disposable container');parser.add_argument('--keep',action='store_true');args=parser.parse_args()
 container=args.container or 'citrus-canonical-rehearsal-'+uuid.uuid4().hex[:10]
 if not container.startswith('citrus-canonical-rehearsal-'):raise SystemExit('Refusing non-rehearsal container')
 created=not args.container
 try:
  if created:
   command(['docker','run','--detach','--name',container,'--network','none','-e','POSTGRES_PASSWORD=local-rehearsal-only',IMAGE])
   for _ in range(100):
    p=subprocess.run(['docker','exec',container,'pg_isready','-U','postgres'],capture_output=True)
    logs=subprocess.run(['docker','logs',container],capture_output=True,text=True)
    if p.returncode==0 and 'PostgreSQL init process complete' in (logs.stdout+logs.stderr):break
    import time;time.sleep(.1)
   else:raise RuntimeError('Database did not become ready')
  print(json.dumps(run(container),indent=2))
 finally:
  if created and not args.keep:command(['docker','rm','--force',container])
