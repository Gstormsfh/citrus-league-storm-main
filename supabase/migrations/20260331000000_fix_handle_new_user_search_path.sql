-- Fix handle_new_user() SECURITY DEFINER function to include SET search_path
-- inside the function definition (not as a standalone statement).
-- This prevents search_path manipulation attacks on SECURITY DEFINER functions.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username)
  VALUES (new.id, 'user_' || substr(new.id::text, 1, 8));
  RETURN new;
END;
$$;
