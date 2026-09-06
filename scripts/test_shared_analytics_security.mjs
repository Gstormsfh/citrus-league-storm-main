// Disposable in-memory PostgreSQL fixture, with captured production grants/policies.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { PGlite }=await import(pathToFileURL(process.env.PGLITE_MODULE));
const db=new PGlite();
const tables=['goalie_gsax_primary','player_projected_stats'];
const manage=['Authenticated users can manage goalie primary shots GSAx','Authenticated users can manage player projected stats'];
let checks=0;
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO PUBLIC;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_user::text $$;`);
for(let i=0;i<tables.length;i++) {
  const t=tables[i];
  await db.exec(`CREATE TABLE ${t}(id integer PRIMARY KEY,value integer);
    ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON ${t} TO anon; GRANT SELECT,INSERT,UPDATE,DELETE ON ${t} TO authenticated;
    GRANT ALL ON ${t} TO service_role;
    CREATE POLICY "${manage[i]}" ON ${t} FOR ALL USING(auth.role()='authenticated') WITH CHECK(auth.role()='authenticated');
    CREATE POLICY fixture_read ON ${t} FOR SELECT USING(true);
    SET ROLE authenticated; INSERT INTO ${t} VALUES(1,10); UPDATE ${t} SET value=11 WHERE id=1; RESET ROLE;`);
  checks++; // Demonstrate the pre-migration vulnerability in a synthetic table.
}
const migration=await readFile(new URL('../supabase/migrations/20260906022414_restrict_shared_analytics_writes.sql',import.meta.url),'utf8');
await db.exec(migration);
await db.exec(migration); checks++; // Permission tightening is replay-safe.
for(const role of ['anon','authenticated']) {
  await db.exec(`SET ROLE ${role}`);
  for(const t of tables) {
    assert.equal((await db.query(`SELECT value FROM ${t} WHERE id=1`)).rows[0].value,11);checks++;
    for(const sql of [`INSERT INTO ${t} VALUES(2,20)`,`UPDATE ${t} SET value=99 WHERE id=1`,`DELETE FROM ${t} WHERE id=1`,`TRUNCATE ${t}`]) {
      await assert.rejects(db.exec(sql),/permission denied/);checks++;
    }
  }
  await db.exec('RESET ROLE');
}
await db.exec('SET ROLE service_role');
for(const t of tables) {
  await db.exec(`INSERT INTO ${t} VALUES(2,20); UPDATE ${t} SET value=21 WHERE id=2; DELETE FROM ${t} WHERE id=2`);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n,1);checks++;
}
await db.close();
console.log(`shared analytics security: ${checks} checks passed (isolated PGlite)`);
