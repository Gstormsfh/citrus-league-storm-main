
## Entry 157 — Guard-level audit of `join_league_with_code`, the one RPC eleven humans run within minutes of each other on Aug 20. **Three real defects, none of which bite THE TWELVE.** And a near-miss I want on the record: the data pattern that looked like a catastrophic product defect was my own rig leagues. **Fourth time tonight.**

**Why I looked.** `start_draft_v2` and `submit_pick_v2` turned out to be the best-defended code in the product (E152/E154). The join RPC gets executed by eleven strangers in a burst when Garrett pastes the code into a group chat, and it had never been read at guard level.

**It is visibly a different generation of code from the two draft RPCs** — no advisory lock, no `FOR UPDATE`, no explicit invariant comments, error strings returned as `jsonb` rather than raised. That is not a criticism of its author; it predates the v2 engine's discipline. It does mean the guarantees have to be checked rather than assumed.

---

### 1. The capacity check is not race-safe

```
:40   SELECT COUNT(*) INTO v_team_count FROM teams WHERE league_id = …
:47   IF v_team_count >= v_max_teams THEN RETURN 'This league is full.'
:76   INSERT INTO teams …
```

**Nothing holds a lock across those 36 lines.** No `FOR UPDATE`, no advisory lock, and — checked rather than assumed — **nothing downstream catches it either**:

- `teams` constraints: PK, two FKs, and `UNIQUE (league_id, owner_id)`. That last one makes the *idempotent* path genuinely safe (a user double-tapping cannot get two teams) but says nothing about totals.
- `validate_team_insert`, the only trigger with teeth, checks commissioner/ownership only.

**So N concurrent callers can all read 11, all pass the < 12 test, and all insert.** The league ends up over capacity.

**The contrast is the tell:** `start_draft_v2` takes `SELECT … FOR UPDATE` on this exact table for this exact reason, and its comment cites the E100 ignition race that motivated it. **The join path never got the same treatment.**

**And the damage surfaces later, somewhere else.** An over-full league doesn't fail at join — it fails at ignition, when `start_draft_v2` checks `jsonb_array_length(round1_team_order) <> league_size` and raises **`draft_not_configured`**. The commissioner sees a cryptic error at the worst possible moment, with everyone waiting, and nothing points back at the join that caused it.

**Aug 20:** needs a 13th person holding the code and clicking at the same instant as the 12th. Garrett is inviting exactly eleven. **Low.**

### 2. The capacity number comes from a different place than the one ignition validates

```sql
v_max_teams := COALESCE(
  (settings->>'teamsCount')::INT, (settings->>'teamCount')::INT,
  (settings->>'numberOfTeams')::INT, 12);     -- ← hard-coded fallback
```

**`join_league_with_code` never reads `leagues.league_size`** — the column `start_draft_v2` validates against.

They agree today only because `createLeague` copies the client's `settings.teamsCount` into the `league_size` column and persists the settings object whole, and because the update path writes both (`LeagueService.ts:370` and `:387`). **That is a discipline maintained by two call sites, not an invariant.** Nothing checks that the two agree.

**Where the fallback bites:** any league whose settings lack `teamsCount` — seed data, an import, a script, a future code path that inserts a league row directly — silently gets a **12**-team join gate regardless of its real size. A 10-team league would accept 12 and then **refuse to start**; a 14-team league would tell its 13th and 14th invitees *"This league is full"* and never reach the size that would let it start.

**Aug 20:** THE TWELVE is `league_size = 12`, so the fallback is correct even if the key were missing. **None.**

### 3. The post-ignition seal is not atomic

E140 established that pressing START permanently locks out anyone who hasn't joined. True in intent — lines 56–61 refuse `in_progress` and `completed`. But that status is read at line 18 from a plain `SELECT` with **no `FOR UPDATE`**, and never re-checked before the insert at line 76.

`start_draft_v2` *does* take the row lock. The join path doesn't take it, so it doesn't serialize against ignition: **a join that reads `not_started` can commit after the draft has started.** That team exists with no slot in `draft_order` — a member who can see the room and never picks.

**Window is milliseconds**, and it needs someone tapping Join at the instant START is pressed. **On Aug 20 that is exactly the moment eleven people are most active** — but runbook **§E9** already tells Garrett to read "Teams joined: N/12" aloud before pressing START, which incidentally means nobody should be mid-join. **The existing mitigation happens to cover this. Low.**

---

### The near-miss — fourth rig artifact of the night

**112 of 114 staging leagues have no `teamsCount` in settings.** From that I had most of an entry written arguing that the create-league flow never persists it, that therefore *every* league in the product runs on the hard-coded 12, and that any commissioner choosing a size other than 12 gets a league that can never draft. That would have been the second-biggest finding of the night.

**It is wrong.** Opening `LeagueService.createLeague` shows `settings: settings || {}` — the client's object, including `teamsCount` from `CreateLeague.tsx:369`, is persisted whole. The product path is correct.

**The 112 are rig leagues.** 103 match rig naming plus 8 carrying `settings.architect_rig`; exactly **one** non-rig league lacks the key. I built them with raw SQL, so they never went through the flow that writes it — **the same mistake as E119's empty `league_scoring_rules`.**

**That is four times tonight** a rig artifact has impersonated a defect: E119's scoring rules, E152's four `draft_started` events, E156's two ERROR-level security lints, and now this. **The pattern is specific enough to state as a rule: when a defect's evidence is a population statistic over staging leagues, check what fraction of that population I created before writing a word.** Staging is 98% my own test data; any distribution over it describes me, not the product.

**What saved it was the standing method note** — *open the line before calling anything a one-line fix* — applied to a claim about a code path rather than a fix. I had the data and an inference; the file disagreed with the inference.

---

### Recommendations

**Nothing before Aug 20.** All three defects are low-probability on the night, one is already mitigated by §E9, and the join path is the last thing to destabilise five days from freeze.

**Before Sept 8**, in order of value:

1. **Lock the capacity check.** `SELECT … FROM leagues WHERE id = … FOR UPDATE` at the top, exactly as `start_draft_v2` does — it fixes the overflow race *and* the seal race in one line, because both stem from the same missing lock. This is the whole fix and it is genuinely small.
2. **Read `league_size`**, falling back to settings rather than the reverse, and drop the hard-coded 12 — or keep it and add a `CHECK` that the two agree.
3. **Consider a partial unique index or a count trigger** as defence-in-depth, so an over-full league is impossible rather than merely unlikely. Optional; the lock is the real fix.

**No code changed. No DDL. Both databases read-only for this entry.**
