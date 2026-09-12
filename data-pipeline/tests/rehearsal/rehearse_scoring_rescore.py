#!/usr/bin/env python3
"""Actual scoring functions + full-schema rescore transaction, synthetic leagues only."""
import argparse,hashlib,json,re,subprocess
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2]
p=argparse.ArgumentParser();p.add_argument('--container',required=True);a=p.parse_args()
if not a.container.startswith('citrus-canonical-rehearsal-'):raise SystemExit('Refusing non-rehearsal container')
def sql(body):
 r=subprocess.run(['docker','exec','-i',a.container,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],input=body,text=True,capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
paths=[HERE/'production-scoring-functions-20260912.sql',HERE/'production-scoring-view-20260912.sql',ROOT/'scripts/release/scoring-rescore/capture.sql',ROOT/'supabase/migrations/20260912073440_scoring_rules_replace_removed_keys.sql',ROOT/'scripts/release/scoring-rescore/rescore.sql']
tables=['leagues','league_scoring_rules','matchups','fantasy_matchup_lines','fantasy_daily_rosters','teams','player_game_stats','nhl_games']
fingerprint="SELECT json_build_object("+','.join("'"+t+"',(SELECT md5(coalesce(string_agg(row_to_json(x)::text,'' ORDER BY row_to_json(x)::text),'')) FROM "+t+" x)" for t in tables)+");"
before=json.loads(sql(fingerprint))
function_fingerprint="SELECT md5(string_agg(pg_get_functiondef(p.oid),'' ORDER BY p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f';"
before_functions=sql(function_fingerprint)
body='BEGIN ISOLATION LEVEL REPEATABLE READ;'+paths[0].read_text()+paths[1].read_text()
old=(HERE/'production-functions-20260912.sql').read_text();old=old[old.index('CREATE OR REPLACE FUNCTION public.sync_scoring_settings_to_rules'):];body+=old
body+='''
INSERT INTO leagues(id,name,commissioner_id,scoring_settings,settings)
SELECT md5(('rescoreleague'||i)::text)::uuid,'Local rescore '||i,'00000000-0000-0000-0000-000000000011', '{}',
CASE WHEN i=4 THEN '{"scoringFormat":"h2h-categories","categories":["goals","assists"]}'::jsonb ELSE '{}'::jsonb END FROM generate_series(1,5)i;
INSERT INTO league_scoring_rules(league_id,stat_key,multiplier)
SELECT md5(('rescoreleague'||i)::text)::uuid,c.stat_key,CASE WHEN i=5 THEN 0 ELSE 99 END FROM generate_series(1,5)i CROSS JOIN stat_catalog c
ON CONFLICT(league_id,stat_key) DO UPDATE SET multiplier=excluded.multiplier;
UPDATE leagues SET scoring_settings=CASE name WHEN 'Local rescore 1' THEN NULL WHEN 'Local rescore 2' THEN '{"skater":{"goals":0}}'::jsonb WHEN 'Local rescore 3' THEN '{"skater":{"goals":-2}}'::jsonb ELSE '{}'::jsonb END WHERE name LIKE 'Local rescore %';
INSERT INTO teams(id,league_id,team_name) SELECT md5(('rescoreteam'||i||'-'||j)::text)::uuid,md5(('rescoreleague'||i)::text)::uuid,'Local team '||i||'-'||j FROM generate_series(1,5)i CROSS JOIN generate_series(1,2)j;
INSERT INTO matchups(id,league_id,week_number,team1_id,team2_id,week_start_date,week_end_date,team1_score,team2_score,status)
SELECT md5(('rescorematch'||i)::text)::uuid,md5(('rescoreleague'||i)::text)::uuid,1,md5(('rescoreteam'||i||'-1')::text)::uuid,md5(('rescoreteam'||i||'-2')::text)::uuid,current_date-7,current_date-1,99,99,'completed' FROM generate_series(1,5)i;
INSERT INTO matchups(id,league_id,week_number,team1_id,team2_id,week_start_date,week_end_date,team1_score,team2_score)
VALUES(md5('rescorefuture')::uuid,md5('rescoreleague1')::uuid,2,md5('rescoreteam1-1')::uuid,md5('rescoreteam1-2')::uuid,current_date+7,current_date+13,99,99);
INSERT INTO nhl_games(game_id,season,game_type,game_date,home_team,away_team) VALUES(2026029998,2026,'regular',current_date-2,'NYR','BOS');
INSERT INTO player_game_stats(player_id,game_id,season,game_date,is_goalie,nhl_goals,nhl_assists,nhl_shots_on_goal,nhl_toi_seconds)
VALUES(990001,2026029998,2026,current_date-2,false,2,0,0,1200),(990002,2026029998,2026,current_date-2,false,1,0,0,1200);
INSERT INTO fantasy_daily_rosters(league_id,team_id,matchup_id,player_id,roster_date,slot_type)
SELECT md5(('rescoreleague'||i)::text)::uuid,md5(('rescoreteam'||i||'-'||j)::text)::uuid,md5(('rescorematch'||i)::text)::uuid,990000+j,current_date-2,'active' FROM generate_series(1,5)i CROSS JOIN generate_series(1,2)j;
'''
body+=paths[2].read_text()+paths[3].read_text()+paths[4].read_text()
body+="SELECT json_build_object('affected_leagues',(SELECT count(*) FROM scoring_rescore_affected),'scores',(SELECT json_agg(json_build_object('name',l.name,'team1',m.team1_score,'team2',m.team2_score,'week',m.week_number) ORDER BY l.name,m.week_number) FROM matchups m JOIN leagues l ON l.id=m.league_id WHERE l.name LIKE 'Local rescore %'),'point_calibrations',(SELECT bool_and(v.is_calibrated) FROM matchups m JOIN leagues l ON l.id=m.league_id CROSS JOIN LATERAL verify_matchup_scores(m.id) v WHERE l.name IN ('Local rescore 1','Local rescore 2','Local rescore 3') AND m.week_number=1),'source_json',(SELECT json_object_agg(name,scoring_settings) FROM leagues WHERE name LIKE 'Local rescore %')); ROLLBACK;"
result=next(json.loads(x) for x in sql(body).splitlines() if x.startswith('{'))
assert result['affected_leagues']==4,result
expected={'Local rescore 1':(12,6),'Local rescore 2':(0,0),'Local rescore 3':(-4,-2),'Local rescore 4':(1.5,.5),'Local rescore 5':(99,99)}
for row in result['scores']:assert (row['team1'],row['team2'])==((99,99) if row['week']==2 else expected[row['name']]),row
assert result['point_calibrations'] is True
assert result['source_json']=={'Local rescore 1':None,'Local rescore 2':{'skater':{'goals':0}},'Local rescore 3':{'skater':{'goals':-2}},'Local rescore 4':{},'Local rescore 5':{}}
assert json.loads(sql(fingerprint))==before,'Rollback changed original tables'
assert sql(function_fingerprint)==before_functions,'Rollback changed original functions'
result.update({'scope':'Isolated full-schema PostgreSQL; actual read-only-exported scoring functions/view, synthetic leagues/rosters/stats; transaction rolled back, no production writes','rollback_function_fingerprint':before_functions,'rollback_fingerprints':before,'files':{str(f.relative_to(ROOT)):hashlib.sha256(f.read_bytes()).hexdigest() for f in paths},'checks':['Exact capture→073440→rescore composition under REPEATABLE READ','Real v2 points scorer + persisted line verifier calibrate','Real categories scorer gives 1.5–0.5, not fantasy points','Null/default, explicit zero/negative and source JSON preserved','Unaffected league and future matchup unchanged','Entire transaction rollback restores original table contents']})
print(json.dumps(result,indent=2))
