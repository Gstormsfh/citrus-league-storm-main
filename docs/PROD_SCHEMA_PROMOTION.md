# Production schema promotion — the decision on Garrett's desk

**Written 2026-08-18 ~01:30 UTC, during the unattended production ship.**

## What was discovered

`citrusfantasysports.com` and `citrus-fantasy-staging.web.app` are **fully separate
stacks**: different Firebase sites, different Cloud Run API services, and — the part that
matters — **different Supabase projects**:

| | Staging | Production |
|---|---|---|
| Supabase project | `jjgspcpvqaiitloglxbb` (citrus-staging) | `iezwazccqqrhrjupxzvf` (CitrusFantasySports) |
| Migration currency | Everything through 2026-08-17 (all draft-engine v2 + this weekend's four) | Data/xG/RLS series current through **2026-08-12**; **zero draft-engine v2 objects** |
| What ran here this weekend | All three live drafts, the 12,600-pick load test, every schema proof | Untouched by the v2 work (by design — staging-first per the April postmortem) |

Deploy #397 put the **v2-era code** (API + engine) on the production service. Everything
v1-compatible got strictly better and was **verified live the same night**: lineup
endpoint 200 (was 500 for every user), real error messages, Add-AI-Teams working, the
401 session handling, the consolidated web bundle. Nothing regressed — prod has been
running v2 code against this v1 schema since deploy #396 (Aug 11).

## What does NOT work on production until promotion

Any path that touches the v2 draft spine, none of which exists on the prod DB:

- `draft_events` (event log), `draft_picks_v2`, `leagues.draft_event_counter`
- `submit_pick_v2`, `append_draft_event`, `start_draft_v2` RPCs
- The NOTIFY trigger (engine realtime hydration), snapshot persistence tables
- `tg_draft_events_sync_roster` (roster sync + league finalization on completion)
- `generate_join_code` + friendly-code join flow (prod has the OLD `join_league_with_code` signature)
- `initialize_waiver_priority`, `auto_advance_playoff_rounds`

Translation: **a new v2 draft cannot be started on citrusfantasysports.com today.** The
v1 draft room paths still function as they did.

## Why this was not done autonomously overnight

The v2 series was applied to staging via MCP over weeks and mostly is NOT in
`supabase/migrations/` — there is no replayable file chain. Recreating ~30 objects
(tables, RPCs, triggers, RLS policies, partitioned metrics) on the revenue database,
unattended, at 1 AM, with possible data-touching steps, is exactly the class of surgery
the April postmortem exists to prevent. The repo already contains purpose-built promotion
tooling (`feat/phase0c-orchestrator` — "staging to prod moat transfer script") that this
process should go through, attended.

## Recommended promotion path (attended, ~1 evening)

1. **Extract** the staging schema for the v2 object set (`supabase db dump --schema public`
   filtered to the object list above, or the moat-transfer script) into REAL migration
   files committed to `supabase/migrations/` — closing the repo/DB drift permanently.
2. **Review** each for data-touching statements (backfills) and prod-vs-staging
   assumptions (the `fix/audit-consent-rls-season-xg-chain` branch note — "28 functions
   existed only in prod" — cuts the other way too: prod has objects staging lacks;
   the dump must be additive-only, never destructive).
3. **Apply to prod** in order via `apply_migration` (the four weekend migrations —
   waiver-priority fn, playoff-advance fn, join-flow codes, completion finalizer — are
   already written as files and are safe, additive, and battle-tested on staging).
4. **Verify with the same battery used on staging draft night**: create league → friendly
   join code → 2-team draft with AI fill → 28 picks land in `draft_picks_v2` → rosters +
   league finalization fire → schedule generates with settings-driven reservation.
5. Only then: announce v2 drafts on the prod domain.

## Also worth deciding

- Should the **staging API service** be redeployed from master too? It currently runs an
  older revision (verified via auth-fingerprint probe), which is why staging showed the
  old lineup-500/generic-error behavior after prod was already fixed.
- The GitHub Actions hourly automation (waivers/scores/playoffs) points wherever its
  secrets point — confirm which project's URL is in the workflow secrets before the
  season starts, or the sweeps will tend the wrong database.

