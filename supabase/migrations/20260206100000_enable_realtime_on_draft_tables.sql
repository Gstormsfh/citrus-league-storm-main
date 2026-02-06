-- Enable Supabase Realtime on draft_picks and leagues tables
-- WITHOUT THIS, no realtime events are ever broadcast for these tables.
-- This was the root cause of timer/pick sync failures across clients.

-- Add draft_picks to the realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.draft_picks;

-- Add leagues to the realtime publication (for settings/status sync)
ALTER PUBLICATION supabase_realtime ADD TABLE public.leagues;
