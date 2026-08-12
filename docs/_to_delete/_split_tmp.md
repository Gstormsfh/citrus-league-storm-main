
---

## §5a — Addendum (2026-08-12, inbox E153): the three places that already read the wrong column

§5 above closes with *"until it lands, treat `draft_state` on a completed league as untrustworthy **rather than writing new code that reads it**."* Chasing that from the other direction — who reads it *today* — turns up three existing readers §5 did not enumerate. **None changes §5's severity or its recommendation. All three are fixed by the migration §5 already prescribes.**

| reader | what it does with `draft_state` | consequence on a completed v2 league |
|---|---|---|
| **`snapshotService.buildSnapshot`** (`:95`, `:164`) | reads **only** `draft_state`, never `draft_status`, and maps it through `mapDraftStateToLobbyStatus` — where `'active' → 'in_progress'` | **every persisted snapshot row for a finished draft records `in_progress`** |
| **`GET /api/drafts/:draftId/snapshot`** (`routes/drafts.ts:39`) | returns that snapshot verbatim | the HTTP snapshot endpoint reports a completed draft as **in progress**, to any caller |
| **`GET /api/draft/v2/league/:id/events`** (`draftV2Events.ts:197`) | sets `Cache-Control: …immutable` only when `draft_state IN ('completed','cancelled')` | completed event ranges get **`no-store` forever** instead of the 24-hour immutable cache the spec designed for them; the response's `league_state` field also reports `'active'` |

**What this does NOT do — checked rather than assumed.** The engine's runtime status is not affected. `LobbyManager.init()` bootstraps from **`draft_events`**, not from the column; `buildSnapshot` is used inside the engine *only* by `processSnapshot()` for snapshot **persistence**. And `LobbyRegistry`'s boot scan still filters on `draft_status`, so a completed league is never resumed. **§5's "the `draft_status` guard holds" is confirmed from a second direction.**

**Where the latent risk actually sits**, stated precisely: the persisted snapshots are *already wrong*. They are inert only because bootstrap replays the log instead of trusting them. **The day any bootstrap path starts trusting a snapshot's `draftStatus` — which is what snapshots are for — it inherits the lie from rows written months earlier.** That is a stronger argument for §5's migration than §5 made, and the same argument for backfilling.

**`league_state` on the events response is consumed by nothing** — server-defined, no client reader. Noted so nobody spends time on it.

**Recommendation unchanged from §5.** Completion path writes `draft_state = 'completed'` alongside `draft_status`; backfill the existing rows. This addendum adds three consumers to the case, not a new problem. **Nothing here affects Aug 20.**
