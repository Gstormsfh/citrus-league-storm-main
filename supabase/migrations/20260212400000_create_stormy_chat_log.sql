-- ============================================================
-- Stormy AI Chat Log — Rate Limiting & Usage Tracking
-- ============================================================
-- Each row represents one message sent to Stormy.
-- Used by the stormy-chat edge function to enforce a daily cap
-- and track token spend per user.

CREATE TABLE IF NOT EXISTS stormy_chat_log (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tokens_used  integer     DEFAULT 0,
  message_preview text,
  created_at   timestamptz DEFAULT now()
);

-- Fast lookups: "how many messages has this user sent in the last 24 h?"
CREATE INDEX IF NOT EXISTS idx_stormy_chat_log_user_created
  ON stormy_chat_log (user_id, created_at DESC);

-- RLS: users can read their own logs; the edge function inserts via service role
ALTER TABLE stormy_chat_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own chat logs"
  ON stormy_chat_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert chat logs"
  ON stormy_chat_log FOR INSERT
  WITH CHECK (true);
