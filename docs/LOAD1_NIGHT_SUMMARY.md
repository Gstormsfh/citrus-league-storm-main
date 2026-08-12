# LOAD & LATENCY CERTIFICATION REPORT — LOAD-1-NIGHT
(Delivered to Garrett in-session 2026-08-11 ~07:15Z; repo copy for the terminal's morning formalization pass. Full raw timings retained in staging table load1_timings; tracking in load1_leagues; forensic league ada00006 preserved for F1 regression tests.)

See the architect inbox Entries 97-100 for the campaign doctrine, phase logs, and both P0 findings with pre-ratified fix shapes:
- F1 IGNITION-RACE (E100): concurrent start_draft_v2 → multiple draft_started events + completed→in_progress regression. Fix: FOR UPDATE at preflight + pick-path audit + regression tests.
- F2 COMPLETED-ROOM-2 (E99): completion loader hangs; engine snapshot stateSnapshot.draftStatus stale ('in_progress' after seq-14). Fix: route decorates from league row + client trusts route-level terminality; engine serializer fix rides engine batch.

## Headline numbers (all measured, server-side clock_timestamp)
- Sequential (60 drafts): pick p50 0.93-1.09ms, p95 2.5-3.75ms — flat across the ladder, zero degradation.
- 8-way simultaneous (warm): pick p50 5.00 / p95 11.59 / max 16.98ms; ignition p50 7.48ms. ~19 picks/sec sustained through full RPC path.
- Cold-backend first-call: +50-90ms one-time (pool-sizing note).
- Witness draft (real button, real room, browser) UNDER 8-way background load: 7.00s autopick metronome exact; live board updates; banner; calm refresh.
- Invariants: 83/83 drafts gapless/counter-exact/projection-consistent. DB growth ~48KB/draft. NOTIFY queue never left 0.
- Topology: DB+engine Montreal (3-4ms apart); API in Iowa (~50-70ms cross-region tax per call — move to Montreal, cheapest win); notify→broadcast 74-75ms (evening field).
- Proposed SLOs + untested ceilings (WS fan-out at scale, multi-region, N-lobby timers) + closure plan: in the delivered report §7-8.

Terminal: treat the in-session report as canonical content; formalize into docs/ properly with the morning cycle if desired, and take E99/E100 fix orders as the morning lane alongside V1-FENCE.
