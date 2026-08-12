
## Entry 153 — Chased `draft_state` from the reader side after E152 surfaced it. **Found three existing readers of the known-wrong column, confirmed the engine is not one of them, and it changes nothing.** Recording it as a §5 addendum rather than a finding, because that is what it is.

**Why I looked.** E152 established that a reset leaves `draft_status='not_started'` beside `draft_state='active'`, and that 111 of 112 completed leagues carry `draft_state='active'` because the completion path never winds it back. That root cause is **already documented** — `DESIGN_DRAFT_STATUS_SPLIT.md` §5, from E128 — and its closing advice is *"treat `draft_state` on a completed league as untrustworthy rather than writing new code that reads it."*

**So I asked the question §5 didn't: who reads it already?**

**Three readers, all real, none new-in-kind:**

1. **`snapshotService.buildSnapshot`** reads **only** `draft_state` — never `draft_status` — and maps `'active' → 'in_progress'`. **Every persisted snapshot row for a finished draft records `in_progress`.**
2. **`GET /api/drafts/:draftId/snapshot`** returns that verbatim, so the HTTP snapshot endpoint reports completed drafts as in-progress.
3. **`GET /api/draft/v2/…/events`** gates its `immutable` cache header on `draft_state IN ('completed','cancelled')`, so completed event ranges never get the 24-hour cache the spec designed for them, and the response's `league_state` reports `'active'`. *(That field is consumed by nothing — server-defined, no client reader. Noted so nobody spends time on it.)*

**What I checked rather than assumed, because E152 was an hour ago.** `buildSnapshot` is imported by `LobbyManager`, which looked alarming. It is used there **only** by `processSnapshot()` — snapshot *persistence*. Lobby bootstrap goes through `LobbyManager.init()`, which reads **`draft_events`**. And `LobbyRegistry`'s boot scan still filters on `draft_status`. **§5's claim that the `draft_status` guard holds is confirmed from a second direction. The engine's runtime status is not affected.**

**The one thing worth adding to §5's argument.** The persisted snapshots are *already wrong* and inert only because bootstrap replays the log instead of trusting them. **The day a bootstrap path starts trusting a snapshot's `draftStatus` — which is the entire purpose of snapshots — it inherits the lie from rows written months earlier.** That is a stronger case for §5's migration *and* for its backfill than §5 itself made.

**Recommendation unchanged. Severity unchanged. Nothing here affects Aug 20.**

**This is a footnote, and I am filing it as one** — `DESIGN_DRAFT_STATUS_SPLIT.md` §5a — rather than promoting a known root cause to a new headline because I approached it from a different angle. E149's commitment was to say plainly when a cycle finds little. **This cycle found little: three consumers of a defect already on the books, and a confirmation that the thing protecting us still protects us.**

**No code changed. `DESIGN_DRAFT_STATUS_SPLIT.md` §5a added. Both databases read-only for this entry.**
