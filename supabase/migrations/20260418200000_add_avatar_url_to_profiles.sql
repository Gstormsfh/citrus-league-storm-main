-- Add avatar_url column to profiles table for profile picture support
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;

-- RLS is already enabled on profiles table (from initial migration).
-- Existing policies allow:
--   SELECT: auth.uid() = id (own profile only)
--   UPDATE: auth.uid() = id (own profile only)
--
-- We need to allow users to read OTHER users' avatar_urls (e.g. in standings, matchups).
-- Add a policy that lets any authenticated user read avatar_url from any profile.
CREATE POLICY "Authenticated users can view all profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);
