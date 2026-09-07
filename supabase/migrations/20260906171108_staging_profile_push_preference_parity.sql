-- Staging parity for the existing 20260905001000 profile preference migration.
-- The shared profile projection requires this column; its absence rejects profile reads.
-- Existing profile RLS continues to restrict writes to the account owner.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS push_notifications boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.profiles.push_notifications IS 'Manager opt-in for the on-the-clock APNs push. Default true; PushService skips owners set false.';
