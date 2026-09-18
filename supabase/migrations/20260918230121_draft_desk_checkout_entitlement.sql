-- One purchase grants downloads and the connected desk. Keep private notes,
-- membership checks and audit history; stop consulting the obsolete PDF ledger.
-- No grants are issued by this migration. Rollback must not restore an older
-- payment gate after checkout starts issuing canonical entitlements.
CREATE TABLE IF NOT EXISTS public.draft_kit_desk_notes (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 league_id uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
 product text NOT NULL DEFAULT 'draft-kit-2026-27' CHECK (product='draft-kit-2026-27'),
 player_key text NOT NULL CHECK (player_key ~ '^canonical:[1-9][0-9]{0,9}$'),
 note text NOT NULL DEFAULT '' CHECK (char_length(note)<=500),
 target boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1 CHECK (version>0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,league_id,product,player_key)
);
CREATE INDEX IF NOT EXISTS draft_kit_desk_notes_league ON public.draft_kit_desk_notes(league_id);
ALTER TABLE public.draft_kit_desk_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.draft_kit_desk_notes FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.draft_kit_desk_notes TO authenticated;
GRANT ALL ON public.draft_kit_desk_notes TO service_role;
GRANT SELECT ON public.draft_kit_entitlements TO authenticated;
DROP POLICY IF EXISTS draft_desk_owner_access ON public.draft_kit_desk_notes;
CREATE POLICY draft_desk_owner_access ON public.draft_kit_desk_notes
 AS RESTRICTIVE FOR ALL TO authenticated
 USING (
  user_id = (SELECT auth.uid()) AND product = 'draft-kit-2026-27'
  AND EXISTS (SELECT 1 FROM public.draft_kit_entitlements e
   WHERE e.user_id = (SELECT auth.uid()) AND e.tier IN ('kit','suite')
   AND e.granted_at <= now() AND (e.expires_at IS NULL OR e.expires_at > now()))
  AND (EXISTS (SELECT 1 FROM public.leagues l WHERE l.id = league_id AND l.commissioner_id = (SELECT auth.uid()))
   OR EXISTS (SELECT 1 FROM public.teams t WHERE t.league_id = draft_kit_desk_notes.league_id AND t.owner_id = (SELECT auth.uid())))
 ) WITH CHECK (
  user_id = (SELECT auth.uid()) AND product = 'draft-kit-2026-27'
  AND EXISTS (SELECT 1 FROM public.draft_kit_entitlements e
   WHERE e.user_id = (SELECT auth.uid()) AND e.tier IN ('kit','suite')
   AND e.granted_at <= now() AND (e.expires_at IS NULL OR e.expires_at > now()))
  AND (EXISTS (SELECT 1 FROM public.leagues l WHERE l.id = league_id AND l.commissioner_id = (SELECT auth.uid()))
   OR EXISTS (SELECT 1 FROM public.teams t WHERE t.league_id = draft_kit_desk_notes.league_id AND t.owner_id = (SELECT auth.uid())))
 );
DROP POLICY IF EXISTS draft_desk_read ON public.draft_kit_desk_notes;
DROP POLICY IF EXISTS draft_desk_insert ON public.draft_kit_desk_notes;
DROP POLICY IF EXISTS draft_desk_update ON public.draft_kit_desk_notes;
CREATE POLICY draft_desk_read ON public.draft_kit_desk_notes FOR SELECT TO authenticated USING(true);
CREATE POLICY draft_desk_insert ON public.draft_kit_desk_notes FOR INSERT TO authenticated WITH CHECK(true);
CREATE POLICY draft_desk_update ON public.draft_kit_desk_notes FOR UPDATE TO authenticated USING(true) WITH CHECK(true);
