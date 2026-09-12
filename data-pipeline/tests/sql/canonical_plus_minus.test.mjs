import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
const migration = readFileSync('supabase/migrations/20260912101242_canonical_plus_minus_propagation.sql','utf8');
const helper = migration.slice(migration.indexOf('CREATE FUNCTION public.canonical_supplement_plus_minus'),migration.indexOf('CREATE OR REPLACE FUNCTION public.canonical_validate_projection_run'));
test('manual category supplement preserves authored rates and records refreshing per-game provenance',async()=>{
 const db=new PGlite();try{
 await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');await db.exec(helper);
 const p={player_id:'7',status:'projected',is_goalie:false,rate_policy:'preserve_override',rates:{goals:.4,assists:.8},exposure:{used:78}};
 const apply=async(p,m)=>(await db.query("select canonical_supplement_plus_minus($1,$2,'2026-09-12') p",[JSON.stringify(p),JSON.stringify(m)])).rows[0].p;
 const negative=await apply(p,{r_pm:-.2,_model_function:'project_ros'});
 assert.deepEqual(negative.rates,{goals:.4,assists:.8,plus_minus:-.2});assert.deepEqual(negative.exposure,p.exposure);assert.equal(negative.rate_policy,'preserve_override');
 assert.equal(negative.rate_components.plus_minus.policy,'refresh_model');assert.equal(negative.rate_components.plus_minus.unit,'per_game');
 assert.equal((await apply(negative,{r_pm:.1,_model_function:'project_ros'})).rates.plus_minus,.1);
 const authored={...p,rates:{...p.rates,plus_minus:-.3}};assert.deepEqual(await apply(authored,{r_pm:.9}),authored);
 assert.deepEqual(await apply(p,{}),p);assert.deepEqual(await apply({...p,is_goalie:true},{r_pm:.5}),{...p,is_goalie:true});
 assert.deepEqual(await apply({...p,status:'rates_only'},{r_pm:.5}),{...p,status:'rates_only'});
 await assert.rejects(apply(negative,{}),/Previously supported plus_minus model rate missing/);
 assert.equal((await apply(p,{r_pm:0,_model_function:'project_rookies'})).rates.plus_minus,0);
 await db.exec('SET ROLE authenticated');await assert.rejects(apply(p,{r_pm:.5}),/permission denied/);
 }finally{await db.close()}
});
