
---

# v4 DELTA — appended 2026-08-12 by the architect, after a night of browser-driven live runs

**Same rule as the v3 delta: where this section and the body disagree, this wins.** Everything below was observed on staging on Aug 11/12, not reasoned about. Entries 123–128 of `docs/ARCHITECT_INBOX.md` carry the receipts.

## E1 — The single pre-flight check that outranks the rest: **read the first ten picks of the smoke draft**

The v3 delta already says to spot a backup goalie in the top ten as the tell of a pre-E117 engine. **On the night of Aug 11 the deployed engine produced five goalies in fourteen picks, including a four-game callup at #10.** That is not a hypothetical any more; it is the current behaviour of whatever is running until the E117/E118 engine image is deployed.

**Gate: if the smoke draft's first ten picks contain more than two goalies, the engine image is wrong. Stop and deploy the right one before inviting anybody.** The correct board leads with high-games skaters (MacKinnon / McDavid / Kucherov / Draisaitl were correct even on the bad engine — the failure starts around pick 5).

## E2 — Expected numbers, so a deviation is visible

Measured across three independent live drafts on Aug 11/12:

| quantity | expected | note |
|---|---|---|
| inter-pick gap, ownerless seat | **2.10–2.12s** mean, p95 ≤ 2.14s | 2.000s instant-autopick arm + ~110ms engine cycle |
| ignition → first pick | **~2.4s** | ~300ms more than steady state; the lobby is being built by NOTIFY |
| successful discovery → first live paint | **~1.0s** | WS upgrade + snapshot + render |
| ignition → a waiting client enters | **1–3s** (1–4s after the E124 deploy) | bounded by the discovery poll interval |
| `notifyToBroadcastMs` | **74–75ms** | from the boot/steady logs |

**Two independent drafts agreed on the mean gap to within 6ms.** If the number drifts on the night, something is wrong that the logs will explain.

## E3 — What a manager sees BEFORE the commissioner presses START

**Before the E124 web deploy:** a red **"Connection lost — Reconnecting in 1s — Draft is not active. Current status: not_started"** banner over "Waiting for draft state…", and a ~2s retry loop. Nothing is broken; the client is mislabelling a correct server answer. **If the twelve are on a build without E124, tell them in advance that this banner is expected and the room will open by itself.**

**After the E124 deploy:** a calm, non-red **"Waiting for the draft to start — you're in the room. It will open the moment your commissioner starts the draft."** No countdown, ~3s poll, enters on its own.

**Either way, nobody needs to refresh.** That instruction should be in whatever message goes out to the twelve.

## E4 — Phones

Until the E123 web deploy, a **64px opaque bottom bar** (Playoffs / Create / News / Profile) sits over the bottom of the draft room on every screen under 1024px — confirmed live during an in-progress draft. After the deploy it is gone on all three draft routes. **Check one phone after deploying; the player list must run to the bottom edge.**

## E5 — Ten-minute pre-flight, updated

Replaces nothing in D3; adds to it.

1. Restart the engine and read the boot log for the eight required lines **plus `registry.boot_scan_complete` with `resumed: N>0`** — the resident rig league `ada00015-0000-4000-8000-000000000001` is armed `in_progress` with a 24h clock precisely so this proves itself for free. **Do not join or start that league.**
2. Smoke draft → **E1's goalie gate**.
3. First pick's countdown must read the true window (E121).
4. Open the room on a not-yet-started league → **E3's banner must be the calm one.**
5. Open one phone → **E4: no bar at the bottom.**
6. Join by code from a second account → the league must appear **immediately** (E126; before that fix, up to a 30-second lie).
7. v1 fence: `/draft?league=<id>` must land on `/draft-v2/<id>`. **Verified working Aug 12.**

## E6 — Things that are FINE and will look alarming

- **A completed league shows `draft_status='completed'` with `draft_state='active'`.** Every completed league in both databases does. It is a real defect (`submit_pick_v2` never closes the second column) but it is inert on draft night — see `docs/DESIGN_DRAFT_STATUS_SPLIT.md` §5. **Do not "fix" it during the freeze.**
- **The player list may lead with retired players** (Jagr, Cullen, Chara, zeros across). Cause is ~1,100 of 2,035 directory rows having no projection, so they tie and fall into database order. Owned by the player-data lane. **If it is still true on the night, tell the twelve to sort by a stat column or use search.**
- **The clock formatter has no hours field** — the resident rig's 24h clock renders as `1439:50`. Irrelevant at 30–300s.

## E7 — Do not touch, during and around the draft

- The resident rig league `ada00015-…-01`. It is the boot-scan proof.
- `player_ros_projections` / `project_ros` / scoring functions — a separate session owns that lane.
- The engine, once the draft starts. The v3 delta's instruction stands: **resist restarting it.** If it must be bounced, boot-scan resume is the path that carries the draft across, and E5.1 is how you know it works.

---
