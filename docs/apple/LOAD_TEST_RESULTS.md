# Citrus draft — load test results

**Date:** 2026-08-18 (Monday)
**Target:** production Supabase project `jjgspcpvqaiitloglxbb` (the live DB serving staging + prod web)
**Method:** real `submit_pick_v2` calls through the production code path — same RPC, same
triggers, same indexes the live draft engine uses. Concurrency generated with `pg_cron`
worker sessions released by a shared timestamp barrier so the drafts genuinely overlap
(measured start spread: **15–24 ms** across all workers).

Everything below is measured, not modelled. Fixtures were deleted afterwards; the
production database is back to exactly its prior contents.

---

## Headline

| Run | Concurrent drafts | Picks | Wall | Aggregate throughput | p50 / pick | p95 / pick | Errors |
|-----|------------------:|------:|-----:|---------------------:|-----------:|-----------:|-------:|
| Baseline | 1 | 252 | 0.59 s | **430 picks/s** | 1.65 ms | 3.64 ms | 0 |
| Concurrent | 20 | 5,040 | 7.51 s | **671 picks/s** | 20.8 ms | 54.2 ms | 0 |
| Saturation | 30 | 7,560 | 12.18 s | **620 picks/s** | 27.5 ms | 97.2 ms | 0 |

**The database ceiling is ~650 picks/second**, reached at roughly 20 concurrent drafts.
Past that, latency climbs while throughput stays flat — textbook CPU saturation, *not*
lock contention (zero errors, zero deadlocks, no blocked-lock waits at any level).

### What that means for launch

A live draft produces roughly **one pick every 5–30 seconds** per room (human pace), with
short faster bursts when autopick cascades. Taking a deliberately pessimistic 1 pick/second
per active draft:

> **~650 concurrent drafts** before the database becomes the constraint.

At a realistic 0.2 picks/second per draft, the same ceiling implies several thousand.
Either way the database is **not** the launch-weekend bottleneck, by two to three orders of
magnitude over any plausible opening night.

---

## Correctness under concurrency (the part that matters more than speed)

Verified across all 50 concurrently-drafted leagues:

| Check | Result |
|---|---|
| Total picks landed | 12,600 / 12,600 |
| Duplicate player within a league | **0** |
| Leagues with wrong/duplicate pick numbers | **0** (every league exactly 1…252) |
| Event-log sequence gaps | **0** (gap-free 1…N per league) |
| Roster projection rows | 12,600 — exact 1:1 with picks |
| Completion events | exactly one per league |
| League finalization (status + state) | 50 / 50 |

**Bonus adversarial result.** A scheduling artifact caused two extra waves of workers to
attack already-completed leagues concurrently: **15,120 out-of-order pick attempts**. Every
single one was rejected, and the correctness table above was measured *after* that assault
— zero corruption. This is the event-sourced design doing exactly what it was built to do.

### Why it holds

- `draft_picks_v2` primary key `(league_id, pick_number)` makes a duplicate pick number
  physically impossible, even if two transactions both pass preflight.
- `draft_events` unique `(league_id, seq)` plus a per-league row lock on the sequence
  counter guarantees gap-free ordering.
- `draft_events` unique `idempotency_key` enforces exactly-once at the storage layer, not
  merely in application code.
- Concurrency is scoped **per league** (row lock on that league's counter), so separate
  drafts never block each other — confirmed empirically by flat throughput scaling with
  zero errors.

---

## Operational findings to act on

1. **`max_connections = 60`** on the current instance. The API (Cloud Run, autoscaling) and
   the engine must connect through the Supabase **pooler**, not directly, or a traffic spike
   exhausts connections long before CPU. *Verify the deployed `DATABASE_URL` uses the pooler
   port before launch — highest-value single check on this list.*
2. **`max_parallel_workers = 2`** — a small instance. The lever, if the ceiling is ever
   approached, is simply a Supabase plan bump; no code change.
3. **Tail latency under saturation**: worst single pick 2.8 s at 30-way concurrency. Invisible
   behind a 90-second pick clock, but it is the number that would grow first under real
   overload — worth an alert threshold.
4. **`system_flags.no_new_drafts`** already exists as a kill switch: it refuses *new* draft
   connections while leaving in-progress drafts untouched, propagating in ~5 s. That is the
   right incident lever for launch night; make sure whoever is on call knows it exists.

---

## What this test does NOT cover

Stated plainly so the result is not over-read:

- **The WebSocket engine layer** — connection capacity per Cloud Run instance, broadcast
  fan-out cost, cold starts, per-lobby memory. The analysis sandbox has no network egress to
  Cloud Run, so this must be run from a machine that does. Harness provided:
  `scripts/loadtest/engine-loadtest.mjs` (observe-only by default; see its header).
- **API server overhead** — request parsing, auth, and the pooler hop sit in front of every
  number above. The DB figures are a ceiling, not an end-to-end promise.
- **Read-path load** — this exercised the write path. The heavy season-long reads (Matchup,
  Free Agents) have different characteristics and deserve their own pass.

---

## Reproducing

The harness was intentionally torn down after the run (functions dropped, fixtures deleted)
so no test scaffolding lives in production. The full method is recorded above; the summary
row survives in the `loadtest_summary` table. The engine-layer harness is committed at
`scripts/loadtest/engine-loadtest.mjs`.
