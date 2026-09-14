# League history import (Yahoo, ESPN)

Operator runbook for bringing a league's history into Citrus. Design and
research live in the import spec (Drive: `LEAGUE_IMPORT_SPEC.md`); the code is
`server/src/import/*`, `server/src/services/import/*`, `server/src/routes/imports.ts`,
and migrations `20260914110000`, `20260914110100`, `20260914110200`.

## What a user does

| Source | Steps for the user | Credentials |
|---|---|---|
| ESPN, public league | Paste the league link. Done. | None. ESPN serves 2018-19 onward with no session. |
| ESPN, private league | Same paste; Citrus answers "this league is private" with two ways forward: the commissioner flips **Make League Viewable to Public** in ESPN settings, or the user finishes on the web with their ESPN sign-in. | `espn_s2` + `SWID`, web only, held in the job's memory for the run, never stored, never logged, never in the iOS binary (App Store 5.1.1(v)). |
| ESPN, seasons before 2018-19 | Imported when the user signs in on the web; otherwise the job parks those seasons as `needs_credentials` and the newer history is live immediately. | As above. |
| Yahoo | One tap: **Connect Yahoo** opens Yahoo's sign-in in the system browser, comes back, Citrus lists their NHL leagues with season counts, they tap one. | OAuth, read-only (`fspt-r`). Refresh token sealed server-side; access tokens in memory only. |

Then, for everyone: the trophy room opens on their own career, "which one is
you?" attaches other managers to their history when they sign up, and the
commissioner confirms keeper rules and scoring before starting the Citrus season.

"Which one is you?" is asked in two places, on the server's word
(`GET /history/unclaimed` answers `{ members, attached }`): a banner at the top
of League HQ, and the claim card at the top of the trophy room. `attached` is
`claimed_at` on the person's own member row, never "has a row": the foundation
seed gave every current team owner a row with no history, so the row alone
means nothing. A manager who is new to the league dismisses the HQ banner for
that league on that device (localStorage); the card on the trophy room stays.

## Yahoo: what has to happen before it works

The Yahoo endpoints answer **503 "Yahoo import is not available yet"** and
`GET /api/imports/yahoo/connection` reports `configured: false` until the four
variables below are set. Nothing else changes; ESPN import works regardless.

### 1. Apply for a Yahoo developer app (the critical path)

Yahoo reviews every Fantasy Sports application by hand. Portal: sports.yahoo.com/developer.
Fill in the form with this text, adjusting nothing that is not in brackets:

> **Organisation:** Citrus Fantasy Sports Inc., federally incorporated (CBCA), Edmonton, Alberta. Contact: [name], [email].
>
> **Product:** Citrus is an NHL fantasy hockey platform launching for the 2026-27 season, currently in App Store review. Web app at citrusfantasysports.com.
>
> **Use case:** Read-only import of a user's own Yahoo Fantasy Hockey league history (standings, champions, draft results, weekly results, keeper designations) so the user can preserve their league's record on Citrus. Users authenticate with Yahoo OAuth and we read only leagues they are members of. We never write to Yahoo. We display "Fantasy data provided by Yahoo Fantasy" with the Yahoo Fantasy logo per your attribution guidelines.
>
> **Expected users:** [Small: under 1,000 / Medium: 1,000 to 100,000]. Medium is the honest band for the launch season.
>
> **Data handling:** refresh tokens are stored AES-256-GCM encrypted with a key held only by our API server; access tokens are never persisted; raw responses are retained for the user's own leagues only; the user can disconnect at any time from Citrus or from Yahoo's account permissions page.
>
> **Redirect URI:** https://citrusfantasysports.com/import/yahoo/callback (production) and https://citrus-fantasy-staging.web.app/import/yahoo/callback (staging).
>
> **Permissions requested:** Fantasy Sports, read.

Register both redirect URIs on the app. Yahoo matches them exactly, including
the scheme and the absence of a trailing slash.

### 2. Secrets

Generate the sealing key once per environment and never reuse it across
environments: `openssl rand -hex 32` (64 hex characters; the server refuses
anything else).

| Variable | Production (GitHub Actions secret) | Staging (GCP Secret Manager, project citrus-fantasy-staging) |
|---|---|---|
| `YAHOO_CLIENT_ID` | from the Yahoo app | same name |
| `YAHOO_CLIENT_SECRET` | from the Yahoo app | same name |
| `YAHOO_TOKEN_ENCRYPTION_KEY` | `openssl rand -hex 32` | a different `openssl rand -hex 32` |
| `YAHOO_REDIRECT_URI` | literal in `production-deploy.yml` | literal in `staging-deploy.yml` and `service-staging.yaml` |

The deploy files already reference these names. Until the secrets exist,
GitHub renders them as empty strings and the feature stays off, by design.
Rotating `YAHOO_TOKEN_ENCRYPTION_KEY` invalidates every stored refresh token:
users see "Your Yahoo connection has expired. Connect Yahoo again." and one
tap fixes it. Rotate deliberately, never casually.

### 3. The one assumption to check with a real token

Everything in the Yahoo design rests on a current token being able to read a
league's **prior** seasons (`renew` chain). Library evidence is strong; Yahoo's
documentation is silent. Before announcing Yahoo import, connect one real
multi-season NHL league on staging and confirm `GET /api/imports/yahoo/leagues`
shows more than one season in the chain and a run imports them. If prior
seasons answer 403, the job records them as `needs_credentials` and only the
current season lands; that is the fallback, not the plan.

### 4. Attribution

Any screen that shows Yahoo-derived data carries "Fantasy data provided by
Yahoo Fantasy" and the Yahoo Fantasy logo, per Yahoo's terms. The UI branch
owns this; it is a condition of the app approval.

## Migrations

Apply in order: `20260914110000_league_history_foundation.sql` (a no-op on
production, which already has these objects from 2026-08-26; new for staging),
`20260914110100_league_import_platform.sql`, `20260914110200_yahoo_oauth.sql`.
All three are idempotent and were verified twice on a Supabase branch database.
Every new table has RLS on; `external_player_ids` and `yahoo_provider_tokens`
have no client write policy by design (see `DATA_INVENTORY.md` §1.5).

## Watching an import

`import_jobs.status` walks `queued → discovering → importing → computing → done`.
Three other terminal states are ordinary outcomes, not failures:

| Status | Meaning | What the user sees |
|---|---|---|
| `partial` | Some seasons landed; `seasons_needing_credentials` lists the rest, or `error.code = THROTTLED` names the season the source rate-limited (`retry_after_ms` says when to retry) | Their history so far, plus the way to get the rest |
| `needs_credentials` | Nothing reachable without a session (private ESPN league; dead Yahoo connection) | The two ways forward |
| `failed` | `error.message` says what broke; every raw payload fetched is in `import_raw_payloads` for re-parsing | "Something went wrong" and we look |

Re-running an import is safe: every write keys on the source's ids, a locked
league (`leagues.history_locked`) only gains seasons it did not have, and
trophies are recomputed from the tables each time (manual ones untouched).

`import_raw_payloads` grows with every run (a Yahoo season is roughly 25
scoreboard weeks plus a bundle, keepers, transactions and player pages). A
retention job is needed before scale; nothing is scheduled yet.

## Things the sources cannot give us

Stated plainly so nobody promises them: keeper cost rules (both platforms;
the commissioner confirms them on import), future draft-pick ownership in
dynasty leagues (entered by the commissioner), ESPN league history before the
league's creation on ESPN, and Yahoo transaction logs older than whatever
Yahoo has pruned (unverified). A season still in play imports as unfinished
and earns no champion until a re-import sees it finished.
