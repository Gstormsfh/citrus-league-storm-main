-- Privacy consent tracking table (Apple/GDPR requirement)
-- Logs when each user accepted which version of privacy policy & ToS.

CREATE TABLE IF NOT EXISTS user_privacy_consent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  policy_type text NOT NULL CHECK (policy_type IN ('privacy_policy', 'terms_of_service')),
  policy_version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text
);

CREATE INDEX idx_privacy_consent_user ON user_privacy_consent(user_id);
CREATE INDEX idx_privacy_consent_type ON user_privacy_consent(policy_type, policy_version);

-- RLS policies
ALTER TABLE user_privacy_consent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own consent records"
  ON user_privacy_consent FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own consent records"
  ON user_privacy_consent FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Content reports table (Apple Guideline 1.2 - User-Generated Content)
-- Enables reporting of offensive team/league names.

CREATE TABLE IF NOT EXISTS content_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content_type text NOT NULL CHECK (content_type IN ('team_name', 'league_name', 'user_profile')),
  content_id text NOT NULL,
  content_text text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('offensive', 'inappropriate', 'harassment', 'spam', 'other')),
  details text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'actioned', 'dismissed')),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_content_reports_status ON content_reports(status);
CREATE INDEX idx_content_reports_type ON content_reports(content_type, content_id);

-- RLS policies
ALTER TABLE content_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can create reports"
  ON content_reports FOR INSERT
  WITH CHECK (auth.uid() = reporter_id);

CREATE POLICY "Users can view their own reports"
  ON content_reports FOR SELECT
  USING (auth.uid() = reporter_id);

-- RPC to record consent at signup
CREATE OR REPLACE FUNCTION public.record_user_consent(
  p_policy_type text,
  p_policy_version text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  INSERT INTO user_privacy_consent (user_id, policy_type, policy_version)
  VALUES (v_user_id, p_policy_type, p_policy_version);

  RETURN jsonb_build_object('success', true);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_user_consent(text, text) TO authenticated;

-- Content name filter function
-- Checks team/league names against a blocklist of offensive terms.
CREATE OR REPLACE FUNCTION public.check_name_appropriateness(p_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lower_name text := lower(trim(p_name));
  v_blocked_patterns text[] := ARRAY[
    -- Slurs and hate speech patterns (abbreviated/obfuscated variants included)
    'n[i1!]gg', 'f[a@]gg', 'k[i1!]ke', 'sp[i1!]c', 'ch[i1!]nk', 'w[e3]tb[a@]ck',
    'r[e3]t[a@]rd', 'tr[a@]nny',
    -- Sexual/explicit
    'p[o0]rn', 'xxx', 'c[u\x75]nt', 'd[i1!]ck', 'p[e3]n[i1!]s', 'v[a@]g[i1!]na',
    -- Violence
    'k[i1!]ll', 'murd[e3]r', 'r[a@]p[e3]', 'su[i1!]c[i1!]de',
    -- General offensive
    'sh[i1!]t', 'f[u\x75]ck', '[a@]ss\s?h[o0]le'
  ];
  v_pattern text;
BEGIN
  IF length(p_name) < 2 OR length(p_name) > 50 THEN
    RETURN jsonb_build_object(
      'is_appropriate', false,
      'reason', 'Name must be between 2 and 50 characters'
    );
  END IF;

  FOREACH v_pattern IN ARRAY v_blocked_patterns LOOP
    IF v_lower_name ~ v_pattern THEN
      RETURN jsonb_build_object(
        'is_appropriate', false,
        'reason', 'Name contains inappropriate language'
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('is_appropriate', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_name_appropriateness(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_name_appropriateness(text) TO anon;
