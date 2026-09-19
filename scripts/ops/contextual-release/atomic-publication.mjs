// The first production publication and legacy-cron pause share one transaction.
// The caller supplies independently verified readiness and a durable create-only
// backup sink. This module has no credentials or automatic approval defaults.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkCutover} from './gates.mjs';
import {hash} from './rehearse-production.mjs';
const helpers=readFileSync(new URL('../projection-release/first-publication/context.sql',import.meta.url),'utf8');
const capture=readFileSync(new URL('./capture-active.sql',import.meta.url),'utf8');
export async function atomicPublish(db,{exactRequest,policy,readiness,backup,clock=()=>new Date().toISOString(),commit=false}){
 assert.equal(typeof exactRequest,'string');assert.equal(typeof backup,'function');
 assert.equal(typeof commit,'boolean');let committed=false,failure;
 await db.query('BEGIN');
 try{
  await db.query("SET LOCAL statement_timeout='180s';SET LOCAL lock_timeout='5s'");
  await db.query('SELECT pg_advisory_xact_lock(724811,2026)');
  await db.query('LOCK TABLE canonical_projection_active,player_ros_projections,player_projected_stats IN SHARE ROW EXCLUSIVE MODE');
  const snapshot=(await db.query('SELECT canonical_contextual_dependencies() value')).rows[0].value;
  checkCutover(snapshot,readiness,policy,clock());
  await db.query(helpers);
  await db.query('CREATE TEMP TABLE publication_request(payload jsonb) ON COMMIT DROP');
  // Passing the original text directly to PostgreSQL preserves decimal precision.
  await db.query('INSERT INTO publication_request VALUES($1::jsonb)',[exactRequest]);
  const binding=(await db.query(`SELECT payload#>>'{p_candidate,parent_revision}' parent,
   payload#>>'{p_candidate,source_revision}' source,payload#>>'{p_candidate,refresh_at}' refreshed
   FROM publication_request`)).rows[0];
  assert.equal(binding.parent,readiness.expectedActiveRevision);assert.equal(binding.source,policy.source_revision);
  assert.equal(binding.refreshed.slice(0,10),clock().slice(0,10),'Generation crossed UTC day');
  await db.query(`CREATE TEMP TABLE sealed_publication ON COMMIT DROP AS
   SELECT canonical_seal_contextual_refresh(payload->'p_candidate',payload->'p_context') payload FROM publication_request;
   CREATE TEMP TABLE recovery_request(payload jsonb) ON COMMIT DROP;
   INSERT INTO recovery_request SELECT jsonb_build_object('run_id',canonical_stage_projection_run(s.payload),
    'revision',s.payload->>'revision','expected_active_run_id',(SELECT run_id FROM canonical_projection_active WHERE season=2026))
    FROM sealed_publication s`);
  await db.query(capture);
  const before=(await db.query('SELECT payload::text exact FROM recovery_bundle')).rows[0].exact;
  const beforeReceipt=await backup('before',before,hash(before));
  assert.equal(beforeReceipt?.verifiedSha256,hash(before),'Durable preimage not verified');
  const result=(await db.query(`SELECT canonical_complete_contextual_refresh(payload->'p_candidate',payload->'p_context') result FROM publication_request`)).rows[0].result;
  assert.equal(result.status,'success','Protected completion did not publish successfully');
  await db.query('SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobid IN(31,34) ORDER BY jobid');
  const health=(await db.query('SELECT canonical_contextual_output_health() value')).rows[0].value;
  for(const [family,count,flags,errors] of [
   ['skaters','skaters',['all_contextual','all_uncertainty','all_required_daily_stats_present','all_required_ros_stats_present','optional_plus_minus_coverage_matches'],['maximum_gp_error']],
   ['goalies','goalies',['all_required_daily_stats','all_required_ros_stats'],['maximum_daily_ros_starts_error']]]){
   const row=health[family];assert.ok(Number(row[count])>0&&Number(row.daily_rows)>0);
   for(const key of [...flags,'matching_output_players','daily_ros_revision_matches','active_revision_matches'])assert.equal(row[key],true,key);
   for(const key of [...errors,'maximum_daily_ros_count_error'])assert.ok(row[key]!==null&&Number.isFinite(Number(row[key]))&&Number(row[key])>=0&&Number(row[key])<=1e-7,key);
   assert.equal(Number(row.distinct_revisions),1);
  }
  assert.equal((await db.query('SELECT count(*)::int n FROM draft_freeze_blockers(4,6)')).rows[0].n,0);
  assert.equal(binding.refreshed.slice(0,10),clock().slice(0,10),'Publication crossed UTC day');
  await db.query(`UPDATE recovery_bundle SET payload=payload||jsonb_build_object('post_hashes',pg_temp.canonical_recovery_hashes(2026,current_date),
   'post_jobs',(SELECT jsonb_agg(jsonb_build_object('jobid',jobid,'schedule',schedule,'command',command,'active',active) ORDER BY jobid) FROM cron.job WHERE jobid IN(31,34)))`);
  const envelope=(await db.query('SELECT payload::text exact FROM recovery_bundle')).rows[0].exact;
  const recoveryReceipt=await backup('recovery',envelope,hash(envelope));
  assert.equal(recoveryReceipt?.verifiedSha256,hash(envelope),'Durable recovery envelope not verified');
  if(commit){
   try{await db.query('COMMIT');committed=true;}
   catch{const error=new Error('Commit acknowledgement uncertain; inspect the saved recovery envelope and active database state before retrying.');error.code='COMMIT_UNCERTAIN';throw error;}
  }
  return {status:commit?'published':'rehearsed',result,health,beforeReceipt,recoveryReceipt,requestSha256:hash(exactRequest)};
 }catch(error){failure=error;throw error;}
 finally{if(!committed){try{await db.query('ROLLBACK');}catch(error){if(!failure)throw error;}}}
}
