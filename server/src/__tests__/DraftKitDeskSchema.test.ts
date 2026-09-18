import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222', C='33333333-3333-4333-8333-333333333333';
const L='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', M='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES ('${A}'),('${B}'),('${C}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE public.leagues(id uuid PRIMARY KEY, commissioner_id uuid);
    CREATE TABLE public.teams(id uuid PRIMARY KEY, league_id uuid, owner_id uuid);
    INSERT INTO leagues VALUES ('${L}','${A}'),('${M}','${C}');
    INSERT INTO teams VALUES ('${B}','${L}','${B}');
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    GRANT SELECT ON leagues,teams TO authenticated;`);
  for (const file of ['20260902090000_draft_kit_entitlements_and_blurbs.sql','20260918230121_draft_desk_checkout_entitlement.sql'])
    await db.exec(await readFile(new URL(`../../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  for (const id of [A,B,C]) await db.exec(`INSERT INTO draft_kit_entitlements(user_id,tier,source,granted_at,expires_at)
    VALUES('${id}','kit','stripe_checkout',now()-interval '1 hour','2099-07-01')`);
}, 30000);
afterAll(async () => { await db?.close(); });
async function asOwner(id: string, sql: string) {
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${id}',false);`);
  try { return await db.query(sql); } finally { await db.exec('RESET ROLE'); }
}
const insert = (user: string, league = L, key = 'canonical:8478402') => `INSERT INTO draft_kit_desk_notes(user_id,league_id,player_key,note,target) VALUES('${user}','${league}','${key}','Private',true)`;
describe('Draft desk PostgreSQL ownership policies', () => {
  it('lets two buyers in one league save different private notes', async () => {
    await asOwner(A, insert(A)); await asOwner(B, insert(B));
    for (const id of [A,B]) {
      const rows = (await asOwner(id, 'SELECT user_id,note FROM draft_kit_desk_notes')).rows;
      expect(rows).toEqual([{ user_id: id, note: 'Private' }]);
    }
  });
  it('denies forged ownership, nonmembers, moving rows and anonymous access', async () => {
    await expect(asOwner(B, insert(A,L,'canonical:2'))).rejects.toThrow(/row-level security/);
    await expect(asOwner(C, insert(C))).rejects.toThrow(/row-level security/);
    await expect(asOwner(A, `UPDATE draft_kit_desk_notes SET league_id='${M}'`)).rejects.toThrow(/row-level security/);
    await expect(asOwner(A, `UPDATE draft_kit_desk_notes SET user_id='${C}'`)).rejects.toThrow(/row-level security/);
    await db.exec('SET ROLE anon');
    try { await expect(db.query('SELECT * FROM draft_kit_desk_notes')).rejects.toThrow(/permission denied/); }
    finally { await db.exec('RESET ROLE'); }
  });
  it('enforces note size and immutable purchase grants', async () => {
    await expect(asOwner(A, `UPDATE draft_kit_desk_notes SET note=repeat('x',501)`)).rejects.toThrow(/check constraint/);
    await expect(asOwner(A, `DELETE FROM draft_kit_desk_notes`)).rejects.toThrow(/permission denied/);
  });
  it('revocation and removal from the league immediately stop reads and writes', async () => {
    await db.exec(`UPDATE draft_kit_entitlements SET expires_at=now() WHERE user_id='${A}'`);
    expect((await asOwner(A,'SELECT * FROM draft_kit_desk_notes')).rows).toEqual([]);
    await expect(asOwner(A,insert(A,L,'canonical:3'))).rejects.toThrow(/row-level security/);
    await db.exec(`DELETE FROM teams WHERE owner_id='${B}'`);
    expect((await asOwner(B,'SELECT * FROM draft_kit_desk_notes')).rows).toEqual([]);
    await expect(asOwner(B,insert(B,L,'canonical:3'))).rejects.toThrow(/row-level security/);
  });
  it('an obsolete paid PDF row cannot revive a revoked canonical entitlement',async()=>{
    await db.exec(`CREATE TABLE draft_kit_pdf_purchases(user_id uuid,status text,access_until timestamptz);
      INSERT INTO draft_kit_pdf_purchases VALUES('${A}','paid','2099-07-01')`);
    expect((await asOwner(A,'SELECT * FROM draft_kit_desk_notes')).rows).toEqual([]);
    await expect(asOwner(A,insert(A,L,'canonical:4'))).rejects.toThrow(/row-level security/);
  });
});
