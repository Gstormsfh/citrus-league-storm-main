
## Entry 162 — Audited `validate_draft_event_payload`, the only gate between a caller and the durable log. **It is a schema gate, not a semantic one — which is correct design, and is exactly why E156's grant is the whole ballgame.** Severity of E156 refined, not changed. One cheap hardening found along the way.

**Why this one mattered more than it looks.** E156 established that `append_draft_event` is `SECURITY DEFINER`, executable by `authenticated`, and carries no authorization check. The validator is what runs immediately before the write. **If it enforced semantics, the forged-pick path would be narrow; if it only enforces shape, E156 is as bad as I described.** That question deserved an answer rather than an assumption.

---

### What it actually enforces

**Required-field presence per event type, plus four type spot-checks on `pick`:**

```
pick_number   must be number
player_id     must be number
is_autopick   must be boolean
pick_deadline must be string (ISO 8601)
```

**And nothing else.** Notably, **`team_id` is required but never type-checked** — it survives to the projection trigger's `(payload->>'team_id')::uuid` cast, which would reject a non-UUID inside the same transaction. A valid UUID passes cleanly.

**Two event types are waved straight through:**

- **`commissioner_override` → `RETURN true`, immediately, no required fields at all.** Any payload whatsoever. This is the one event type whose documented purpose is *"advance state without on-clock check — commissioner authoritatively decides"* (E160), and it has zero payload validation.
- **All ten auction event types → `RETURN true`**, with the reason written down: *"payload validation is handled inside the auction RPCs; keep the validator permissive here to avoid churn."*

**Unknown event types are rejected** — `invalid_event_payload: unknown event_type`. That gate is real.

**There is no semantic validation anywhere.** No check that the team belongs to the league, that the player is undrafted, that the pick number is next, that `picked_at` is plausible, or that the actor is who it claims. **All of that lives in `submit_pick_v2` — which is precisely what a direct `append_draft_event` call bypasses.**

**This is the right design.** A payload validator should validate payloads; semantics belong in the RPC that owns the transition. The problem is not the validator — it is that a caller can reach the layer *underneath* the RPC.

---

### E156's exploit, now bounded exactly

Checked the projection's constraints rather than assuming them:

| blocked by | what it stops |
|---|---|
| PK `(league_id, pick_number)` | reusing a pick number that already exists |
| FK `team_id → teams` | a team id that doesn't exist anywhere |
| FK `source_event_id → draft_events` | orphan projection rows |
| validator | unknown event types; wrong types on four `pick` fields |

| **NOT blocked** | consequence |
|---|---|
| `(league_id, player_id)` is a **plain index, not unique** | **the same player can be drafted twice.** The "already taken" check exists only in `submit_pick_v2` |
| `team_id` FK is **not league-scoped** | a pick can be assigned to a team belonging to a **different league** |
| pick_number is only unique, not sequential | a forged pick can claim any unused number, including far ahead |
| `commissioner_override` | **no payload requirements at all** |
| `actor`, `picked_at` | free text / arbitrary |

**So E156's severity stands as written, with sharper edges: a forged `pick` needs only well-formed values, and a forged `commissioner_override` needs nothing.** The recommendation is unchanged — one `REVOKE`, **not before Aug 20**, scheduled before Sept 8.

---

### The hardening worth adding while you're in there

**`draft_picks_v2` should probably have `UNIQUE (league_id, player_id)`.**

The projection trigger's own comment says the PK *"enforces I3 (no duplicate picks) at the projection layer"* — but `(league_id, pick_number)` only prevents duplicate **slots**, not duplicate **players**. Today nothing can produce a duplicate player because `submit_pick_v2` checks `player_taken` first; that is a single point of enforcement in the RPC layer, with no backstop underneath it.

**Checked that it wouldn't break anything:** undo deletes the projection row (E153), so re-drafting a player after an undo stays legal; free agency writes `roster_assignments` and the v1 table, never this one (E151); and staging's 1,716 existing picks would need a duplicate check before applying it. **Cheap, safe, and it makes the same guarantee at the same layer the PK already does for pick numbers.** Post-freeze.

---

### Where this leaves the audit

**Every RPC on the draft path is now read at guard level** — `start_draft_v2`, `submit_pick_v2`, `append_draft_event`, `validate_draft_event_payload`, `join_league_with_code`, `draft_extend`, `draft_pause`, `draft_resume`, `draft_deadline_sweep`, `nuclear_reset_draft` — along with the projection trigger, the boot-scan path, the clock-liveness scanner and the client state machine.

**The v1-table class, the security class and the commissioner-tool inventory are each enumerated from their authority rather than from call sites.** I do not have another systematic sweep queued that I believe would find something. **Saying that plainly rather than inventing one** — per E149, and because the honest state of the audit is worth more to Garrett than another entry.

**No code changed. No DDL. Both databases read-only for this entry.**
