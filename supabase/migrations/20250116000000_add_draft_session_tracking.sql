-- Add draft session tracking and soft delete support
-- This allows multiple draft attempts per league without data conflicts

-- Add draft_session_id to track different draft attempts
ALTER TABLE public.draft_picks 
ADD COLUMN IF NOT EXISTS draft_session_id uuid DEFAULT gen_random_uuid();

ALTER TABLE public.draft_order 
ADD COLUMN IF NOT EXISTS draft_session_id uuid DEFAULT gen_random_uuid();

-- Add soft delete support
ALTER TABLE public.draft_picks 
ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE public.draft_order 
ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Drop old unique constraints (we'll handle uniqueness in application logic with session)
ALTER TABLE public.draft_picks 
DROP CONSTRAINT IF EXISTS draft_picks_league_id_round_number_pick_number_key;

ALTER TABLE public.draft_picks 
DROP CONSTRAINT IF EXISTS draft_picks_league_id_player_id_key;

-- Create indexes for session queries (partial indexes for active records only)
CREATE INDEX IF NOT EXISTS idx_draft_picks_session 
ON public.draft_picks(league_id, draft_session_id) 
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_draft_picks_active 
ON public.draft_picks(league_id) 
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_draft_order_session 
ON public.draft_order(league_id, draft_session_id) 
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_draft_order_active 
ON public.draft_order(league_id) 
WHERE deleted_at IS NULL;

-- Update existing records to have a session ID (backward compatibility)
-- This ensures all existing drafts get a session ID
UPDATE public.draft_picks 
SET draft_session_id = gen_random_uuid()
WHERE draft_session_id IS NULL;

UPDATE public.draft_order 
SET draft_session_id = gen_random_uuid()
WHERE draft_session_id IS NULL;







