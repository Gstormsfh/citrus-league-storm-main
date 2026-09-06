// Explicit disposable Docker integration; no hosted credentials, NHL calls or volumes.
// CITRUS_TEST_PYTHON=/absolute/python PYTHONPATH=<test-deps> node scripts/test_local_archive_fetch_stack.mjs
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer, request} from 'node:http';
import {createHash, createHmac, randomBytes} from 'node:crypto';
import {mkdtemp, readFile, writeFile, unlink, rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {Client} from 'pg';

const execute=promisify(execFile), root=fileURLToPath(new URL('..',import.meta.url));
const python=process.env.CITRUS_TEST_PYTHON;
assert.ok(python && isAbsolute(python),'Explicit absolute test Python required');
const pgImage='postgres@sha256:f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3';
const restImage='postgrest/postgrest@sha256:54000f24847d01a2c2302e0041cf0618b875c57fb48507d743cfa9aaa50bf43c';
const name=`citrus-archive-proof-${randomBytes(6).toString('hex')}`;
const network=`${name}-net`, pgName=`${name}-pg`, restName=`${name}-rest`;
const label=`citrus.analytics.proof=${name}`;
const owned=[], removed=[], scratch=await mkdtemp(join(tmpdir(),'citrus-archive-rest-'));
const tokenPath=join(scratch,'synthetic-token'), reportPath=join(scratch,'report.json');
let db, gateway, result, fixtureOwned=false, networkOwned=false;
const shellFree=(file,args,timeout=30000)=>execute(file,args,{cwd:root,timeout,maxBuffer:1024*1024});
const docker=args=>shellFree('docker',args);
const pause=()=>new Promise(resolve=>setTimeout(resolve,250));
async function portFor(container,port){
 const match=(await docker(['port',container,`${port}/tcp`])).stdout.trim().match(/^127\.0\.0\.1:(\d+)$/);
 assert.ok(match,'Expected one explicit localhost port');return Number(match[1]);
}
const emptySQL=`SELECT
 (SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace)+
 (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace)+
 (SELECT count(*) FROM pg_namespace WHERE nspname NOT IN ('public','information_schema') AND nspname !~ '^pg_')+
 (SELECT count(*) FROM pg_roles WHERE rolname IN ('authenticator','service_role','anon','authenticated')) AS n`;
try {
 // Refuse an implicit image download; these exact images must already exist.
 await docker(['image','inspect',pgImage]);await docker(['image','inspect',restImage]);
 // Desktop reaches containers via explicit published localhost ports; an
 // internal-only bridge did not publish them on the tested Docker engine.
 // https://docs.docker.com/desktop/features/networking/networking-how-tos/
 await docker(['network','create','--driver','bridge','--label',label,network]);networkOwned=true;
 await docker(['run','--rm','-d','--pull=never','--name',pgName,'--label',label,'--network',network,
  '--memory','512m','--tmpfs','/var/lib/postgresql/data:rw,size=256m',
  '-e','POSTGRES_HOST_AUTH_METHOD=trust','-p','127.0.0.1::5432',pgImage]);owned.push(pgName);
 const pgPort=await portFor(pgName,5432);
 let ready=false;
 for(let i=0;i<60;i++){
  // initdb's temporary Unix-socket server also answers pg_isready; require
  // TCP so the final server, not the short-lived initialization one, is ready.
  try{await docker(['exec',pgName,'pg_isready','-h','127.0.0.1','-U','postgres']);ready=true;break;}catch{await pause();}
 }
 assert.ok(ready,'Disposable PostgreSQL did not become ready');
 db=new Client({host:'127.0.0.1',port:pgPort,user:'postgres',database:'postgres',password:'',ssl:false,
  connectionTimeoutMillis:3000,application_name:'citrus-local-archive-proof'});
 // Let awaited queries/cleanup report a disconnect instead of an unhandled
 // idle-client error terminating the process before Docker cleanup runs.
 db.on('error',()=>{});
 await db.connect();await db.query("SET statement_timeout='10s'; SET lock_timeout='5s'");
 assert.equal(Number((await db.query(emptySQL)).rows[0].n),0,'Refusing nonempty fixture database');
 const fixture=(await shellFree(python,['scripts/local_archive_fetch_e2e.py','--print-fixture-ddl'])).stdout;
 await db.query('BEGIN');
 try{
  await db.query('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE authenticator LOGIN NOINHERIT; GRANT service_role TO authenticator;');
  await db.query(fixture);await db.query('COMMIT');fixtureOwned=true;
 }catch(error){await db.query('ROLLBACK');throw error;}
 const migration=await readFile(new URL('../supabase/migrations/20260906050736_fill_archive_boxscore_compare_and_set.sql',import.meta.url),'utf8');
 await db.query(migration);
 const secret=randomBytes(32).toString('hex');
 const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const head=`${encode({alg:'HS256',typ:'JWT'})}.${encode({iss:'citrus-local-integration',role:'service_role',exp:Math.floor(Date.now()/1000)+600})}`;
 await writeFile(tokenPath,`${head}.${createHmac('sha256',secret).update(head).digest('base64url')}`,{flag:'wx',mode:0o600});
 await docker(['run','--rm','-d','--pull=never','--name',restName,'--label',label,'--network',network,
  '--memory','256m','-e',`PGRST_DB_URI=postgres://authenticator@${pgName}:5432/postgres`,
  '-e','PGRST_DB_SCHEMAS=public','-e',`PGRST_JWT_SECRET=${secret}`,
  '-p','127.0.0.1::3000',restImage]);owned.push(restName);
 const restPort=await portFor(restName,3000);
 ready=false;
 for(let i=0;i<60;i++){
  try{const response=await fetch(`http://127.0.0.1:${restPort}/`,{signal:AbortSignal.timeout(1000)});
   if(response.status<500){ready=true;break;}}catch{}await pause();
 }
 assert.ok(ready,'Disposable PostgREST did not become ready');
 // A narrow local Supabase-style path gateway. Transport and SQL remain real.
 gateway=createServer({maxHeaderSize:1024*1024},(incoming,outgoing)=>{
  if(!incoming.url.startsWith('/rest/v1/')){outgoing.writeHead(404).end();return;}
  const upstream=request({host:'127.0.0.1',port:restPort,path:incoming.url.slice('/rest/v1'.length),
   method:incoming.method,headers:{...incoming.headers,host:`127.0.0.1:${restPort}`}},response=>{
    outgoing.writeHead(response.statusCode,response.headers);response.pipe(outgoing);
   });
  upstream.setTimeout(10000,()=>upstream.destroy());
  upstream.on('error',()=>{if(!outgoing.headersSent)outgoing.writeHead(502);outgoing.end();});
  incoming.pipe(upstream);
 });
 await new Promise((resolve,reject)=>{gateway.once('error',reject);gateway.listen(0,'127.0.0.1',resolve);});
 const base=`http://127.0.0.1:${gateway.address().port}`;
 const run=await shellFree(python,['scripts/local_archive_fetch_e2e.py','--base-url',base,
  '--token-file',tokenPath,'--report',reportPath]);
 result=JSON.parse(await readFile(reportPath,'utf8'));
 assert.equal(result.status,'passed');
 result.migrationSha256=createHash('sha256').update(migration).digest('hex');
 result.fixtureSemantics='synthetic rows with captured production column identities/types; no actual NHL source or hosted credential';
 result.postgres=(await db.query('SHOW server_version')).rows[0].server_version;
 result.postgrest=(await docker(['exec',restName,'postgrest','--version'])).stdout.trim();
 result.images={postgres:pgImage,postgrest:restImage};
 result.finalCounts=(await db.query('SELECT (SELECT count(*) FROM raw_nhl_data)::int AS raw_rows,(SELECT count(*) FROM archive_fixture_audits)::int AS audit_rows')).rows[0];
 result.sanitizedLog=run.stdout.trim().split('\n').slice(0,-1);
}finally{
 const cleanupErrors=[];
 if(gateway)try{gateway.closeAllConnections();await new Promise(resolve=>gateway.close(resolve));}catch(e){cleanupErrors.push(e);}
 if(db)try{
  if(fixtureOwned){
   await db.query(`DROP FUNCTION IF EXISTS citrus_fill_archive_boxscore(bigint,date,jsonb,text,timestamptz,jsonb);
    DROP FUNCTION record_rebuild_audit(integer,text,integer,integer,text),archive_fixture_contract();
    DROP TABLE raw_nhl_data,archive_fixture_audits;
    REVOKE USAGE ON SCHEMA public FROM service_role; REVOKE service_role FROM authenticator;
    DROP ROLE authenticator; DROP ROLE service_role; DROP ROLE authenticated; DROP ROLE anon;`);
   assert.equal(Number((await db.query(emptySQL)).rows[0].n),0,'Fixture SQL cleanup residue');
  }
 }catch(e){cleanupErrors.push(e);}finally{await db.end();}
 for(const container of owned.reverse())try{await docker(['stop',container]);removed.push(container);}catch(e){cleanupErrors.push(e);}
 if(networkOwned)try{await docker(['network','rm',network]);}catch(e){cleanupErrors.push(e);}
 try{
  assert.equal((await docker(['ps','-a','--filter',`label=${label}`,'--format','{{.Names}}'])).stdout.trim(),'');
  assert.equal((await docker(['network','ls','--filter',`label=${label}`,'--format','{{.Name}}'])).stdout.trim(),'');
 }catch(e){cleanupErrors.push(e);}
 // Only our two known generated files; never recursive or broad deletion.
 for(const path of [tokenPath,reportPath])try{await unlink(path);}catch(e){if(e.code!=='ENOENT')cleanupErrors.push(e);}
 try{await rmdir(scratch);}catch(e){cleanupErrors.push(e);}
 if(cleanupErrors.length)throw new AggregateError(cleanupErrors,'Disposable fixture cleanup failed');
 if(result)result.cleanup={sqlObjectsAndRoles:0,remainingContainersAndNetworks:0,removedContainers:removed,
  gatewayStopped:true,syntheticTokenRemoved:true,dockerDesktopAndImagesRetained:true};
}
console.log(JSON.stringify(result));
