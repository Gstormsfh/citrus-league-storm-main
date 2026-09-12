# Matchup week route-state isolation

## Observed failure and reproduction

Deployed43d52a2a passed initial authenticated Test and Finalsz week1 scoring parity, but navigation acceptance failed. Test Next changed URL to /2 while the selector remained week1. Finalsz advanced the selector while prior-week roster/date/score content remained, and late state was observed after Previous. Guide evidence:8265/output/matchup-performance/ACCEPTANCE-43d52a2a.md. No transition network capture or controlled performance comparison exists, so the exact causal chain of every browser observation remains unproved.

Before production edits, a deterministic React test executed the actual main loader effect extracted from Matchup.tsx using the TypeScript AST. API/league boundaries and payloads were fixtures; the lock, awaits, setters and response handling were the real page code. With week1 response deferred, changing the route input to week2 made the effect return at loadingRef.current. Only week1 was requested; releasing it committed week1 under the requested week2 route. The lock release did not trigger the dropped route effect again. This establishes a concrete cause for the observed class of stale route/content failures, not merely a source resemblance.

## Narrow change

Wrap both existing Matchup routes in a fragment keyed by URL league/week. A new route receives a fresh page instance, including all week-specific state, loading locks, caches and error boundaries. Late React setters and timeout callbacks from the old page cannot overwrite the current page. No service/scoring/API cache/generation logic is edited. The surrounding router/app and shared service caches remain mounted; this is not a document reload. Same-week date and matchup selection do not change the route key.

This intentionally discards page-local selections/caches when changing league/week. Already-issued requests can still finish; this patch does not add network cancellation or change their existing side effects. Each newly visited route may start its own load instead of having that load silently dropped. No blanket cache clear or additional retry loop is introduced.

## Verification and release boundary

Seven lifecycle/wiring tests cover the baseline failure, a new route during an in-flight lock, old responses arriving last, sequential Next/Previous, rapid1→2→3, a missing/unavailable week response and late frozen-roster/timeout callbacks. Payload checks retain week/date, roster projection values (including negative and zero), actual daily points and opponent identity together. Tests execute the real loader effect but do not mount all production page children or exercise real network/database/scoring calculations; authenticated browser acceptance is still required.

45 tests across six focused route, service and scoring files passed, with full web TypeScript and targeted lint. No source/runtime, draft state, league settings, forecast numbers or native archives were changed. No production speedup claim is made. Review the exact tested PR before the next merge/release. Any needed draft exception must use the newly merged exact release SHA and the existing approved league-only mechanism, never the global override.
