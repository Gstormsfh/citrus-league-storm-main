-- STORMY ANSWER QUALITY AUDIT (2026-09-09, feedback item #6).
--
-- The log kept 200 chars of the question and nothing of the answer, so
-- "Stormy's answers are bad" could not be checked against anything. Two
-- columns, both bounded: the first 600 chars of the reply and how much
-- context the client attached. Read with:
--
--   select created_at, message_preview, answer_preview, context_chars
--   from public.stormy_chat_log order by created_at desc limit 30;
--
-- A short context_chars next to a generic answer is the client not loading
-- the league (pre-draft, wrong league, offseason); a long context next to a
-- generic answer is the prompt.
ALTER TABLE public.stormy_chat_log
  ADD COLUMN IF NOT EXISTS answer_preview text,
  ADD COLUMN IF NOT EXISTS context_chars integer;

COMMENT ON COLUMN public.stormy_chat_log.answer_preview IS 'First 600 chars of the reply, for quality review (2026-09-09).';
COMMENT ON COLUMN public.stormy_chat_log.context_chars IS 'Length of the client-supplied context block sent with the question, capped at 8000 upstream.';
