import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const USER = '11111111-1111-4111-8111-111111111111';
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY); INSERT INTO auth.users VALUES ('${USER}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE public.draft_kit_entitlements(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id),tier text NOT NULL,source text NOT NULL,granted_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz,notes text,created_at timestamptz NOT NULL DEFAULT now());
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
  await db.exec(await readFile(new URL('../../../supabase/migrations/20260918150000_draft_kit_stripe_checkout.sql', import.meta.url), 'utf8'));
}, 30000);
afterAll(async () => { await db?.close(); });

describe('Draft Kit Checkout migration rehearsal', () => {
  it('is idempotent for a webhook retry and grants exactly one entitlement', async () => {
    await db.exec('SET ROLE service_role');
    const call = `SELECT public.fulfill_draft_kit_checkout('cs_1','${USER}','pi_1','kit',799,'cad','2027-07-01T05:59:59Z','draft-v1')`;
    await db.exec(call); await db.exec(call); await db.exec('RESET ROLE');
    expect((await db.query('SELECT count(*)::int AS n FROM public.draft_kit_checkout_payments')).rows).toEqual([{ n: 1 }]);
    expect((await db.query("SELECT count(*)::int AS n FROM public.draft_kit_entitlements WHERE source='stripe_checkout'")).rows).toEqual([{ n: 1 }]);
  });
  it('revokes payment and expires the matching entitlement', async () => {
    await db.exec(`SET ROLE service_role; SELECT public.revoke_draft_kit_checkout('pi_1'); RESET ROLE;`);
    expect((await db.query("SELECT status FROM public.draft_kit_checkout_payments WHERE payment_intent_id='pi_1'")).rows).toEqual([{ status: 'revoked' }]);
    expect((await db.query("SELECT expires_at <= now() AS expired FROM public.draft_kit_entitlements WHERE source='stripe_checkout'")).rows).toEqual([{ expired: true }]);
  });
});
