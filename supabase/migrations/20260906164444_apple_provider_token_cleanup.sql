-- Server-only, application-encrypted Apple refresh tokens for account deletion.
CREATE TABLE public.apple_provider_tokens (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 client_id text NOT NULL,
 sealed_token text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.apple_provider_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.apple_provider_tokens FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.apple_provider_tokens TO service_role;
COMMENT ON TABLE public.apple_provider_tokens IS 'AES-256-GCM encrypted provider refresh tokens; key held only by API server. No client access.';
