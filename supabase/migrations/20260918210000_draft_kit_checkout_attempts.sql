-- One live hosted Checkout Session per customer and commercial edition.
-- Browser clients cannot read or mutate attempts; the authenticated route
-- derives p_user and the service-role checkout service owns these RPCs.
CREATE TABLE public.draft_kit_checkout_attempts (
  attempt_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  price_id text NOT NULL,
  terms_version text NOT NULL,
  checkout_session_id text UNIQUE,
  state text NOT NULL DEFAULT 'creating' CHECK (state IN ('creating', 'open', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.draft_kit_checkout_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.draft_kit_checkout_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.draft_kit_checkout_attempts TO service_role;
CREATE UNIQUE INDEX draft_kit_checkout_attempt_one_active
  ON public.draft_kit_checkout_attempts (user_id, price_id, terms_version)
  WHERE state IN ('creating', 'open');

CREATE FUNCTION public.get_or_create_draft_kit_checkout_attempt(
  p_attempt uuid, p_user uuid, p_price text, p_terms text
) RETURNS TABLE(attempt_id uuid, checkout_session_id text, state text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE existing public.draft_kit_checkout_attempts%ROWTYPE;
BEGIN
  -- Serializes separate tabs and API retries for this customer/edition only.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || p_price || ':' || p_terms, 0));
  SELECT * INTO existing FROM public.draft_kit_checkout_attempts
    WHERE draft_kit_checkout_attempts.attempt_id = p_attempt;
  IF FOUND THEN
    IF existing.user_id <> p_user OR existing.price_id <> p_price OR existing.terms_version <> p_terms THEN
      RAISE EXCEPTION 'Checkout attempt identity conflict';
    END IF;
    RETURN QUERY SELECT existing.attempt_id, existing.checkout_session_id, existing.state;
    RETURN;
  END IF;
  SELECT * INTO existing FROM public.draft_kit_checkout_attempts
    WHERE draft_kit_checkout_attempts.user_id = p_user AND draft_kit_checkout_attempts.price_id = p_price
      AND draft_kit_checkout_attempts.terms_version = p_terms AND draft_kit_checkout_attempts.state IN ('creating', 'open')
    ORDER BY draft_kit_checkout_attempts.created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT existing.attempt_id, existing.checkout_session_id, existing.state;
    RETURN;
  END IF;
  INSERT INTO public.draft_kit_checkout_attempts (attempt_id, user_id, price_id, terms_version)
  VALUES (p_attempt, p_user, p_price, p_terms);
  RETURN QUERY SELECT p_attempt, NULL::text, 'creating'::text;
END;
$$;
REVOKE ALL ON FUNCTION public.get_or_create_draft_kit_checkout_attempt(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_draft_kit_checkout_attempt(uuid,uuid,text,text) TO service_role;

CREATE FUNCTION public.record_draft_kit_checkout_session(p_attempt uuid, p_session text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  UPDATE public.draft_kit_checkout_attempts
  SET checkout_session_id = p_session, state = 'open', updated_at = now()
  WHERE attempt_id = p_attempt AND state IN ('creating', 'open')
    AND (checkout_session_id IS NULL OR checkout_session_id = p_session);
  IF NOT FOUND THEN RAISE EXCEPTION 'Checkout attempt state conflict'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.record_draft_kit_checkout_session(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_draft_kit_checkout_session(uuid,text) TO service_role;

CREATE FUNCTION public.expire_draft_kit_checkout_attempt(p_attempt uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  UPDATE public.draft_kit_checkout_attempts
  SET state = 'expired', updated_at = now()
  WHERE attempt_id = p_attempt AND state IN ('creating', 'open');
END;
$$;
REVOKE ALL ON FUNCTION public.expire_draft_kit_checkout_attempt(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_draft_kit_checkout_attempt(uuid) TO service_role;
