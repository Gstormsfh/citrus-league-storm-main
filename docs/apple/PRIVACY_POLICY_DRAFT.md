# CitrusSports Privacy Policy (DRAFT — have counsel review before publishing)

_Last updated: ⟨date⟩_

**The short version:** we collect what a fantasy league needs to run — your
email, a display name, and your gameplay (teams, rosters, picks). We don't
sell it, we don't run ads, we don't track you across other apps.

## What we collect
- **Account:** email address, display name, authentication identifiers.
  Sign-in via email/password, Google, or Apple.
- **Gameplay:** leagues, teams, rosters, draft picks, lineups, messages you
  post in league chat.
- **Technical:** logs necessary to operate the service (timestamps, errors).

## What we do NOT collect
No precise location, no contacts, no advertising identifiers, no cross-app
tracking.

## Where it lives
Data is processed by Supabase (database & auth) and Google Cloud / Firebase
(hosting), under their respective security programs. Our databases are hosted
in **Canada (ca-central-1)** — confirmed 2026-08-18 for both the production and
staging Supabase projects.

## Sharing
We do not sell personal data. League content (team names, rosters, picks,
chat) is visible to other members of your league by design.

## Your controls
- **Delete your account** in-app: Profile → Delete Account. This is a real
  deletion, not a deactivation. Verified against the live function on
  2026-08-18: it removes your teams, rosters, lineups, waiver claims and
  priority, draft picks, transaction ledger entries, matchup lines, playoff
  pool entries, privacy-consent records, your profile, and finally your login
  itself. Leagues you commissioned pass to another member where one exists,
  and are deleted when no human members remain. Notifications are removed
  automatically with your profile.

  Two deliberate exceptions, both for the sake of other people's records:
  a league's draft log is shared history for everyone who drafted in it, so
  your entries are **anonymised** rather than removed — the picks stay, your
  identifier does not. Security audit entries keep only an event type and a
  timestamp; the IP address, device string and details are erased. If either
  step fails, the whole deletion is rolled back and your account is left whole
  rather than half-erased.
- Export or correction requests: ⟨support email — same address as the App Store support URL⟩.

## Children
CitrusSports is not directed at children under 13, and we do not knowingly
collect their data.

## Changes
We'll post updates here with a revised date.

Contact: ⟨support email⟩
