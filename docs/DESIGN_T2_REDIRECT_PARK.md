# DESIGN — Tier 2: parking the join code through SIGNUP (T2 redirect park)

**Status:** DESIGN ONLY — no implementation until Garrett ratifies (morning coffee read, ~3 min). **Tier 1 (shipped separately) already covers:** sign-IN users and OAuth users whose flow returns through /auth with the ?redirect= param intact. **Tier 2's gap:** a BRAND-NEW account — signup → email verification → return — currently loses the redirect twice (verify-email navigation drops it; post-verification landing ignores it).

## The corridor and where the code dies

1. Invitee taps `/create-league?code=X` signed out → Tier 1 sends them to `/auth?redirect=%2Fcreate-league%3Fcode%3DX` ✓
2. They pick SIGN UP (they're new) → `handleSignUp` → `navigate('/verify-email', { state: { email } })` — **redirect dropped here (death #1)**
3. They open the email link → AuthCallback verifies → navigates to its default — **redirect unknown here (death #2, different device possible!)**

Death #2 is the hard one: verification often happens on a DIFFERENT device/browser (tapped the email on their phone's mail app) — no client-side state survives that hop by definition.

## Options considered

**(a) Query-threading (recommended, covers same-device):** carry `?redirect=` into `/verify-email` as a QUERY param (survives refresh, no storage), render the post-verify CTA and the resend flow with it, and have AuthCallback honor `?redirect=` when present in its own URL (Supabase email links can carry it via the `emailRedirectTo` option on signUp — verify exact option name in our supabase-js version). Same-device round-trips fully covered; cross-device covered IF the email link itself carries the redirect (emailRedirectTo makes that true).
**(b) Server-side park:** stash `{user_id → pending_join_code}` in a table at signup, consume on first authenticated league-page load. Bulletproof cross-device, but adds a table + write path + consume logic + expiry semantics — real surface, real tests, week-of-freeze cost.
**(c) Accept-loss-with-warm-copy:** if the code is gone post-verify, land on "/" with a one-time hint ("Joining a league? Ask your commissioner for the code — Create League → Join"). Zero risk, worst UX.

## Recommendation

**(a) now (pre-twelve, small + testable), (b) docketed post-twelve** as the bulletproof upgrade, (c)'s warm-copy hint shipped alongside (a) as the graceful floor for any edge that still leaks. Estimated (a) scope: Auth.tsx signup navigate (+1 line), signUp call's emailRedirectTo (+1 option), VerifyEmail.tsx query passthrough (~4 lines), AuthCallback redirect honor (+guarded, reuse the startsWith('/') validation — REQUIRED), tests (~5: thread, callback honor, callback guard rejects external, cross-device fallback hint, resend keeps param).

## Ratification asks (Garrett)

1. Approve (a)+(c-floor) pre-twelve? 2. The AuthCallback redirect-honor MUST reuse the same startsWith('/') guard — any implementation without it is auto-rejected. 3. (b) post-twelve docket confirmed?
