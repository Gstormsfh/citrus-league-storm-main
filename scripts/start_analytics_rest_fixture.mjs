// Local disposable fixture only. The owning Docker container must use tmpfs.
// Setup: ANALYTICS_TEST_PG_PORT=<port> node this-file setup
// Gateway: ANALYTICS_TEST_REST_PORT=<port> node this-file gateway
import {Client} from 'pg';
import {readFile} from 'node:fs/promises';
import {createServer,request} from 'node:http';
import assert from 'node:assert/strict';

const mode=process.argv[2];
const port=Number(process.env[mode==='setup'?'ANALYTICS_TEST_PG_PORT':'ANALYTICS_TEST_REST_PORT']);
assert(Number.isInteger(port)&&port>=1024&&port<=65535,'Explicit disposable local port required');
if(mode==='setup') {
  const db=new Client({host:'127.0.0.1',port,user:'postgres',database:'postgres',password:'',ssl:false,
    connectionTimeoutMillis:3000,application_name:'citrus-disposable-rest-setup'});
  await db.connect();
  try {
    const {rows:[existing]}=await db.query(`SELECT
      (SELECT count(*) FROM pg_namespace WHERE nspname NOT IN ('public','information_schema') AND nspname !~ '^pg_')+
      (SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace)+
      (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace)+
      (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','authenticator')) AS n`);
    assert.equal(Number(existing.n),0,'Refusing nonempty database or pre-existing fixture roles');
    await db.query('BEGIN');
    await db.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE ROLE authenticator LOGIN NOINHERIT;
      GRANT anon,authenticated,service_role TO authenticator;`);
    const sql=await readFile(new URL('../supabase/migrations/20260906005705_analytics_versioned_publication_contract.sql',import.meta.url),'utf8');
    // Keep all fixture setup in one transaction, including role creation.
    await db.query(sql.replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,''));
    await db.query('COMMIT');
    console.log(JSON.stringify({event:'analytics_rest_fixture.setup',status:'ready',port,hosted_access:false}));
  } catch(error) {await db.query('ROLLBACK');throw error;}
  finally {await db.end();}
} else if(mode==='gateway') {
  // Pure transport routing only: preserve real clients' /rest/v1 paths and
  // exact headers/Content-Range, with no mocked database response or buffering.
  const server=createServer((req,res)=>{
    if(!req.url?.startsWith('/rest/v1/')) {res.writeHead(404);res.end();return;}
    const headers={...req.headers,host:`127.0.0.1:${port}`};
    const upstream=request({hostname:'127.0.0.1',port,path:req.url.slice('/rest/v1'.length),
      method:req.method,headers,timeout:120000},response=>{
      res.writeHead(response.statusCode??502,response.headers);response.pipe(res);
    });
    upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
    upstream.on('timeout',()=>upstream.destroy());
    req.on('aborted',()=>upstream.destroy());req.pipe(upstream);
  });
  server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({event:'analytics_rest_fixture.gateway',
    status:'ready',url:`http://127.0.0.1:${server.address().port}`,upstream_port:port})));
  for(const sig of ['SIGINT','SIGTERM']) process.on(sig,()=>server.close(()=>process.exit(0)));
} else throw new Error('Use setup or gateway');
