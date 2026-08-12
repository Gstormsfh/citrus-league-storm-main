# DESIGN — the two draft-state columns, and the value that exists in only one of them
**Architect design note · 2026-08-12 · PROPOSE ONLY — no code changed by this document**
**Root cause behind E111, and a live 500-instead-of-400 in the API today.**

---

## 1. The finding in one sentence

`leagues` carries **two** state columns whose domains overlap but neither contains the other, the shared TypeScript union describes **neither of them**, and one API validator will therefore happily accept a value that Postgres rejects at write time.

## 2. The three domains, side by side (all verified against staging)

| | values |
|---|---|
| **DB enum `draft_status`** | `not_started` · `queued` · `in_progress` · `completed` |
| **DB check `leagues_draft_state_chk` on `draft_state`** | `not_started` · `pre_draft` · `active` · `paused` · `completed` · `cancelled` |
| **TS `DRAFT_STATUSES`** (`packages/shared/src/types/league.ts:552`) | `not_started` · `queued` · `in_progress` · **`paused`** · `completed` |

Read the diffs rather than the lists:

- **`queued` exists only on `draft_status`.**
- **`paused`, `cancelled`, `pre_draft` exist only on `draft_state`.**
- **`DRAFT_STATUSES` is `draft_status` plus a value borrowed from the other column.** It is not a faithful description of either.

I discovered the second row the way one usually does: by writing `draft_state: 'idle'` while building a rig and getting `23514 leagues_draft_state_chk`. `idle` is not a member of either domain, though it reads like it should be.

## 3. What it breaks today

### 3a. A validator that accepts what the database refuses — **live, reachable**

`server/src/middleware/validate.ts:307`:

```ts
draft_status: z.enum(DRAFT_STATUSES).optional(),
```

`DRAFT_STATUSES` includes `'paused'`; the column's enum does not. **A caller sending `draft_status: 'paused'` passes validation, reaches the database, and fails there with `22P02 invalid input value for enum draft_status`.** The user-visible result is a **500 where a 400 belongs** — the request was malformed, and the layer whose whole job is to say so waved it through.

This is the same shape as **E111**, where the engine's boot scan queried `.in('draft_status', ['in_progress','paused'])` and Postgres answered `22P02`. That fix was applied at the one call site. **The generator of the bug — a shared union that does not match the column — was never addressed, so the next site to trust it will fail the same way.** The codebase already carries the scar tissue: `server/src/draft/index.ts:799–805` is a comment explaining to future readers that `draft_status` has no `paused`.

### 3b. A constant with a permanently-dead element

`packages/shared/src/types/league.ts:561`:

```ts
export const CONNECTABLE_DRAFT_STATUSES: readonly DraftStatus[] = ['queued', 'in_progress', 'paused'];
```

with the comment: *"`paused` is connectable so users can stay in the draft room and see chat / commissioner actions while picks are halted."*

**That behaviour is real and correct — but it does not come from this line.** A paused draft has `draft_status = 'in_progress'` and `draft_state = 'paused'`; it is connectable because of the `in_progress` element. The `'paused'` element **never matches anything the database can produce.**

This is worse than dead code, because it is dead code that *looks* load-bearing. A future engineer reading the comment would reasonably conclude that pausing sets `draft_status`, and "fix" the pause path to write it — which fails at Postgres. The same trap is set at `apps/web/src/lib/draftClient/deriveDraftState.ts:349`, which compares `draftStatus !== 'paused'` — a test that is unconditionally true against real data.

### 3c. Two columns, one concept, no stated contract

Nothing in the repo says which column is authoritative for what. Empirically, from tonight's runs:

| moment | `draft_status` | `draft_state` |
|---|---|---|
| league created | `not_started` | `not_started` |
| after `start_draft_v2` | `in_progress` | `active` |
| paused (per `LobbyManager.ts:5592`) | `in_progress` | `paused` |
| all picks in | `completed` | (observed `active` on an older rig — **see §5**) |

The engine reads **both**: `LobbyRegistry`'s boot scan filters on `draft_status = 'in_progress'`, while `LobbyManager.init` reconstructs its timer from `draft_state` (`paused`/`completed`/`cancelled` → no timer). **A disagreement between the two columns is therefore not a cosmetic inconsistency — it changes whether a lobby arms a clock.**

## 4. Proposal

**P1 — split the constant so each name means one column.** *(low risk, mechanical)*

```ts
/** The `leagues.draft_status` enum, exactly. Anything validating or
 *  writing that column must use this. */
export const DB_DRAFT_STATUSES = ['not_started', 'queued', 'in_progress', 'completed'] as const;

/** The `leagues.draft_state` check constraint, exactly. */
export const DB_DRAFT_STATES = ['not_started', 'pre_draft', 'active', 'paused', 'completed', 'cancelled'] as const;
```

Keep `DRAFT_STATUSES` as-is for now if it is load-bearing in the client's own vocabulary, but **rename it in place to say so** — e.g. `UI_DRAFT_PHASES` — so nobody hands it to a column again.

**P2 — point the validator at the column it validates.** *(one line, converts a 500 into a 400)*

