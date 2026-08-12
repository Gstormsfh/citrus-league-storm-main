
## Entry 163 — **PRE-DEPLOY VERIFICATION. All seven test files green: 70/70. Server `tsc` clean.** The working tree Garrett is about to paste is verified. One flaky test found and characterised — it is not a regression, but it is in the gate.

**Why this cycle.** E162 closed the systematic audit and I said plainly there was no sweep left worth inventing. **The genuinely valuable remaining work is verifying what actually ships.** Six changes are sitting in the working tree for the web deploy plus one for the API, and only E145 had been re-read cold (E149). A defect in any of them lands on Aug 20.

---

### Results

| file | tests | result |
|---|---|---|
| `server/src/__tests__/draftV2Routes.test.ts` (E145) | 20 | ✅ *(see flake below)* |
| `apps/web` `reduce.lobbyWait.test.ts` (E124/E139) | 14 | ✅ |
| `apps/web` `MobileBottomNav.hideRoutes.test.tsx` (E123) | 15 | ✅ |
| `apps/web` `LeagueService.cacheInvalidation.test.ts` (E126) | 6 | ✅ |
| `apps/web` `ConnectionBanner.lobbyWait.test.tsx` (E124) | 6 | ✅ |
| `apps/web` `CompletionMomentBanner.rosterHref.test.tsx` (E133) | 4 | ✅ |
| `apps/web` `DraftBoard.totalRounds.test.tsx` (E129) | 5 | ✅ |
| **total** | **70** | **all green** |

**`server tsc --noEmit`: clean, exit 0.** (`apps/web` tsc remains RED at its pre-existing 157 — untouched by tonight's work and deliberately not chased.)

---

### The flake, characterised rather than shrugged at

**First run of the server file: 19 passed, 1 failed** — `'returns 401 when Authorization header is missing'`, the **first test in the file**.

**It is not a regression.** The route's own request log inside that same failing run shows it behaved correctly:

```
<-- POST /api/draft/v2/league/1111…/pick
--> POST /api/draft/v2/league/1111…/pick 401 2ms
```

**The route returned the right status; the assertion or the harness was what failed.** Two subsequent full runs: **20/20 and 20/20.** So one failure in three complete runs, always the first test, always with correct underlying behaviour — the signature of a cold-start race in `await getApp()` rather than a logic defect.

**Recording it because a flaky test in a deploy gate is its own problem**: the next person to see red here has to spend the time I just spent deciding whether it matters. It is worth ten minutes after Aug 20 — most likely awaiting app construction once in a `beforeAll` rather than per-test. **Not urgent, not a blocker, and explicitly not a reason to hold the deploy.**

### A tooling note for the deploy sheet

Three of my earlier runs reported **17, 13 and 16 tests of 20** and looked like partial failures. They were not — `timeout 13` killed vitest mid-run and it printed a partial summary. **The web suite needs ~32s per file** (`environment` alone is ~20s of jsdom setup) and the server file ~7–9s, against a device-bash cap of ~45s. **One file per call, timeout 40+, and never trust a run whose test count is below the file's known total.** That is how a truncated run masquerades as a passing one — the opposite failure to the flake above, and more dangerous.

---

### What this does and does not establish

**Does:** every behaviour I claimed to fix tonight is covered by a test that passes right now, on Garrett's machine, against the exact working tree he will deploy. Each of those files was mutation-checked when written (revert the fix, confirm the right tests go red).

**Does not:** the tests are the ones I wrote. They cannot tell him whether I fixed the right thing — only that the thing I fixed stayed fixed. **The evidence for "right thing" is the six drafts and 480 picks, not these 70 assertions.**

**And unchanged: none of this touches E142.** The deploy sheet still opens with the warning that a completed draft produces no roster, and that remains the first thing to do.

**No code changed. Both databases untouched for this entry.**
