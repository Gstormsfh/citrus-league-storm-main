-- Enable RLS
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;

-- Remove any existing policies to avoid conflicts
DROP POLICY IF EXISTS "Enable read access for all users" ON public.players;
DROP POLICY IF EXISTS "Allow public read access" ON public.players;
DROP POLICY IF EXISTS "Allow all access" ON public.players;
DROP POLICY IF EXISTS "Allow admin write access" ON public.players;

-- Policy 1: Allow everyone (anon + authenticated) to READ
CREATE POLICY "Enable read access for all users"
ON public.players
FOR SELECT
USING (true);

-- Policy 2: Allow Service Role (and specific admins) to WRITE
-- The service role key bypasses RLS automatically, but this is good for explicit admin users.
CREATE POLICY "Enable write access for admins"
ON public.players
FOR ALL
USING (
  -- Check if the user has the 'service_role' (unlikely for a user) OR a custom 'admin' claim
  (auth.jwt() ->> 'role' = 'service_role')
  OR
  ((auth.jwt() ->> 'app_metadata')::jsonb ->> 'role' = 'admin')
)
WITH CHECK (
  (auth.jwt() ->> 'role' = 'service_role')
  OR
  ((auth.jwt() ->> 'app_metadata')::jsonb ->> 'role' = 'admin')
);

