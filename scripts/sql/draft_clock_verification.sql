-- DRAFT CLOCK VERIFICATION (2026-09-09, feedback item #4).
--
-- Per pick of the most recent draft in a league: the deadline the engine set
-- for that pick, when the pick actually committed, and the gap. Read it as:
--   * human pick, committed BEFORE the deadline  -> normal (negative "slack")
--   * autopick, committed at/after the deadline   -> normal; autopick_lag_ms
--     is engine latency (compare with draft_latency_scorecard p95)
--   * autopick with NEGATIVE lag                  -> the engine fired early:
--     a real clock bug, paste the row
--   * human pick with slack under ~1s repeatedly  -> the phone clock ran
--     ahead of the engine's; suspect the offset estimator (DraftTimerV2)
--
-- Replace the league id below (paste it; never type it from memory).
WITH d AS (
  SELECT
    e.league_id, e.seq, e.event_type, e.created_at, e.payload, e.actor,
    CASE e.event_type
      WHEN 'draft_started'  THEN e.payload ->> 'first_pick_deadline'
      WHEN 'pick'           THEN e.payload ->> 'pick_deadline'
      WHEN 'draft_resumed'  THEN e.payload ->> 'new_pick_deadline'
      WHEN 'draft_extended' THEN e.payload ->> 'new_pick_deadline'
    END AS deadline_text
  FROM public.draft_events e
  WHERE e.league_id = '<PASTE-LEAGUE-UUID>'
    AND e.event_type IN ('draft_started', 'pick', 'draft_resumed', 'draft_extended')
), w AS (
  SELECT
    seq, event_type, created_at,
    (payload ->> 'pick_number')::int AS pick_number,
    COALESCE((payload ->> 'is_autopick')::boolean, (actor ->> 'kind') = 'autopick') AS is_autopick,
    LAG(CASE WHEN deadline_text ~ '^[0-9]{4}-' THEN deadline_text::timestamptz END)
      OVER (ORDER BY seq) AS deadline_in_effect,
    max(CASE WHEN event_type = 'draft_started' THEN seq END) OVER () AS started_seq
  FROM d
)
SELECT
  pick_number,
  is_autopick,
  deadline_in_effect,
  created_at AS committed_at,
  round(extract(epoch FROM (created_at - deadline_in_effect)) * 1000)::int AS ms_after_deadline,
  CASE
    WHEN deadline_in_effect IS NULL THEN 'no deadline recorded'
    WHEN is_autopick AND created_at < deadline_in_effect THEN 'AUTOPICK BEFORE DEADLINE (bug)'
    WHEN is_autopick THEN 'autopick, lag ' || round(extract(epoch FROM (created_at - deadline_in_effect)) * 1000)::int || ' ms'
    WHEN created_at > deadline_in_effect THEN 'human pick landed after deadline (race with autopick)'
    ELSE 'ok'
  END AS verdict
FROM w
WHERE event_type = 'pick' AND seq > started_seq
ORDER BY seq;
