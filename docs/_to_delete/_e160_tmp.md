
## Entry 160 — **E159's "complete" commissioner-tool inventory was short by two rows.** Checked my own completeness claim within the hour; it was incomplete, not wrong. `commissioner_override` and `draft_cancelled` both have purpose-built snake consumer code and **no producer at all** — which makes three orphaned event types, not one.

**Why I looked.** E159 published a four-row table and called the inventory complete. `LobbyManager`'s header comment lists two event types that table never mentioned. **A completeness claim is exactly the kind that should be tested rather than trusted**, and it was mine.

---

### The catalog vs. what has ever been written

`validate_draft_event_payload` — the §6 catalog, the authority on what a valid event is — defines **twelve** event types:

`pick` · `pick_undone` · `draft_started` · `draft_completed` · `draft_cancelled` · `draft_paused` · `draft_resumed` · `draft_extended` · `commissioner_override` · `autopick_failed` · `generation_bumped` · `auction_nomination_started` (+ the rest of the auction family)

**`draft_events` on staging, across 115 drafts, holds three:** `pick` (1,716), `draft_started` (115), `draft_completed` (108).

### The two I missed, both with real consumer code

**`commissioner_override`** — *"advance state without on-clock check (commissioner authoritatively decides)."* Handled at `:2916` (apply), `:3182` (replay), with a **dedicated bootstrap handler at `:3732`** that includes a guard for an override landing past the end of the draft order. That is purpose-built, defensive code.

**`draft_cancelled`** — handled at `:3014` and `:3230`, an explicit transition to `cancelled`, referenced in the lifecycle documentation at `:520`.

**Neither has a producer on the snake rail.** The only functions containing the string are `auction_commissioner_override_v2` and `auction_nomination_skip_v2` — auction-only, and the auction path emits its own distinct `auction_commissioner_override` type, handled separately at `:3107` / `:3350`. **Nothing anywhere can emit a plain `commissioner_override`, and nothing can emit `draft_cancelled`.**

### Corrected inventory

| capability | producer | engine | route | button | verdict |
|---|---|---|---|---|---|
| **extend** | ✅ `draft_extend` | ✅ live + bootstrap | ❌ | ❌ | **usable by hand** — §E12 |
| **pause / resume** | ✅ `draft_pause` / `draft_resume` | ✅ suppresses autopick, refuses picks | ❌ | ❌ | **usable by hand** — §E13 |
| **undo** | ❌ none | ✅ replay + projection cleanup | v1 route, wrong table | hidden | **absent** — §E10 |
| **commissioner_override** | ❌ none (snake) | ✅ apply + replay + bootstrap guard | ❌ | ❌ | **absent — NEW** |
| **cancel draft** | ❌ none | ✅ apply + replay | ❌ | ❌ | **absent — NEW** |
| **reset** | ⚠️ v1-era, wrong table | — | ✅ | ✅ Profile | **lies, bricks the league** — §E11 |

**So: three orphaned event types, not one.** `pick_undone`, `commissioner_override`, `draft_cancelled` — each with careful consumer code waiting for a producer that never landed.

**This does not weaken E159's conclusion; it strengthens it.** The pattern was *"built database-first and correctly, then the HTTP and UI layers never followed."* Two more instances say the producers never landed either — the engine was taught to read a vocabulary that only ever got three words written in it.

---

### Does any of this matter on Aug 20?

**No, and the reason is worth stating** because `commissioner_override` sounds like exactly what you would want at 11pm.

Its use case is *"manager X is unreachable — I'll pick for them."* **That case is already handled, by design: the clock expires and autopick makes a sensible pick.** That is the correct behaviour and it needs no commissioner. The override exists for cases where a commissioner wants to pick *out of turn* or overrule the order — rarer, and not something to reach for during a friendly draft.

**So the answer to "someone went dark" is: do nothing. Let the clock run.** No runbook change; §E12 (extend) already covers the case where you would rather give them more time than let it lapse.

`draft_cancelled` matters even less — abandoning a draft mid-flight is a new-league situation (§E11), not an event-emission one.

---

### The method note

**E159 was published about an hour ago with a table headed "the commissioner-tool inventory, complete."** It took one query against the validator's catalog to show it wasn't. Nothing in the earlier work was wrong — every verdict in that table stands — but *complete* is a strong word and I used it without checking the authoritative list.

**The catalog was right there.** `validate_draft_event_payload` is the schema's own statement of what events exist, and enumerating it should have been the first step of the inventory rather than the correction to it.

**Rule, added to the list: when claiming an inventory is complete, enumerate from the authority — not from the call sites I happened to have read.**

**No code changed. Both databases read-only for this entry.**