```ts
draft_status: z.enum(DB_DRAFT_STATUSES).optional(),
```

**P3 — kill the two dead `'paused'` comparisons**, and replace the misleading comment on `CONNECTABLE_DRAFT_STATUSES` with the truth: *a paused draft is connectable because its `draft_status` is still `in_progress`; `draft_state` carries the pause.*

**P4 — write the contract down**, in one comment above the two columns' shared type: *`draft_status` is the **lifecycle** (has it started / is it over); `draft_state` is the **run mode** (is the clock running). They are orthogonal and both are authoritative for their own question.* Ten lines that would have prevented E111 and this note.

## 5. **CONFIRMED DEFECT — the final pick never closes `draft_state`**

I checked rather than wondered. **Three drafts that completed independently tonight, all identical:**

| league | picks | `draft_status` | `draft_state` |
|---|---|---|---|
| `ada00017-…-01` | 24 / 24 | `completed` | **`active`** |
| `ada00016-…-01` | 36 / 36 | `completed` | **`active`** |
| `ada00014-…-01` | 12 / 12 | `completed` | **`active`** |

**`submit_pick_v2`'s completion path sets `draft_status = 'completed'` and never touches `draft_state`, which stays `'active'` forever.** Every finished league in the database is simultaneously asserting *"there are no more picks"* and *"the clock is running"* — on the two columns the engine reads for exactly those two questions.

**Why it has not bitten yet, and where it would.** `LobbyManager.init`'s timer reconstruction is an `else if` chain whose first test is `this.draftStatus === 'in_progress'`; a completed league fails that and never reaches the `draft_state` branch. So `draft_status` is currently shielding a wrong `draft_state` from ever being read. That shield is one refactor thick. The condition it protects is precisely **boot-scan resume after a mid-draft engine restart** — the one Slice-1 contract still unproven in the field, and a live possibility on Aug 20 if the engine is ever bounced.

**This belongs in the same change as P1–P4**, as a migration that has the completion path write `draft_state = 'completed'` alongside `draft_status`. It should also **backfill** — `update leagues set draft_state = 'completed' where draft_status = 'completed' and draft_state = 'active'` — because otherwise every league already in both databases keeps lying. *(Not applied by me: schema changes need a migration and Garrett's deploy, and production is read-only to the architect.)*

## 6. Risk and timing

P2 and P3 are minutes of work and reduce risk. P1 touches a shared type and will ripple through imports — safe, but noisy, and **not something to do inside the Aug 17 freeze window**.

§5 is the item that changes the calculus. It is a real data-integrity defect on every completed league in both databases, and its blast radius is the engine's restart path. It is *not* urgent for Aug 20 — the `draft_status` guard holds — but it should not be carried into September either.

**Architect's recommendation: ship P2 + P3 with the next web/API batch (minutes, strictly risk-reducing). Hold P1 + P4 until after THE TWELVE. Schedule §5's migration + backfill for the first post-draft window, and until it lands, treat `draft_state` on a completed league as untrustworthy rather than writing new code that reads it.**

---
*Propose-only. Nothing in this document has been implemented. — Architect, 2026-08-12*

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

**Addendum to §5a (inbox E154):** `submit_pick_v2`'s completion branch leaves `draft_state` untouched **deliberately**, and documents why — *"Amendment 2 evidence-closed 2026-08-05: architect prod query returned `ERROR: column "draft_state" does not exist` — column is v2-stack-only, no v2 consumer reads `draft_state` post-completion."* The first inference is sound (production genuinely has no v2 schema). **The second no longer holds** — §5a lists three readers. This is a documented decision whose stated premise expired, not an oversight; whoever picks up the migration should re-run Amendment 2's evidence check first, because that comment names exactly what to verify.

---

**§5b — the fix already exists (inbox E168, 2026-08-12).** §5 and §5a both recommend "have the completion path write `draft_state = 'completed'`, then backfill." **That work was done on 2026-08-08 and is sitting unapplied:**

- `supabase/migrations/20260808120000_v2_draft_completion_clears_draft_state.sql` — the N-2 migration, **not applied**
- `supabase/migrations/20260821000000_v1_completed_leagues_backfill_draft_state.sql` — the backfill, **not applied**, deliberately numbered for after THE TWELVE
- `scripts/proof/apply-n2-draft-state.local.sql` — rehearsed apply with a capture-hash pin
- `supabase/migrations/captures/2026-08-08_pre_v2_draft_completion_clears_draft_state.sql` — pre-N-2 body for `psql -f` rollback
- `docs/RUNBOOKS/SUNDAY_EXECUTION_BLOCKS.md` **Group B** — the operating procedure, with a B-1 rehearsal gate and a B-3 post-apply census

**The N-2 header contains the same reader enumeration §5a presents as new**, under an architect ruling requiring it. §5a is therefore a rediscovery, not a discovery — corrected here rather than deleted, because the enumeration agrees and independent agreement is worth something.

**Recommendation unchanged in substance, cheaper in practice: do not apply before Aug 20** (it is a `CREATE OR REPLACE` on `submit_pick_v2`'s completion path, and §5/§5a/E161 all establish the staleness is inert). Afterwards it is "run Group B", not "write a migration".
