-- These analytics views are consumed only by trusted pipeline/operations jobs.
-- Run them with the caller's privileges so a client can never inherit the
-- postgres owner's RLS bypass through the Data API.
alter view public.player_gar_inputs set (security_invoker = true);
alter view public.player_toi_by_situation set (security_invoker = true);
alter view public.xg_model_coverage set (security_invoker = true);

-- Supabase's historical default grants left these internal analytics objects
-- readable and, for the simple TOI view, writable by browser clients. Keep the
-- service-role path used by ingestion and model jobs; close the client path.
revoke all privileges on table
  public.player_gar_inputs,
  public.player_toi_by_situation,
  public.xg_model_coverage
from anon, authenticated;

-- player_gar_inputs_by_type has no RLS and also inherited browser DML grants.
-- No shipped client or API route uses these source tables directly.
revoke all privileges on table
  public.player_gar_inputs_by_type,
  public.player_toi_by_state,
  public.raw_shots
from anon, authenticated;

grant select on table
  public.player_gar_inputs,
  public.player_toi_by_situation,
  public.xg_model_coverage,
  public.player_gar_inputs_by_type,
  public.player_toi_by_state,
  public.raw_shots
to service_role;
