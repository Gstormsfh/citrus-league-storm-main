-- Drop the TEXT overload of get_daily_projections to resolve PGRST203
-- "Could not choose the best candidate function" ambiguity error.
--
-- PostgREST cannot disambiguate between get_daily_projections(INTEGER[], DATE)
-- and get_daily_projections(INTEGER[], TEXT) when a string date is passed.
-- PostgreSQL can implicitly cast TEXT → DATE, so only the DATE version is needed.
DROP FUNCTION IF EXISTS public.get_daily_projections(INTEGER[], TEXT);
