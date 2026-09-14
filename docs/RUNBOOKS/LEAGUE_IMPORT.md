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
| Yahoo | One tap: **Connect Yahoo** opens Yahoo's sign-in in the system browser, comes back, Citrus lists their NHL leagues with season counts, they tap one. | OAuth, read-only (`fspt-r`). Refresh token sealed server-side; access tokens in memory only. Off until the Yahoo developer application clears; screenshots are the Yahoo path until then. |
| Screenshots, any platform (Yahoo, Fantrax, CBS, ESPN, a spreadsheet) | Start with the page that lists every past champion (Yahoo and ESPN call it **League History**; Fantrax **History**; Sleeper **Trophy Room**): one screenshot gives every season, every champion and runner-up, career titles and droughts. Then the league's own awards (a spreadsheet, a chat message, a photo of the list) and, per season if wanted, standings, playoffs, draft results (**Draft Results** on Yahoo and Fantrax, **Draft Recap** on ESPN), transactions, this year's keepers and traded picks (**Draft Picks** on Fantrax and Sleeper), settings. The upload panel lists the pages in the chosen platform's own menu words. Pick them from the camera roll, tap **Read**, check the table it read, tap **Import**. Up to 12 images per read; more seasons in another go. | None. Images are scaled to 1600 px in the browser, sent once to the API, read by the same Claude model Stormy uses (`ANTHROPIC_API_KEY`, already on the API server), and never stored; the reading is kept on the job as a raw payload. |

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

## Screenshots: what is read, what is written, what to watch

The reader answers only through a tool call whose schema is
`server/src/import/screenshot/schema.ts`; the answer is validated again with
zod, and validated a third time when the commissioner sends it back edited.
`assemble.ts` turns pages into `ImportedSeason` and names every decision it
had to make in `warnings` (a team on a draft page that matched no standings
row, a traded pick with no draft year, a standings row with no manager name).
The review screen shows those before the import.

A champions page becomes one season per row (the champion at rank 1 with
playoff finish 1, the runner-up at 2), so no standings page is needed for a
season to exist. An awards page becomes named trophies (`trophy_key =
'custom'`, `source = 'imported'`, `display_name` = the award as the league
writes it); a recompute never touches custom rows, and the trophy room groups
them by name with the roll of winners so the same award continues on Citrus
through the commissioner's "add a trophy" tool.

Identity from a screenshot is the printed manager name (`name:<normalised>`),
the same key the foundation's pasted-standings path uses. Two spellings of one
person become two rows; the commissioner's merge tool fixes it in one tap.

Keeper and dynasty carry-over is on the trophy room, commissioner only
(`GET /history/carryover`): the keeper list the source showed becomes Citrus
`keeper_designations` (as `designated`; the keeper panel locks them) once each
manager has claimed a team and each player is matched, and traded future picks
rewrite `draft_order.team_order` for the coming draft (the owner's team takes
the original team's slot) once both managers have claimed. Apply after setting
the draft order; apply again after any reset of it. The draft engine reads the
order as it is, so a team drafting twice in a round is just the order.

`IMPORT_VISION_MODEL` overrides the model (default: Stormy's). Reads are
rate-limited like Stormy (`aiRateLimit`). A read of a dozen phone screenshots
costs roughly 20k input tokens.

Not verified with a live model call before landing: the reader's prompt and
schema were exercised against recorded tool outputs. First real run: a staging
commissioner uploads a real Yahoo standings page and checks the table.

## Migrations

Apply in order: `20260914110000_league_history_foundation.sql` (a no-op on
production, which already has these objects from 2026-08-26; new for staging),
`20260914110100_league_import_platform.sql`, `20260914110200_yahoo_oauth.sql`,
`20260914120000_league_import_screenshots.sql`.
All four are idempotent and were verified on a Supabase branch database.
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

Stated plainly so nobody promises them: keeper cost rules (the APIs do not
state them; the commissioner confirms them on import), future draft-pick
ownership from the APIs (a screenshot of the platform's traded-picks page
carries it), ESPN league history before the league's creation on ESPN, and
Yahoo transaction logs older than whatever Yahoo has pruned (unverified). A
screenshot import gives season honours and whatever pages were sent; weekly
records (highest week, streaks, head-to-head) need a scoreboard screenshot per
week, so a screenshot-only league's record book is season-level. A season
still in play imports as unfinished and earns no champion until a re-import
sees it finished.
