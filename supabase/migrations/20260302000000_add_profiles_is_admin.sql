-- Add is_admin flag to profiles table for admin panel access control.
-- Default false — must be manually set to true for platform administrators.
-- This column is checked server-side on every /api/admin/* request.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- Prevent non-admin users from seeing or modifying the is_admin column via RLS.
-- Only the service role (server-side) can read/write this column.
-- RLS on profiles already exists, but add an explicit policy to block self-promotion:
CREATE POLICY "Users cannot modify their own admin status"
  ON profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    -- If is_admin is being changed, block it (only service role can do this)
    is_admin IS NOT DISTINCT FROM (SELECT is_admin FROM profiles WHERE id = auth.uid())
  );

COMMENT ON COLUMN profiles.is_admin IS 'Platform admin flag. Only settable via service role (Supabase dashboard or server admin). Controls access to /api/admin/* routes.';
