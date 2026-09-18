-- Website-only Stripe fulfilment ledger. Browser roles cannot write a purchase
-- or an entitlement; only the verified webhook's service-role client executes
-- the RPC below.
CREATE TABLE public.draft_kit_checkout_payments (
  checkout_session_id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payment_intent_id text NOT NULL UNIQUE,
  tier text NOT NULL CHECK (tier IN ('kit', 'suite')),
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency ~ '^[a-z]{3}$'),
  access_until timestamptz NOT NULL,
  terms_version text NOT NULL,
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.draft_kit_checkout_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.draft_kit_checkout_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.draft_kit_checkout_payments TO authenticated;
GRANT ALL ON public.draft_kit_checkout_payments TO service_role;
-- The existing entitlement table is service-role written by design. State the
-- grant here too, so this migration's fulfiller does not depend on historical
-- default privileges.
GRANT SELECT, INSERT, UPDATE ON public.draft_kit_entitlements TO service_role;
CREATE UNIQUE INDEX draft_kit_stripe_checkout_grant_unique
  ON public.draft_kit_entitlements (source, notes)
  WHERE source = 'stripe_checkout';
CREATE POLICY draft_kit_checkout_payment_owner_read ON public.draft_kit_checkout_payments
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE FUNCTION public.fulfill_draft_kit_checkout(
  p_session text, p_user uuid, p_intent text, p_tier text, p_amount integer,
  p_currency text, p_access_until timestamptz, p_terms text
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.draft_kit_checkout_payments AS payment
    (checkout_session_id,user_id,payment_intent_id,tier,amount_minor,currency,access_until,terms_version)
  VALUES (p_session,p_user,p_intent,p_tier,p_amount,p_currency,p_access_until,p_terms)
  ON CONFLICT (checkout_session_id) DO UPDATE SET updated_at = now()
    WHERE payment.user_id = EXCLUDED.user_id AND payment.payment_intent_id = EXCLUDED.payment_intent_id
      AND payment.tier = EXCLUDED.tier AND payment.amount_minor = EXCLUDED.amount_minor
      AND payment.currency = EXCLUDED.currency AND payment.access_until = EXCLUDED.access_until
      AND payment.terms_version = EXCLUDED.terms_version AND payment.status = 'paid';
  IF NOT FOUND THEN RAISE EXCEPTION 'Checkout identity or terms conflict'; END IF;

  INSERT INTO public.draft_kit_entitlements (user_id,tier,source,expires_at,notes)
  VALUES (p_user,p_tier,'stripe_checkout',p_access_until,'Stripe Checkout session ' || p_session)
  ON CONFLICT DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.fulfill_draft_kit_checkout(text,uuid,text,text,integer,text,timestamptz,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_draft_kit_checkout(text,uuid,text,text,integer,text,timestamptz,text) TO service_role;

CREATE FUNCTION public.revoke_draft_kit_checkout(p_intent text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE session_id text;
BEGIN
  UPDATE public.draft_kit_checkout_payments
  SET status = 'revoked', updated_at = now()
  WHERE payment_intent_id = p_intent
  RETURNING checkout_session_id INTO session_id;
  IF session_id IS NULL THEN RETURN; END IF;
  -- Preserve the grant record for support/audit, but make it immediately fail
  -- the existing entitlement resolver rather than leaving paid access live.
  UPDATE public.draft_kit_entitlements
  SET expires_at = now()
  WHERE source = 'stripe_checkout' AND notes = 'Stripe Checkout session ' || session_id
    AND (expires_at IS NULL OR expires_at > now());
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_draft_kit_checkout(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_draft_kit_checkout(text) TO service_role;
