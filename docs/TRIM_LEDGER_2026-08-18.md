# Trim Ledger — 2026-08-18

Zach's mandate after reviewing the consolidation: *"we've become way too bloated, code is
getting confused — trim anything that no longer works."* This ledger records what was
removed, the evidence it was dead, and the ranked backlog of what should go next.

Every removal below was verified three ways before deletion: zero import references
(grep), knip unreachability from the workspace import graph, and the full battery after
removal — **web 1899/1899, server 1140/1140, typecheck baselines unchanged (156 web /
4 server-uWS), staging build clean.**

## Removed in this PR

| Item | Size | Evidence |
|---|---|---|
| `apps/web/src/pages/DraftRoom.tsx` → `handleStartDraftLegacy_DEPRECATED` | 250 lines (comment + body) | Renamed & unwired 2026-08-08 (T7 Entry 7); its stated deletion condition — "v2 route proven in prod" — was met three live drafts ago (252 + 48 + 28 picks). Task #60 closed. |
| `apps/web/src/components/premium/` (4 components) | ~4 files | Zero imports anywhere; knip-unreachable. Premium marketing era. |
| `apps/web/src/pages/StormyDemo.tsx` | 1 page | Not routed in App.tsx; demo-recording artifact from the stormy-demo branches (last touch 2026-05-07). |
| `apps/web/src/components/gm-office/PlayerCard.tsx` | 1 component | Orphaned duplicate — live player cards are `roster/HockeyPlayerCard` and `draft/PlayerCardDialog`. (Aug-9 touch was the U6 perf-audit sweep, not a revival — still zero imports.) |
| `_to_delete/DemoLeagueService.ts.bak` | 1 stray | Accidentally committed by a `git add -A` before `_to_delete/` reached that worktree's .gitignore. |
| 11 unused `eslint-disable` directives | 8 files | `npx eslint src/ --fix` (pages + StormyService committed here; four test files remain — run the same command locally to finish). |

## Dependency landmine defused

`server/package.json` now declares **`pg ^8.23.0`**. The draft engine's realtime NOTIFY
listener (`server/src/draft/eventSubscription.ts`) imports `pg`, but it was declared
nowhere — it installed only as a transitive dependency of `firebase-tools` (a
devDependency). The production image survives today because the Dockerfile runs a full
`npm ci`; the first person to remove firebase-tools or add `--omit=dev` would have
silently killed live pick broadcasts. Declaring it makes the dependency load-bearing on
purpose. (`npm ci` validation verified tolerant of this addition — the `server` workspace
is not lock-tracked; see below.)

## Ranked backlog — next trims (not in this PR)

1. **The `Preview*` route family** — 15 design-preview pages (~430 KB of production
   chunks: PreviewArena, PreviewRink, PreviewDashboardPrimitives 89 KB, …) plus the
   `PreviewClone` circular-dependency build warning. They work, so they were out of scope
   for "no longer works" — but they are the single biggest bundle win. Removal = delete
   pages + their routes in App.tsx + update `linkGraphIntegrity.test.ts` route count.
   Decision needed: keep any as internal design references?
2. **Server v1 draft-start remnants** (the rest of task #60): `routes/draft.ts` POST
   `/league/:leagueId/start`, `api/draft.ts` `startDraft()` wrapper. Production API
   surface — remove after confirming no client calls (grep says none in web src).
3. **`player_transactions` table + `record_player_transaction` RPC** (KI-047): zero code
   readers/writers; recording lives in `transaction_ledger`. Table drop = DB change on
   both projects; needs Garrett's sign-off.
4. **Duplicate exports (10)** flagged by knip (default + named of the same symbol) —
   mechanical, zero-risk, one sitting.
5. **Lockfile hygiene**: the `server` workspace has NO entry in `package-lock.json`
   (npm tolerates it — 23 green CI checks prove it — but it means server deps are never
   lock-validated). One `npm install` on a machine with network access to github.com
   (the uWS tarball) regenerates it properly.
6. **`packages/shared` tests don't run in CI** — knip flagged the five shared test files
   as unreachable because no CI step executes them (`draftGuide`, `leagueTimeline`,
   `practiceDraft`, `playerIdDomain`). They are NOT dead — wire
   `npm test --workspace=packages/shared` into ci.yml.
7. **knip config hints**: `supabase/functions/**` and `server/scripts/bench-draft-token.ts`
   can leave the ignore list.

## Explicitly kept (looks dead, is not)

- `apps/web/src/lib/featureFlags.ts` — `FEATURE_PRACTICE_DRAFT` (T15 Entry 13,
  2026-08-09). A deliberately dormant flip switch for practice-draft mode with documented
  gates: architect ratification → post-TWELVE → **Garrett-manual flip via git commit**.
  Zero imports IS the designed OFF state, not death. It was on the initial trim list and
  was struck during pre-deletion review — the knip/grep evidence was accurate but the
  verdict wrong; per `DESIGN_T15_practice_draft_mode.md` §4 this file is the rollout
  mechanism itself.
- `apps/web/ios/App/App/public/cordova*.js` — Capacitor shell runtime files; invisible to
  the import graph by design.
- `scripts/**` — manually-run operational tooling (2026-06-12 purge review stands).

